'use client';

import { tr } from '@/lib/tr';
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
      if (r.ok) { toast.success(tr('تم تفعيل الدخول بالبصمة', 'Fingerprint login enabled')); setOpen(false); }
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
          <AlertDialogTitle>{tr('تفعيل الدخول بالبصمة؟', 'Enable fingerprint login?')}</AlertDialogTitle>
          <AlertDialogDescription>
            {tr('ادخل للتطبيق وأكّد حضورك بالبصمة بدل كتابة الباسورد. بصمتك تفضل على موبايلك ومش بتتخزن عندنا. تقدر توقفها أو تفعلها من الإعدادات في أي وقت.', 'Sign in and confirm attendance with your fingerprint instead of typing your password. Your fingerprint stays on your phone and is never stored by us. You can turn it off or on in Settings at any time.')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={enable} disabled={busy} className="w-full bg-gradient-to-l from-sky-700 to-teal-600 text-white">
            {tr('تفعيل', 'Enable')}
          </Button>
          <Button variant="ghost" onClick={() => { try { localStorage.setItem('attendo_bio_offer_dismissed', '1'); } catch { /* ignore */ } setOpen(false); }} disabled={busy} className="w-full">
            {tr('لاحقاً', 'Later')}
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
          <h3 className="font-semibold">{tr('هذا اختبار رسمي بالتحقق من الوجه', 'This official exam requires a face check')}</h3>
          <p className="text-sm text-muted-foreground">
            {tr('لازم تسجّل وجهك مرة واحدة. بنحفظ أرقام بس (من غير صورة)، بنستخدمها للتحقق في الاختبارات الرسمية، وبتتحذف تلقائياً بعد 12 شهر. تقدر تحذفها أي وقت من الإعدادات.', 'You need to register your face once. We only store numbers (no photo), used to verify you in official exams, and deleted automatically after 12 months. You can delete them any time in Settings.')}
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
            <span>{tr('أوافق على حفظ بصمة وجهي بالشكل ده', 'I agree to my face print being saved this way')}</span>
          </label>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={!agree} onClick={() => setPhase('enroll')}>{tr('تسجيل وجهي', 'Register my face')}</Button>
            <Button variant="outline" className="flex-1" onClick={() => finish(null, tr('لازم تتحقق بوشك عشان تفتح الاختبار', 'You must verify your face to open the exam'))}>{tr('إلغاء', 'Cancel')}</Button>
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
          if (!emb) { if (err) toast.error(err); finish(null, err || tr('لازم تسجّل وجهك عشان تفتح الاختبار', 'You must register your face to open the exam')); return; }
          const r = await faceEnroll(emb);
          if (!r.ok) { toast.error(r.error); finish(null, r.error); return; }
          toast.success(tr('تم تسجيل وجهك، كمّل التحقق', 'Face registered, continue the check'));
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
        toast.success(tr('تم إيقاف الدخول بالبصمة', 'Fingerprint login turned off'));
      } else {
        const r = await bioEnable();
        if (r.ok) { setEnabled(true); toast.success(tr('تم تفعيل الدخول بالبصمة', 'Fingerprint login enabled')); }
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
      if (ok) toast.success(tr('تم حذف بياناتك البيومترية (البصمة والوجه)', 'Your biometric data (fingerprint and face) was deleted'));
      else toast.error(tr('تعذر الحذف، حاول تاني', 'Could not delete, try again'));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {supported && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold flex items-center gap-2"><Fingerprint className="h-4 w-4 text-teal-600" />{tr('الدخول بالبصمة', 'Fingerprint login')}</p>
            <p className="text-xs text-muted-foreground">{enabled ? tr('مفعّلة على هذا الموبايل', 'Enabled on this phone') : tr('غير مفعّلة', 'Not enabled')}</p>
          </div>
          <Button type="button" variant={enabled ? 'outline' : 'default'} size="sm" onClick={toggle} disabled={busy}>
            {enabled ? tr('إيقاف', 'Turn off') : tr('تفعيل', 'Enable')}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{tr('🙂 التحقق بالوجه', '🙂 Face check')}</p>
            <p className="text-xs text-muted-foreground">{faceOn ? tr('وجهك مسجّل (للاختبارات الرسمية)', 'Your face is registered (for official exams)') : tr('غير مسجّل', 'Not registered')}</p>
          </div>
          {faceOn ? (
            <Button type="button" variant="outline" size="sm" onClick={async () => { setBusy(true); const ok = await faceDeleteAll(); setBusy(false); if (ok) { setFaceOn(false); setEnabled(false); await bioDisable(); toast.success(tr('تم حذف بيانات الوجه', 'Face data deleted')); } }} disabled={busy}>
              {tr('حذف', 'Delete')}
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => { if (consent) setCapturing(true); else toast.message(tr('وافق على الشرط تحت الأول', 'Accept the condition below first')); }} disabled={busy}>
              {tr('تسجيل', 'Register')}
            </Button>
          )}
        </div>
        {!faceOn && (
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            <span>{tr('أوافق على حفظ بصمة وجهي (أرقام فقط، من غير صورة) لاستخدامها في التحقق في الاختبارات الرسمية. بتتحذف تلقائياً بعد 12 شهر، وأقدر أحذفها أي وقت من هنا.', 'I agree to my face print being saved (numbers only, no photo) to verify me in official exams. It is deleted automatically after 12 months and I can delete it any time from here.')}</span>
          </label>
        )}
      </div>

      <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={deleteAll} disabled={busy}>
        {tr('حذف كل بياناتي البيومترية', 'Delete all my biometric data')}
      </Button>

      {capturing && (
        <FaceCapture
          mode="enroll"
          onDone={async (emb, err) => {
            setCapturing(false);
            if (!emb) { if (err) toast.error(err); return; }
            const r = await faceEnroll(emb);
            if (r.ok) { setFaceOn(true); toast.success(tr('تم تسجيل وجهك', 'Face registered')); } else toast.error(r.error);
          }}
        />
      )}
    </div>
  );
}
