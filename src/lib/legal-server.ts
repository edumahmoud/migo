import { supabaseServer } from '@/lib/supabase-server';
import { DEFAULT_POLICY_MD } from '@/lib/legal-defaults';
import { parseLegalMd, type LegalDoc, type PolicySlug } from '@/lib/legal';

/** Returns the edited text from the DB when it exists, otherwise the built-in default. */
export async function getPolicyMd(slug: PolicySlug): Promise<string> {
  try {
    const { data, error } = await supabaseServer
      .from('legal_documents')
      .select('content_md')
      .eq('slug', slug)
      .maybeSingle();
    if (!error && data?.content_md) return data.content_md as string;
  } catch {
    // table missing or DB unreachable: fall back to the default text
  }
  return DEFAULT_POLICY_MD[slug];
}

export async function getPolicyDoc(slug: PolicySlug): Promise<LegalDoc> {
  return parseLegalMd(await getPolicyMd(slug));
}
