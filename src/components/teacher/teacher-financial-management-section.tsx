'use client';

import { useState, useEffect } from 'react';
import { DollarSign, Wallet, Receipt } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
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
      <div className="flex items-center gap-1 border-b pb-2 overflow-x-auto">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                window.location.hash = `teacher-financial-${tab.id}`;
              }}
              className={`inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium whitespace-nowrap rounded-md transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div>
        {activeTab === 'revenue' && <TeacherFinancialSection />}
        {activeTab === 'methods' && <TeacherPayoutMethodsSection />}
        {activeTab === 'history' && <TeacherPayoutsSection />}
      </div>
    </div>
  );
}
