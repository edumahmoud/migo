import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

// v132c: reduced cache TTL from 5 minutes to 30 seconds so logo
// changes propagate faster to existing PWA installs.
let cachedInstitution: {
  name: string | null;
  name_en: string | null;
  tagline: string | null;
  logo_url: string | null;
} | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 30 * 1000; // 30 seconds (was 5 minutes)

/** v132c: Clear the in-memory cache. Called when the admin saves
 *  new institution data (via POST to this endpoint). */
export function clearInstitutionCache() {
  cachedInstitution = null;
  cacheExpiry = 0;
}

async function getInstitutionData() {
  const now = Date.now();
  if (cachedInstitution && now < cacheExpiry) {
    return cachedInstitution;
  }

  try {
    const { data, error } = await supabaseServer
      .from('institution_settings')
      .select('name, name_en, tagline, logo_url')
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      cachedInstitution = {
        name: null,
        name_en: null,
        tagline: null,
        logo_url: null,
      };
    } else {
      cachedInstitution = {
        name: data.name,
        name_en: data.name_en,
        tagline: data.tagline,
        logo_url: data.logo_url,
      };
    }

    cacheExpiry = now + CACHE_TTL;
    return cachedInstitution;
  } catch {
    return {
      name: null,
      name_en: null,
      tagline: null,
      logo_url: null,
    };
  }
}

// v132c: POST handler — clears the in-memory cache so the next GET
// refetches from the DB. Called by the admin institution settings
// page after a successful save.
export async function POST(request: NextRequest) {
  // Simple auth check: require the request to have an Authorization
  // header (the admin frontend always sends one).
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  clearInstitutionCache();
  // Also clear the icon route's cache by importing its clear function.
  // We use a dynamic import to avoid a circular dependency.
  try {
    const iconModule = await import('@/app/api/icon/[size]/route') as unknown as Record<string, unknown>;
    if (typeof iconModule.clearIconCache === 'function') {
      (iconModule.clearIconCache as () => void)();
    }
  } catch {
    // Non-critical — the 30s TTL will expire naturally.
  }
  return NextResponse.json({ success: true, invalidated: true });
}

export async function GET() {
  const institution = await getInstitutionData();

  const displayName = institution.name || 'أتيندو';
  const shortName = institution.name
    ? institution.name.length > 12
      ? institution.name.substring(0, 12)
      : institution.name
    : 'أتيندو';
  const description = institution.tagline
    ? `${displayName} - ${institution.tagline}`
    : 'منصة تعليمية ذكية مدعومة بالذكاء الاصطناعي للطلاب والمعلمين';

  // v132c: cache-bust parameter for icon URLs. When the admin changes
  // the logo, the logo_url changes, which changes this param, which
  // forces the browser to treat the icon URLs as NEW resources and
  // refetch them (bypassing the browser cache). This is what makes
  // the PWA icon update without requiring reinstall.
  //
  // We use a simple hash of the logo_url (or a fallback timestamp)
  // so the value is stable across requests for the same logo, but
  // changes when the logo changes.
  const logoBust = institution.logo_url
    ? `?v=${encodeURIComponent(institution.logo_url).slice(0, 40)}`
    : '';

  const manifest = {
    name: `${displayName} - منصة تعليمية ذكية`,
    short_name: shortName,
    description,
    // CRITICAL: start_url must be '/' with a restore hint so the app knows
    // it was launched by Android process restore (not a fresh user visit).
    // The app checks for ?pwa=1 to skip the full auth loading spinner.
    start_url: '/?pwa=1',
    display: 'standalone' as const,
    orientation: 'portrait' as const,
    dir: 'rtl' as const,
    lang: 'ar',
    theme_color: '#0369a1',
    background_color: '#ffffff',
    scope: '/',
    icons: [
      {
        // v132c: append cache-bust param so icon updates propagate
        src: `/api/icon/192${logoBust}`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `/api/icon/512${logoBust}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        // maskable icons need the purpose query — combine with cache-bust
        src: `/api/icon/512?purpose=maskable${logoBust ? '&' + logoBust.slice(1) : ''}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    categories: ['education', 'productivity'],
    shortcuts: [
      {
        name: 'المقررات',
        short_name: 'المقررات',
        url: '/?section=subjects',
        icons: [{ src: `/api/icon/192${logoBust}`, sizes: '192x192' }],
      },
      {
        name: 'المحادثات',
        short_name: 'المحادثات',
        url: '/?section=chat',
        icons: [{ src: `/api/icon/192${logoBust}`, sizes: '192x192' }],
      },
      {
        name: 'الإشعارات',
        short_name: 'الإشعارات',
        url: '/?section=notifications',
        icons: [{ src: `/api/icon/192${logoBust}`, sizes: '192x192' }],
      },
    ],
  };

  // v132c: reduced max-age from 300 to 60 so the browser refetches
  // the manifest more often (every 1 minute instead of 5).
  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  });
}
