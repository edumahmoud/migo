'use client';

/**
 * Teacher Financial Management Section — Consolidated Umbrella
 *
 * Replaces the 3 separate financial nav items (financial,
 * payoutMethods, payoutHistory) with a single "الإيرادات المالية"
 * section containing internal tabs.
 *
 * Each tab renders the EXISTING component (no rewriting):
 *   - Tab 1: الإيرادات (TeacherFinancialSection)
 *   - Tab 2: طرق الاستلام (TeacherPayoutMethodsSection)
 *   - Tab 3: سجل المدفوعات (TeacherPayoutsSection)
 */

import { useState, useEffect } from 'react';
import { DollarSign, Wallet, Receipt } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import { Button } from '@/components/ui/button';
import TeacherFinancialSection from '@/components/teacher/teacher-financial-section';
import TeacherPayoutMethodsSection from '@/components/teacher/teacher-payout-methods-section';
import TeacherPayoutsSection from '@/components/teacher/teacher-payouts-section';
import type { UserProfile } from '@/lib/types';

type FinancialTab = 'revenue' | 'methods' | 'history';

interface Props {
  profile: UserProfile;
}

export default function TeacherFinancialManagementSection({ profile }: Props) {
  const { t, direction } = useTranslations();
  const [activeTab, setActiveTab] = useState<FinancialTab>('revenue');

  // Restore tab from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash.replace('#teacher-financial-', '');
    if (['revenue', 'methods', 'history'].includes(hash)) {
      setActiveTab(hash as FinancialTab);
    }
  }, []);

  const tabs: Array<{ id: FinancialTab; label: string; icon: typeof DollarSign }> = [
    { id: 'revenue', label: 'الإيرادات', icon: DollarSign },
    { id: 'methods', label: 'طرق الاستلام', icon: Wallet },
    { id: 'history', label: 'سجل المدفوعات', icon: Receipt },
  ];

  return (
    <div className="space-y-4" dir={direction}>
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b pb-2 overflow-x-auto">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <Button
              key={tab.id}
              variant={isActive ? 'default' : 'ghost'}
              size="sm"
              className={`h-9 text-xs whitespace-nowrap ${isActive ? 'bg-teal-600 text-white' : ''}`}
              onClick={() => {
                setActiveTab(tab.id);
                window.location.hash = `teacher-financial-${tab.id}`;
              }}
            >
              <Icon className="h-3.5 w-3.5 me-1.5" />
              {tab.label}
            </Button>
          );
        })}
      </div>

      {/* Active tab content */}
      <div>
        {activeTab === 'revenue' && <TeacherFinancialSection />}
        {activeTab === 'methods' && <TeacherPayoutMethodsSection />}
        {activeTab === 'history' && <TeacherPayoutsSection />}
      </div>
    </div>
  );
}
