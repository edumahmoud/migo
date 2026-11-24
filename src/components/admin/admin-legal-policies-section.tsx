'use client';

/**
 * Admin: edit the three legal pages (terms / refund / privacy) and export them as PDF.
 * Text is simplified Markdown, saved in public.legal_documents. "Reset" returns to the built-in default.
 * PDF export opens the public page with ?pdf=1, which opens the browser print dialog (Save as PDF).
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, RotateCcw, ExternalLink, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { POLICY_LABELS, POLICY_SLUGS, type PolicySlug } from '@/lib/legal';

interface Row { slug: PolicySlug; content_md: string; is_custom: boolean; updated_at: string | null }

export default function AdminLegalPoliciesSection() {
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState<PolicySlug>('terms');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tableReady, setTableReady] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/legal-documents', { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) {
        setRows(json.data);
        setTableReady(json.table_ready !== false);
        setDrafts(Object.fromEntries((json.data as Row[]).map((r) => [r.slug, r.content_md])));
      } else {
        toast.error(json.error || 'تعذر تحميل الصفحات');
      }
    } catch {
      toast.error('حصل خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const row = rows.find((r) => r.slug === active);
  const draft = drafts[active] ?? '';
  const dirty = !!row && draft !== row.content_md;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/legal-documents', {
        method: 'PUT',
        headers: { ...(await getCachedAuthHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: active, content_md: draft }),
      });
      const json = await res.json();
      if (json.success) { toast.success('تم الحفظ، الصفحة اتحدثت'); await load(); }
      else toast.error(json.error || 'فشل الحفظ');
    } catch {
      toast.error('حصل خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm('الرجوع للنص الافتراضي؟ هيتم مسح تعديلاتك على الصفحة دي.')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/legal-documents?slug=${active}`, {
        method: 'DELETE',
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) { toast.success('اتسترجع النص الافتراضي'); await load(); }
      else toast.error(json.error || 'فشل');
    } catch {
      toast.error('حصل خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-sky-600" /></div>;
  }

  return (
    <div className="space-y-4" dir="rtl">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">الصفحات القانونية</CardTitle>
          <p className="text-sm text-gray-500">
            عدّل النص (الإيميل، أي بند، إضافة بنود) واضغط حفظ. التعديل بيظهر فوراً للمستخدمين.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!tableReady && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              الحفظ مش شغال لسه: جدول legal_documents مش موجود (migration v140).
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {POLICY_SLUGS.map((s) => {
              const r = rows.find((x) => x.slug === s);
              return (
                <Button key={s} type="button" size="sm" variant={active === s ? 'default' : 'outline'} onClick={() => setActive(s)}>
                  {POLICY_LABELS[s]}
                  {r?.is_custom && <Badge variant="secondary" className="mr-2">معدّل</Badge>}
                </Button>
              );
            })}
          </div>

          <Textarea
            value={draft}
            onChange={(e) => setDrafts((d) => ({ ...d, [active]: e.target.value }))}
            dir="rtl"
            spellCheck={false}
            className="min-h-[460px] font-mono text-sm leading-7"
          />

          <p className="text-xs text-gray-400 leading-6">
            التنسيق: سطر يبدأ بـ # هو العنوان، وسطر يبدأ بـ ## هو عنوان بند، وسطر يبدأ بـ - هو نقطة في قائمة،
            و**كلمة** بين نجمتين تطلع بخط عريض. أي سطر عادي هو فقرة. سطر «آخر تحديث» بيتحدث تلقائياً عند الحفظ.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={save} disabled={saving || !dirty || !tableReady}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              <span>حفظ</span>
            </Button>
            <Button type="button" variant="outline" onClick={reset} disabled={saving || !row?.is_custom}>
              <RotateCcw className="h-4 w-4" />
              <span>الرجوع للنص الافتراضي</span>
            </Button>
            <Button type="button" variant="outline" asChild>
              <a href={`/${active}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                <span>فتح الصفحة</span>
              </a>
            </Button>
            <Button type="button" variant="outline" asChild>
              <a href={`/${active}?pdf=1`} target="_blank" rel="noreferrer">
                <FileDown className="h-4 w-4" />
                <span>تصدير PDF</span>
              </a>
            </Button>
          </div>
          {dirty && <p className="text-xs text-amber-600">فيه تعديلات لسه متحفظتش. التصدير بيطلع آخر نسخة محفوظة.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
