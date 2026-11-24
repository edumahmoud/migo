// Shared (client + server) helpers for the legal pages.
// Policy text is stored as simplified Markdown:
//   "# title", "آخر تحديث: ...", "## section heading", paragraphs, "- bullet" lines, **bold**.

export type PolicySlug = 'terms' | 'refund' | 'privacy';
export const POLICY_SLUGS: PolicySlug[] = ['terms', 'refund', 'privacy'];

export const POLICY_LABELS: Record<PolicySlug, string> = {
  terms: 'شروط الاستخدام',
  refund: 'سياسة الاسترجاع',
  privacy: 'سياسة الخصوصية وحماية البيانات',
};

export type LegalBlock =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] };

export interface LegalSection {
  heading: string;
  blocks: LegalBlock[];
}

export interface LegalDoc {
  title: string;
  updatedAt: string;
  sections: LegalSection[];
}

export function isPolicySlug(v: unknown): v is PolicySlug {
  return v === 'terms' || v === 'refund' || v === 'privacy';
}

export function parseLegalMd(md: string): LegalDoc {
  let title = '';
  let updatedAt = '';
  const sections: LegalSection[] = [];
  let cur: LegalSection | null = null;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith('## ')) {
      cur = { heading: line.slice(3).trim(), blocks: [] };
      sections.push(cur);
      continue;
    }
    if (line.startsWith('# ')) { title = line.slice(2).trim(); continue; }
    if (line.startsWith('آخر تحديث')) { updatedAt = line.trim(); continue; }
    if (line.startsWith('> ')) continue; // editor notes, never shown
    if (!cur) continue;
    if (line.startsWith('- ')) {
      const last = cur.blocks[cur.blocks.length - 1];
      if (last && last.type === 'ul') last.items.push(line.slice(2).trim());
      else cur.blocks.push({ type: 'ul', items: [line.slice(2).trim()] });
      continue;
    }
    cur.blocks.push({ type: 'p', text: line.trim() });
  }
  return { title, updatedAt, sections };
}

/** Sets (or inserts, right after the title) the "آخر تحديث" line. */
export function withUpdatedDate(md: string, date: Date): string {
  const label = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
  const line = `آخر تحديث: ${label}`;
  if (/^آخر تحديث.*$/m.test(md)) return md.replace(/^آخر تحديث.*$/m, line);
  const m = md.match(/^# .*$/m);
  if (m && m.index !== undefined) {
    const end = m.index + m[0].length;
    return `${md.slice(0, end)}\n\n${line}${md.slice(end)}`;
  }
  return `${line}\n\n${md}`;
}

export function validateLegalMd(md: string): string | null {
  if (typeof md !== 'string' || md.trim().length < 20) return 'النص قصير جداً';
  if (md.length > 100_000) return 'النص طويل جداً';
  if (!/^# .+/m.test(md)) return 'لازم يبدأ النص بعنوان (سطر يبدأ بـ #)';
  if (!/^## .+/m.test(md)) return 'لازم يحتوي على بند واحد على الأقل (سطر يبدأ بـ ##)';
  return null;
}
