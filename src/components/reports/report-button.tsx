'use client';

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, X, Send, Loader2, ImagePlus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { ReportTargetType } from '@/lib/types';

// -------------------------------------------------------
// Report reasons
// -------------------------------------------------------
const REPORT_REASONS = [
  { value: 'inappropriate', label: 'محتوى غير مناسب' },
  { value: 'harassment', label: 'تحرش أو تنمر' },
  { value: 'spam', label: 'رسائل مزعجة' },
  { value: 'misinformation', label: 'معلومات مضللة' },
  { value: 'cheating', label: 'غش أكاديمي' },
  { value: 'other', label: 'سبب آخر' },
];

function getReasonLabel(value: string): string {
  return REPORT_REASONS.find((r) => r.value === value)?.label || value;
}

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface ReportButtonProps {
  targetType: ReportTargetType;
  targetId: string;
  /** Small icon-only button (for message/comment context menus) */
  compact?: boolean;
  className?: string;
  onReported?: () => void;
}

// -------------------------------------------------------
// Attachment type
// -------------------------------------------------------
interface Attachment {
  url: string;
  name: string;
  type: string;
}

// -------------------------------------------------------
// Component
// -------------------------------------------------------
export default function ReportButton({ targetType, targetId, compact, className, onReported }: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const remaining = 3 - attachments.length;
    if (remaining <= 0) {
      toast.error('الحد الأقصى 3 صور');
      return;
    }

    const filesToUpload = Array.from(files).slice(0, remaining);
    setUploading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      for (const file of filesToUpload) {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/reports/upload-evidence', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: formData,
        });

        const result = await res.json();
        if (result.success) {
          setAttachments((prev) => [...prev, {
            url: result.data.url,
            name: result.data.name,
            type: result.data.type,
          }]);
        } else {
          toast.error(result.error || 'فشل رفع الصورة');
        }
      }
    } catch {
      toast.error('حدث خطأ أثناء رفع الصور');
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!reason) {
      toast.error('يرجى اختيار سبب الإبلاغ');
      return;
    }

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          reason,
          description: description.trim() || undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        }),
      });

      const result = await res.json();
      if (result.success) {
        toast.success('تم إرسال الإبلاغ وسيتم مراجعته');
        setOpen(false);
        setReason('');
        setDescription('');
        setAttachments([]);
        setConfirming(false);
        onReported?.();
      } else {
        toast.error(result.error || 'فشل إرسال الإبلاغ');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => { setOpen(true); setConfirming(false); }}
        className={`text-muted-foreground hover:text-rose-500 transition-colors ${compact ? 'p-1' : 'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs'} ${className || ''}`}
        title="إبلاغ"
      >
        <ShieldAlert className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        {!compact && <span>إبلاغ</span>}
      </button>

      {/* Modal */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => { setOpen(false); setConfirming(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-rose-500" />
                  <h3 className="text-base font-bold text-foreground">إبلاغ</h3>
                </div>
                <button onClick={() => { setOpen(false); setConfirming(false); }} className="p-1 rounded-md hover:bg-muted transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {!confirming ? (
                <>
                  {/* Reason selection */}
                  <div className="space-y-2 mb-4">
                    <label className="text-sm font-medium text-foreground">سبب الإبلاغ</label>
                    <div className="grid grid-cols-2 gap-2">
                      {REPORT_REASONS.map((r) => (
                        <button
                          key={r.value}
                          onClick={() => setReason(r.value)}
                          className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors text-start ${
                            reason === r.value
                              ? 'border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300'
                              : 'border-border bg-background text-muted-foreground hover:border-rose-200 dark:hover:border-rose-800'
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Description */}
                  <div className="space-y-2 mb-4">
                    <label className="text-sm font-medium text-foreground">تفاصيل إضافية (اختياري)</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="اشرح المشكلة بمزيد من التفصيل..."
                      rows={3}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-rose-500"
                    />
                  </div>

                  {/* Image evidence upload */}
                  <div className="space-y-2 mb-4">
                    <label className="text-sm font-medium text-foreground">صور إثبات (اختياري — حتى 3 صور)</label>

                    {/* Attachments preview */}
                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {attachments.map((att, i) => (
                          <div key={i} className="relative group rounded-lg overflow-hidden border border-border h-16 w-16">
                            <img src={att.url} alt={att.name} className="h-full w-full object-cover" />
                            <button
                              onClick={() => removeAttachment(i)}
                              className="absolute top-0.5 left-0.5 p-0.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading || attachments.length >= 3}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border bg-background text-xs text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                      {uploading ? 'جاري الرفع...' : 'إضافة صور'}
                    </button>
                  </div>

                  {/* Next: Confirm step */}
                  <button
                    onClick={() => setConfirming(true)}
                    disabled={!reason}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-50 transition-colors"
                  >
                    التالي
                  </button>
                </>
              ) : (
                <>
                  {/* Confirmation step */}
                  <div className="space-y-4 mb-4">
                    <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">السبب:</span>
                        <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">{getReasonLabel(reason)}</span>
                      </div>
                      {description.trim() && (
                        <div>
                          <span className="text-xs font-medium text-muted-foreground">التفاصيل:</span>
                          <p className="text-sm text-foreground mt-1 whitespace-pre-wrap">{description.trim()}</p>
                        </div>
                      )}
                      {attachments.length > 0 && (
                        <div>
                          <span className="text-xs font-medium text-muted-foreground">الصور المرفقة:</span>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {attachments.map((att, i) => (
                              <div key={i} className="rounded-lg overflow-hidden border border-border h-12 w-12">
                                <img src={att.url} alt={att.name} className="h-full w-full object-cover" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground text-center">
                      هل أنت متأكد من إرسال هذا الإبلاغ؟
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setConfirming(false)}
                      className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-background text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                    >
                      رجوع
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-50 transition-colors"
                    >
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      تأكيد الإبلاغ
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
