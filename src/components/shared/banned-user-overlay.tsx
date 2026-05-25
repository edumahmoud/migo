'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Ban, Clock, ShieldAlert, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslations } from '@/i18n/use-translations';

interface BannedUserOverlayProps {
  children: React.ReactNode;
}

export default function BannedUserOverlay({ children }: BannedUserOverlayProps) {
  const { banInfo, signOut, checkBanStatus } = useAuthStore();
  const { t, direction } = useTranslations();
  const [timeLeft, setTimeLeft] = useState('');

  // Periodically check ban status (to auto-unban when time expires)
  useEffect(() => {
    if (!banInfo) return;

    // Check ban status every 30 seconds
    const interval = setInterval(() => {
      checkBanStatus();
    }, 30000);

    return () => clearInterval(interval);
  }, [banInfo, checkBanStatus]);

  // Update countdown timer for temporary bans
  useEffect(() => {
    if (!banInfo || banInfo.isPermanent || !banInfo.banUntil) return;

    const updateCountdown = () => {
      const remaining = new Date(banInfo.banUntil!).getTime() - Date.now();
      if (remaining <= 0) {
        setTimeLeft(t('banned.expired'));
        checkBanStatus();
        return;
      }
      const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
      const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
      if (days > 0) {
        setTimeLeft(t('banned.timeDaysHoursMinutes', { days, hours, minutes }));
      } else if (hours > 0) {
        setTimeLeft(t('banned.timeHoursMinutes', { hours, minutes }));
      } else {
        setTimeLeft(t('banned.timeMinutes', { minutes }));
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 60000);
    return () => clearInterval(timer);
  }, [banInfo, checkBanStatus]);

  // If not banned, render children normally
  if (!banInfo) {
    return <>{children}</>;
  }

  // Banned user sees restricted overlay
  return (
    <div className="relative min-h-screen">
      {/* Blurred/dimmed background content */}
      <div className="pointer-events-none select-none opacity-20 blur-sm" aria-hidden="true">
        {children}
      </div>

      {/* Overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-4"
        dir={direction}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="w-full max-w-md"
        >
          <div className="rounded-2xl border border-rose-200 bg-card shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-l from-rose-500 to-rose-600 p-6 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/20 mb-4">
                <ShieldAlert className="h-10 w-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white">{t('banned.title')}</h2>
              <p className="text-rose-100 mt-2 text-sm">
                {banInfo.isPermanent ? t('banned.permanentBan') : t('banned.temporaryBan')}
              </p>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              {/* Ban reason */}
              {banInfo.reason && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-4">
                  <p className="text-sm font-medium text-rose-700 mb-1">{t('banned.reasonLabel')}</p>
                  <p className="text-sm text-rose-600">{banInfo.reason}</p>
                </div>
              )}

              {/* Ban type info */}
              <div className="rounded-lg bg-muted/50 border p-4 space-y-2">
                {banInfo.isPermanent ? (
                  <div className="flex items-center gap-3">
                    <Ban className="h-5 w-5 text-rose-500 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{t('banned.permanentBanLabel')}</p>
                      <p className="text-xs text-muted-foreground">{t('banned.permanentBanDesc')}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-amber-500 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{t('banned.temporaryBanLabel')}</p>
                      <p className="text-xs text-muted-foreground">
                        {t('banned.timeRemaining')}: <span className="font-bold text-amber-600">{timeLeft}</span>
                      </p>
                      {banInfo.banUntil && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {t('banned.endsAt')}: {new Date(banInfo.banUntil).toLocaleDateString('ar-SA', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Restrictions list */}
              <div className="rounded-lg bg-muted/30 border p-4">
                <p className="text-sm font-medium text-foreground mb-2">{t('banned.restrictionsLabel')}</p>
                <ul className="space-y-1.5">
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shrink-0" />
                    {t('banned.restrictionCourses')}
                  </li>
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shrink-0" />
                    {t('banned.restrictionRequests')}
                  </li>
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shrink-0" />
                    {t('banned.restrictionChat')}
                  </li>
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shrink-0" />
                    {t('banned.restrictionNotifications')}
                  </li>
                </ul>
              </div>

              {/* Sign out button */}
              <button
                onClick={() => signOut()}
                className="flex items-center justify-center gap-2 w-full rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 hover:bg-rose-100 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                {t('banned.signOut')}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
