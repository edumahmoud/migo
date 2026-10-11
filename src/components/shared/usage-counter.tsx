'use client';

/**
 * UsageCounter — v134h
 *
 * Shows a usage counter inside a section. Two modes:
 *   1. 'count' — shows "X / Y عملية متبقية" (for summaries/quizzes)
 *   2. 'storage' — shows a progress bar with "X MB / Y MB" (for files)
 *
 * v134h: when storage is full (≥100%), shows an "upgrade storage" message
 * with a button that opens the SectionLockedView (which shows monthly/
 * yearly upgrade plans).
 *
 * Fetches from /api/sections/check-usage?sectionKey=...
 * Refreshes every 30 seconds.
 */

import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, HardDrive, Zap, ArrowUpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { getCachedAuthHeaders } from '@/lib/client-auth';

interface Props {
  sectionKey: string;
  mode?: 'count' | 'storage';
  onUpgradeClick?: () => void;
}

interface UsageData {
  used: number;
  limit: number | null;
  remaining: number | null;
  locked: boolean;
  isUnlocked: boolean;
  metric: string | null;
  canUse: boolean;
}

export default function UsageCounter({ sectionKey, mode = 'count', onUpgradeClick }: Props) {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchUsage = async () => {
      try {
        const res = await fetch(
          `/api/sections/check-usage?sectionKey=${encodeURIComponent(sectionKey)}`,
          { headers: await getCachedAuthHeaders() },
        );
        const json = await res.json();
        if (cancelled) return;
        if (json.success) {
          setData({
            used: json.used ?? 0,
            limit: json.limit ?? null,
            remaining: json.remaining ?? null,
            locked: json.locked ?? false,
            isUnlocked: json.isUnlocked ?? false,
            metric: json.metric ?? null,
            canUse: json.canUse ?? true,
          });
        }
      } catch {
        // Silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchUsage();
    const interval = setInterval(fetchUsage, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [sectionKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground py-1">
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    );
  }

  if (!data || data.limit === null) {
    return null;
  }

  const { used, limit, remaining, canUse } = data;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const isWarning = pct >= 80;
  const isCritical = pct >= 100;

  // ─── Storage mode (MB with progress bar) ───
  if (mode === 'storage') {
    return (
      <Card className="border-border/60">
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5 text-sky-600" />
              <span className="text-xs font-medium">المساحة المستخدمة</span>
            </div>
            <Badge
              variant="outline"
              className={`text-[9px] ${
                isCritical
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : isWarning
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              {used} / {limit} ميجابايت
            </Badge>
          </div>
          <Progress
            value={pct}
            className={`h-2 ${isCritical ? '[&>div]:bg-rose-500' : isWarning ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500'}`}
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-muted-foreground">
              {Math.round(pct)}% مستخدم
            </span>
            {isCritical ? (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-rose-600 font-medium flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  المساحة ممتلئة
                </span>
                {onUpgradeClick && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2 border-amber-300 text-amber-700 hover:bg-amber-50"
                    onClick={onUpgradeClick}
                  >
                    <ArrowUpCircle className="h-3 w-3 me-1" />
                    تزويد المساحة
                  </Button>
                )}
              </div>
            ) : isWarning ? (
              <span className="text-[10px] text-amber-600">
                تبقى {remaining} ميجابايت
              </span>
            ) : (
              <span className="text-[10px] text-emerald-600">
                تبقى {remaining} ميجابايت
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── Count mode (attempts) ───
  if (!canUse) {
    return (
      <div className="flex items-center gap-2 py-1">
        <Zap className="h-3.5 w-3.5 text-rose-500 shrink-0" />
        <span className="text-[11px] text-rose-600 font-medium">
          لقد وصلت إلى الحد الأقصى ({limit} عملية)
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1">
      <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
      <span className="text-[11px] text-muted-foreground">
        المحاولات المتبقية:
      </span>
      <Badge
        variant="outline"
        className={`text-[9px] ${
          isCritical
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : isWarning
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}
      >
        {remaining} / {limit}
      </Badge>
    </div>
  );
}
