'use client';

import { useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { bioDisable, bioEnable, bioHasLogin, bioSupported } from '@/lib/native-bio';

/** Dialog (same look as the other app dialogs) asking to turn on fingerprint login. Opened by bioOffer(). */
export default function BioOfferDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = () => { if (bioSupported() && !bioHasLogin()) setOpen(true); };
    window.addEventListener('attendo-bio-offer', h);
    return () => window.removeEventListener('attendo-bio-offer', h);
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const r = await bioEnable();
      if (r.ok) { toast.success('تم تفعيل الدخول بالبصمة'); setOpen(false); }
      else if (r.error) toast.error(r.error);
      else setOpen(false);
    } finally { setBusy(false); }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
      <AlertDialogContent dir="rtl" className="max-w-sm text-center">
        <AlertDialogHeader className="items-center text-center sm:text-center">
          <div className="mx-auto mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-teal-600">
            <Fingerprint className="h-7 w-7" />
          </div>
          <AlertDialogTitle>تفعيل الدخول بالبصمة؟</AlertDialogTitle>
          <AlertDialogDescription>
            ادخل للتطبيق وأكّد حضورك بالبصمة بدل كتابة الباسورد. بصمتك تفضل على موبايلك ومش بتتخزن عندنا. تقدر توقفها من الإعدادات في أي وقت.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={enable} disabled={busy} className="w-full bg-gradient-to-l from-sky-700 to-teal-600 text-white">
            تفعيل
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy} className="w-full">
            لاحقاً
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Settings row: turn fingerprint login on or off on this phone (app only). */
export function BioSettingsSection() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSupported(bioSupported());
    setEnabled(bioHasLogin());
  }, []);

  if (!supported) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      if (enabled) {
        await bioDisable();
        setEnabled(false);
        toast.success('تم إيقاف الدخول بالبصمة');
      } else {
        const r = await bioEnable();
        if (r.ok) { setEnabled(true); toast.success('تم تفعيل الدخول بالبصمة'); }
        else if (r.error) toast.error(r.error);
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold flex items-center gap-2"><Fingerprint className="h-4 w-4 text-teal-600" />الدخول بالبصمة</p>
          <p className="text-xs text-muted-foreground">{enabled ? 'مفعّلة على هذا الموبايل' : 'غير مفعّلة'}</p>
        </div>
        <Button type="button" variant={enabled ? 'outline' : 'default'} size="sm" onClick={toggle} disabled={busy}>
          {enabled ? 'إيقاف' : 'تفعيل'}
        </Button>
      </div>
    </div>
  );
}
