import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { readFile } from 'fs/promises';
import { join } from 'path';

// Valid icon sizes
const VALID_SIZES = [16, 32, 180, 192, 512] as const;
type ValidSize = (typeof VALID_SIZES)[number];

// Cache institution logo data for 5 minutes to avoid hitting Supabase on every request
let cachedLogoUrl: string | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function isValidSize(size: string): size is ValidSize {
  return VALID_SIZES.includes(Number(size) as ValidSize);
}

/**
 * Fetch institution logo URL from Supabase with caching.
 */
async function getInstitutionLogoUrl(): Promise<string | null> {
  const now = Date.now();
  if (cachedLogoUrl !== null && now < cacheExpiry) {
    return cachedLogoUrl;
  }

  try {
    const { data, error } = await supabaseServer
      .from('institution_settings')
      .select('logo_url')
      .limit(1)
      .maybeSingle();

    if (error || !data?.logo_url) {
      cachedLogoUrl = null;
      cacheExpiry = now + CACHE_TTL;
      return null;
    }

    cachedLogoUrl = data.logo_url;
    cacheExpiry = now + CACHE_TTL;
    return cachedLogoUrl;
  } catch {
    return null;
  }
}

/**
 * Fetch image from URL and return as ArrayBuffer.
 */
async function fetchImage(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Resize image using Sharp (if available) or return original.
 * Falls back to returning the original image if Sharp is not available.
 */
async function resizeImage(
  imageBuffer: ArrayBuffer,
  targetSize: number,
  contentType: string
): Promise<{ data: Buffer; contentType: string }> {
  try {
    const sharp = (await import('sharp')).default;
    const buffer = Buffer.from(imageBuffer);

    // For maskable icons, add padding (20% safe zone)
    // For regular icons, resize to exact size with white background
    const resized = await sharp(buffer)
      .resize(targetSize, targetSize, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();

    return { data: resized, contentType: 'image/png' };
  } catch {
    // Sharp not available, return original image
    return { data: Buffer.from(imageBuffer), contentType };
  }
}

/**
 * Serve the default (AttenDo) icon for the given size.
 */
async function getDefaultIcon(size: number): Promise<NextResponse | null> {
  try {
    const sizeName = size === 180 ? 'apple-touch-icon' : `icon-${size}x${size}`;
    const filePath = join(process.cwd(), 'public', `${sizeName}.png`);
    const fileData = await readFile(filePath);

    return new NextResponse(fileData, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        'CDN-Cache-Control': 'public, max-age=300',
      },
    });
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size: sizeStr } = await params;
  const size = Number(sizeStr);

  // Validate size parameter
  if (!isValidSize(sizeStr)) {
    return NextResponse.json(
      { error: `Invalid icon size. Valid sizes: ${VALID_SIZES.join(', ')}` },
      { status: 400 }
    );
  }

  // Check if this is a maskable icon request
  const url = new URL(request.url);
  const isMaskable = url.searchParams.get('purpose') === 'maskable';

  // Try to get institution logo
  const logoUrl = await getInstitutionLogoUrl();

  if (!logoUrl) {
    // No institution logo — serve default icon
    const defaultResponse = await getDefaultIcon(size);
    if (defaultResponse) return defaultResponse;

    return NextResponse.json(
      { error: 'Default icon not found' },
      { status: 404 }
    );
  }

  // Fetch institution logo
  const imageData = await fetchImage(logoUrl);
  if (!imageData) {
    // Failed to fetch institution logo — fall back to default
    const defaultResponse = await getDefaultIcon(size);
    if (defaultResponse) return defaultResponse;

    return NextResponse.json(
      { error: 'Icon not found' },
      { status: 404 }
    );
  }

  // Detect content type from the fetched image
  const contentType = 'image/png'; // Default, browser handles format detection

  // Resize the logo to the requested size
  const { data: resizedData, contentType: finalContentType } = await resizeImage(
    imageData,
    isMaskable ? Math.round(size * 0.8) : size, // Maskable: content in 80% safe zone
    contentType
  );

  // For maskable icons, place the resized image on a white canvas with padding
  let finalData = resizedData;
  if (isMaskable) {
    try {
      const sharp = (await import('sharp')).default;
      const canvasSize = size;
      const contentSize = resizedData.length > 0 ? size : 0;

      finalData = await sharp({
        create: {
          width: canvasSize,
          height: canvasSize,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .composite([
          {
            input: resizedData,
            blend: 'over',
          },
        ])
        .png()
        .toBuffer();
    } catch {
      // If Sharp composite fails, just use the resized image as-is
      finalData = resizedData;
    }
  }

  return new NextResponse(finalData, {
    status: 200,
    headers: {
      'Content-Type': finalContentType,
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      'CDN-Cache-Control': 'public, max-age=300',
    },
  });
}
