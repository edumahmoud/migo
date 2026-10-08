'use client';

/**
 * StudentSuspensionOverlay — v115
 *
 * Wraps the student dashboard. On mount, fetches the student's
 * active suspensions from /api/student/suspensions.
 *
 * If a GLOBAL suspension is active → render a full-screen overlay
 * blocking access to the dashboard (similar to BannedUserOverlay
 * but for the softer "suspension" system rather than the hard "ban").
 *
 * If only course-scoped suspensions are active → render the dashboard
 * normally. The per-course suspension UI is handled inside the
 * subjects section when the student tries to open a suspended course.
 */

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Ban, Clock, ShieldAlert, LogOut, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslations } from '@/i18n/use-translations';
import { getCachedAuthHeaders } from '@/lib/client-auth';

interface SuspensionInfo {
  id: string;
  reason: string | null;
  suspended_at: string;
  expires_at: string | null;
}

interface StudentSuspensionOverlayProps {
  children: React.ReactNode;
}

export default function StudentSuspensionOverlay({ children }: StudentSuspensionOverlayProps) {
  const { t, direction } = useTranslations();
  const { signOut } = useAuthStore();
  const [globalSuspension, setGlobalSuspension] = useState<SuspensionInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [timeLeft, setTimeLeft] = useState('');

  const fetchSuspensions = useCallback(async () => {
    try {
      const res = await fetch('/api/student/suspensions', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        setGlobalSuspension(json.global ?? null);
      } else {
        setGlobalSuspension(null);
      }
    } catch {
      // Network error — don't block the dashboard if we can't check.
      setGlobalSuspension(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    fetchSuspensions();
    // Poll every 60 seconds — picks up new suspensions + lifts expired ones.
    const interval = setInterval(fetchSuspensions, 60_000);
    return () => clearInterval(interval);
  }, [fetchSuspensions]);

  // Countdown timer for temporary suspensions
  useEffect(() => {
    if (!globalSuspension || !globalSuspension.expires_at) {
      setTimeLeft('');
      return;
    }
    const update = () => {
      const remaining = new Date(globalSuspension.expires_at!).getTime() - Date.now();
      if (remaining <= 0) {
        setTimeLeft('انتهت المدة — يتم التحقق...');
        fetchSuspensions();
        return;
      }
      const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
      const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
      if (days > 0) {
        setTimeLeft(`${days} يوم و ${hours} ساعة و ${minutes} دقيقة`);
      } else if (hours > 0) {
        setTimeLeft(`${hours} ساعة و ${minutes} دقيقة`);
      } else {
        setTimeLeft(`${minutes} دقيقة`);
      }
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [globalSuspension, fetchSuspensions]);

  // While we're still checking on first mount, render children — better
  // UX than a flash of "suspended" if there's a network hiccup.
  if (checking) return <>{children}</>;

  if (!globalSuspension) return <>{children}</>;

  const reason = globalSuspension.reason ?? 'لا يوجد سبب محدد';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" dir={direction}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="max-w-md w-full rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 shadow-2xl p-6 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 200 }}
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900"
        >
          <Ban className="h-9 w-9 text-amber-700 dark:text-amber-300" />
        </motion.div>

        <h2 className="text-xl font-bold text-amber-900 dark:text-amber-100 mb-1">
          تم إيقاف حسابك مؤقتاً
        </h2>
        <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">
          تم تعليق وصولك إلى المنصة من قبل المشرف. هذا الإيقاف مؤقت ويمكن رفعه.
        </p>

        <div className="rounded-md bg-amber-100 dark:bg-amber-900/50 px-3 py-2 text-xs space-y-1 mb-4 text-amber-900 dark:text-amber-100">
          <div className="flex items-center justify-center gap-1">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>السبب: {reason}</span>
          </div>
          {globalSuspension.expires_at ? (
            <div className="flex items-center justify-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              <span>الوقت المتبقي: {timeLeft || '...'}</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              <span>إيقاف غير محدد المدة — تواصل مع المشرف</span>
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-center">
          <Button
            variant="outline"
            onClick={fetchSuspensions}
            className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
          >
            <RefreshCw className="h-4 w-4 me-1" />
            إعادة التحقق
          </Button>
          <Button
            variant="destructive"
            onClick={() => signOut()}
            className="bg-rose-600 hover:bg-rose-700"
          >
            <LogOut className="h-4 w-4 me-1" />
            تسجيل الخروج
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
