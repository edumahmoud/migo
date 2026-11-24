import { supabaseServer } from '@/lib/supabase-server';
import { DEFAULT_POLICY_MD } from '@/lib/legal-defaults';
import { parseLegalMd, applyContactEmail, DEFAULT_CONTACT_EMAIL, type LegalDoc, type PolicySlug } from '@/lib/legal';

/** Current contact email (single source of truth, legal_settings), with a built-in fallback. */
export async function getContactEmail(): Promise<string> {
  try {
    const { data, error } = await supabaseServer
      .from('legal_settings')
      .select('value')
      .eq('key', 'contact_email')
      .maybeSingle();
    if (!error && data?.value) return data.value as string;
  } catch {
    // table missing or DB unreachable: fall back to the default email
  }
  return DEFAULT_CONTACT_EMAIL;
}

/** Raw text (edited text from the DB when it exists, otherwise the built-in default), placeholders intact. */
export async function getPolicyRawMd(slug: PolicySlug): Promise<string> {
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

/** Text as shown to the public: placeholders replaced with the current contact email. */
export async function getPolicyMd(slug: PolicySlug): Promise<string> {
  const [md, email] = await Promise.all([getPolicyRawMd(slug), getContactEmail()]);
  return applyContactEmail(md, email);
}

export async function getPolicyDoc(slug: PolicySlug): Promise<LegalDoc> {
  return parseLegalMd(await getPolicyMd(slug));
}
