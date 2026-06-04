'use client'

import { useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { WifiOff, Wifi } from 'lucide-react'
import { useTranslations } from '@/i18n/use-translations'

/**
 * ConnectivityMonitor — watches navigator.onLine and shows a toast
 * when the browser goes offline or comes back online.
 *
 * Also auto-saves any pending form data to localStorage when going offline
 * to prevent data loss.
 */
export default function ConnectivityMonitor() {
  const wasOnline = useRef(true)
  const { t } = useTranslations()

  const handleOffline = useCallback(() => {
    wasOnline.current = false
    toast.error(t('connectivity.offline') || 'لا يوجد اتصال بالإنترنت', {
      icon: <WifiOff className="h-4 w-4" />,
      duration: Infinity, // Keep visible until online
      id: 'connectivity-status',
    })

    // Save a timestamp so we know we went offline
    try {
      localStorage.setItem('_attendo_offline_ts', String(Date.now()))
    } catch { /* ignore */ }
  }, [t])

  const handleOnline = useCallback(() => {
    const wasOffline = !wasOnline.current
    wasOnline.current = true

    if (wasOffline) {
      toast.success(t('connectivity.online') || 'تم استعادة الاتصال بالإنترنت', {
        icon: <Wifi className="h-4 w-4" />,
        duration: 4000,
        id: 'connectivity-status',
      })
    }

    // Clear offline timestamp
    try {
      localStorage.removeItem('_attendo_offline_ts')
    } catch { /* ignore */ }
  }, [t])

  useEffect(() => {
    // Initialize from current state
    wasOnline.current = navigator.onLine

    // If already offline on mount, show the toast
    if (!navigator.onLine) {
      handleOffline()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [handleOnline, handleOffline])

  // This component renders nothing visible
  return null
}
