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
import { FaceCapture } from '@/components/shared/face-capture';
import { faceDeleteAll, faceEnroll, faceStatus, faceVerifyForExam } from '@/lib/face-client';

/** Dialog (same look as the other app dialogs) asking to turn on fingerprint login. Opened by bioOffer(). */
export default function BioOfferDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = () => {
      let dismissed = false;
      try { dismissed = localStorage.getItem('attendo_bio_offer_dismissed') === '1'; } catch { /* ignore */ }
      if (!dismissed && bioSupported() && !bioHasLogin()) setOpen(true);
    };
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
    <>
    <FaceGateDialog />
    <AlertDialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
      <AlertDialogContent dir="rtl" className="max-w-sm text-center">
        <AlertDialogHeader className="items-center text-center sm:text-center">
          <div className="mx-auto mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-teal-600">
            <Fingerprint className="h-7 w-7" />
          </div>
          <AlertDialogTitle>تفعيل الدخول بالبصمة؟</AlertDialogTitle>
          <AlertDialogDescription>
            ادخل للتطبيق وأكّد حضورك بالبصمة بدل كتابة الباسورد. بصمتك تفضل على موبايلك ومش بتتخزن عندنا. تقدر توقفها أو تفعلها من الإعدادات في أي وقت.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={enable} disabled={busy} className="w-full bg-gradient-to-l from-sky-700 to-teal-600 text-white">
            تفعيل
          </Button>
          <Button variant="ghost" onClick={() => { try { localStorage.setItem('attendo_bio_offer_dismissed', '1'); } catch { /* ignore */ } setOpen(false); }} disabled={busy} className="w-full">
            لاحقاً
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

/** Official exam with camera check: runs the live face check and hands the server's pass to the exam screen.
 *  First time (no face saved): asks for consent, records the face, then runs the check, all in one flow. */
function FaceGateDialog() {
  const [quizId, setQuizId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'verify' | 'consent' | 'enroll'>('verify');
  const [agree, setAgree] = useState(false);
  useEffect(() => {
    const h = (e: Event) => { setQuizId((e as CustomEvent<{ quizId: string }>).detail?.quizId ?? null); setPhase('verify'); setAgree(false); };
    window.addEventListener('attendo-face-gate', h);
    return () => window.removeEventListener('attendo-face-gate', h);
  }, []);
  if (!quizId) return null;
  const finish = (pass: string | null, error?: string) => {
    window.dispatchEvent(new CustomEvent('attendo-face-pass', { detail: { quizId, pass, error } }));
    setQuizId(null);
  };

  if (phase === 'consent') {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" dir="rtl">
        <div className="w-full max-w-sm space-y-3 rounded-2xl bg-card p-5 shadow-xl">
          <h3 className="font-semibold">هذا اختبار رسمي بالتحقق من الوجه</h3>
          <p className="text-sm text-muted-foreground">
            لازم تسجّل وجهك مرة واحدة. بنحفظ أرقام بس (من غير صورة)، بنستخدمها للتحقق في الاختبارات الرسمية، وبتتحذف تلقائياً بعد 12 شهر. تقدر تحذفها أي وقت من الإعدادات.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
            <span>أوافق على حفظ بصمة وجهي بالشكل ده</span>
          </label>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={!agree} onClick={() => setPhase('enroll')}>تسجيل وجهي</Button>
            <Button variant="outline" className="flex-1" onClick={() => finish(null, 'لازم تتحقق بوشك عشان تفتح الاختبار')}>إلغاء</Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'enroll') {
    return (
      <FaceCapture
        key="enroll"
        mode="enroll"
        onDone={async (emb, err) => {
          if (!emb) { if (err) toast.error(err); finish(null, err || 'لازم تسجّل وجهك عشان تفتح الاختبار'); return; }
          const r = await faceEnroll(emb);
          if (!r.ok) { toast.error(r.error); finish(null, r.error); return; }
          toast.success('تم تسجيل وجهك، كمّل التحقق');
          setPhase('verify');
        }}
      />
    );
  }

  return (
    <FaceCapture
      key="verify"
      mode="verify"
      onDone={async (emb, err) => {
        if (!emb) { if (err) toast.error(err); finish(null, err); return; }
        const r = await faceVerifyForExam(quizId, emb[0]);
        if (r.ok) finish(r.pass);
        else if (r.code === 'not_enrolled') setPhase('consent');
        else { toast.error(r.error); finish(null, r.error); }
      }}
    />
  );
}

/** Settings: fingerprint login (app only), face data (enroll / delete), and delete all biometric data. */
export function BioSettingsSection() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [faceOn, setFaceOn] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    setSupported(bioSupported());
    setEnabled(bioHasLogin());
    void faceStatus().then(setFaceOn).catch(() => {});
  }, []);

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

  const deleteAll = async () => {
    setBusy(true);
    try {
      await bioDisable();
      const ok = await faceDeleteAll();
      setEnabled(false);
      setFaceOn(false);
      if (ok) toast.success('تم حذف بياناتك البيومترية (البصمة والوجه)');
      else toast.error('تعذر الحذف، حاول تاني');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {supported && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold flex items-center gap-2"><Fingerprint className="h-4 w-4 text-teal-600" />الدخول بالبصمة</p>
            <p className="text-xs text-muted-foreground">{enabled ? 'مفعّلة على هذا الموبايل' : 'غير مفعّلة'}</p>
          </div>
          <Button type="button" variant={enabled ? 'outline' : 'default'} size="sm" onClick={toggle} disabled={busy}>
            {enabled ? 'إيقاف' : 'تفعيل'}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">🙂 التحقق بالوجه</p>
            <p className="text-xs text-muted-foreground">{faceOn ? 'وجهك مسجّل (للاختبارات الرسمية)' : 'غير مسجّل'}</p>
          </div>
          {faceOn ? (
            <Button type="button" variant="outline" size="sm" onClick={async () => { setBusy(true); const ok = await faceDeleteAll(); setBusy(false); if (ok) { setFaceOn(false); setEnabled(false); await bioDisable(); toast.success('تم حذف بيانات الوجه'); } }} disabled={busy}>
              حذف
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => { if (consent) setCapturing(true); else toast.message('وافق على الشرط تحت الأول'); }} disabled={busy}>
              تسجيل
            </Button>
          )}
        </div>
        {!faceOn && (
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            <span>أوافق على حفظ بصمة وجهي (أرقام فقط، من غير صورة) لاستخدامها في التحقق في الاختبارات الرسمية. بتتحذف تلقائياً بعد 12 شهر، وأقدر أحذفها أي وقت من هنا.</span>
          </label>
        )}
      </div>

      <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={deleteAll} disabled={busy}>
        حذف كل بياناتي البيومترية
      </Button>

      {capturing && (
        <FaceCapture
          mode="enroll"
          onDone={async (emb, err) => {
            setCapturing(false);
            if (!emb) { if (err) toast.error(err); return; }
            const r = await faceEnroll(emb);
            if (r.ok) { setFaceOn(true); toast.success('تم تسجيل وجهك'); } else toast.error(r.error);
          }}
        />
      )}
    </div>
  );
}
