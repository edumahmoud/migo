'use client';

/**
 * UsageCounter — v134k
 *
 * v134k: unified storage counter using /api/storage/check.
 * Shows free + purchased breakdown, collapsible, with upgrade button.
 *
 * For 'count' mode (summaries/quizzes): uses /api/sections/check-usage
 * as before.
 */

import { useState, useEffect } from 'react';
import {
  Loader2, AlertCircle, HardDrive, Zap, ArrowUpCircle,
  ChevronDown, ChevronUp, Sparkles,
} from 'lucide-react';
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

interface StorageData {
  free_quota: number;
  upgrade_size: number;
  total_quota: number;
  used_mb: number;
  remaining_mb: number;
  pct: number;
  is_full: boolean;
}

interface CountData {
  used: number;
  limit: number | null;
  remaining: number | null;
  canUse: boolean;
}

function formatSize(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(0)} جيجابايت`;
  return `${mb} ميجابايت`;
}

export default function UsageCounter({ sectionKey, mode = 'count', onUpgradeClick }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);

  // Storage data (from /api/storage/check)
  const [storageData, setStorageData] = useState<StorageData | null>(null);
  // Count data (from /api/sections/check-usage)
  const [countData, setCountData] = useState<CountData | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      try {
        const headers = await getCachedAuthHeaders();
        if (mode === 'storage') {
          // v134k: use the unified /api/storage/check endpoint.
          const res = await fetch('/api/storage/check', { headers });
          const json = await res.json();
          if (cancelled) return;
          if (json.success) {
            setStorageData({
              free_quota: json.free_quota ?? 0,
              upgrade_size: json.upgrade_size ?? 0,
              total_quota: json.total_quota ?? 0,
              used_mb: json.used_mb ?? 0,
              remaining_mb: json.remaining_mb ?? 0,
              pct: json.pct ?? 0,
              is_full: json.is_full ?? false,
            });
          }
        } else {
          // Count mode: use /api/sections/check-usage
          const res = await fetch(
            `/api/sections/check-usage?sectionKey=${encodeURIComponent(sectionKey)}`,
            { headers },
          );
          const json = await res.json();
          if (cancelled) return;
          if (json.success) {
            setCountData({
              used: json.used ?? 0,
              limit: json.limit ?? null,
              remaining: json.remaining ?? null,
              canUse: json.canUse ?? true,
            });
          }
        }
      } catch {
        // Silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [sectionKey, mode]);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground py-1">
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    );
  }

  // ─── Storage mode ───
  if (mode === 'storage') {
    if (!storageData || storageData.total_quota === 0) return null;

    const { free_quota, upgrade_size, total_quota, used_mb, remaining_mb, pct, is_full } = storageData;
    const isWarning = pct >= 80;
    const isCritical = is_full;
    const effectiveCollapsed = collapsed && !isCritical;

    // Collapsed: compact one-liner
    if (effectiveCollapsed) {
      return (
        <button
          onClick={() => setCollapsed(false)}
          className="w-full flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-1.5 text-xs hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <HardDrive className="h-3.5 w-3.5 text-sky-600" />
            <span className="text-muted-foreground">
              {used_mb} / {total_quota} ميجابايت · {pct}%
            </span>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      );
    }

    // Expanded
    return (
      <Card className={`border-2 ${isCritical ? 'border-rose-300' : isWarning ? 'border-amber-300' : 'border-border/60'}`}>
        <CardContent className="p-3 space-y-2">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                isCritical ? 'bg-rose-100 text-rose-600' :
                isWarning ? 'bg-amber-100 text-amber-600' :
                'bg-sky-100 text-sky-600'
              }`}>
                <HardDrive className="h-4 w-4" />
              </div>
              <span className="text-xs font-medium">مساحة التخزين</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className={`text-[9px] ${
                isCritical ? 'bg-rose-50 text-rose-700 border-rose-200' :
                isWarning ? 'bg-amber-50 text-amber-700 border-amber-200' :
                'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                {used_mb} / {total_quota} ميجابايت
              </Badge>
              {!isCritical && (
                <button onClick={() => setCollapsed(true)} className="text-muted-foreground hover:text-foreground">
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <Progress
            value={pct}
            className={`h-2 ${
              isCritical ? '[&>div]:bg-rose-500' :
              isWarning ? '[&>div]:bg-amber-500' :
              '[&>div]:bg-emerald-500'
            }`}
          />

          {/* Footer */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">{pct}% مستخدم</span>
              <Badge variant="outline" className="text-[8px] bg-emerald-50 text-emerald-700 border-emerald-200">
                مجاني: {formatSize(free_quota)}
              </Badge>
              {upgrade_size > 0 && (
                <Badge variant="outline" className="text-[8px] bg-sky-50 text-sky-700 border-sky-200">
                  <Sparkles className="h-2 w-2 me-0.5" />
                  +{formatSize(upgrade_size)}
                </Badge>
              )}
            </div>
            {isCritical ? (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-rose-600 font-medium flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  ممتلئة
                </span>
                {onUpgradeClick && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2 border-amber-300 text-amber-700 hover:bg-amber-50"
                    onClick={onUpgradeClick}
                  >
                    <ArrowUpCircle className="h-3 w-3 me-1" />
                    تزويد
                  </Button>
                )}
              </div>
            ) : (
              <span className={`text-[10px] ${isWarning ? 'text-amber-600' : 'text-emerald-600'}`}>
                تبقى {formatSize(remaining_mb)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── Count mode ───
  if (!countData || countData.limit === null) return null;

  const { used, limit, remaining, canUse } = countData;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const isWarning = pct >= 80;
  const isCritical = pct >= 100 || !canUse;

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
      <span className="text-[11px] text-muted-foreground">المحاولات المتبقية:</span>
      <Badge
        variant="outline"
        className={`text-[9px] ${
          isCritical ? 'bg-rose-50 text-rose-700 border-rose-200' :
          isWarning ? 'bg-amber-50 text-amber-700 border-amber-200' :
          'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}
      >
        {remaining} / {limit}
      </Badge>
    </div>
  );
}
