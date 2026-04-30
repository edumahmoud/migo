import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

// Cache institution data for 5 minutes
let cachedInstitution: {
  name: string | null;
  name_en: string | null;
  tagline: string | null;
  logo_url: string | null;
} | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

  const manifest = {
    name: `${displayName} - منصة تعليمية ذكية`,
    short_name: shortName,
    description,
    start_url: '/',
    display: 'standalone' as const,
    orientation: 'portrait-primary' as const,
    dir: 'rtl' as const,
    lang: 'ar',
    theme_color: '#059669',
    background_color: '#ffffff',
    scope: '/',
    icons: [
      {
        src: '/api/icon/192',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/api/icon/512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/api/icon/512?purpose=maskable',
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
        icons: [{ src: '/api/icon/192', sizes: '192x192' }],
      },
      {
        name: 'المحادثات',
        short_name: 'المحادثات',
        url: '/?section=chat',
        icons: [{ src: '/api/icon/192', sizes: '192x192' }],
      },
      {
        name: 'الإشعارات',
        short_name: 'الإشعارات',
        url: '/?section=notifications',
        icons: [{ src: '/api/icon/192', sizes: '192x192' }],
      },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
}
