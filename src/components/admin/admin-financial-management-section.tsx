'use client';

/**
 * Admin Financial Management Section — Consolidated Umbrella
 *
 * Replaces the 4 separate financial nav items (paymentGateways,
 * financial, payouts, teachers) with a single "الإيرادات المالية"
 * section containing internal tabs.
 *
 * Each tab renders the EXISTING component (no rewriting):
 *   - Tab 1: اللوحة المالية (AdminFinancialSection)
 *   - Tab 2: المدفوعات (AdminPayoutsSection)
 *   - Tab 3: المعلمين (AdminTeachersSection)
 *   - Tab 4: بوابات الدفع (PaymentGatewaysSection) — superadmin only
 */

import { useState, useEffect } from 'react';
import { DollarSign, Wallet, Users, CreditCard } from 'lucide-react';
import { useAppStore } from '@/stores/app-store';
import { useTranslations } from '@/i18n/use-translations';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import AdminFinancialSection from '@/components/admin/admin-financial-section';
import AdminPayoutsSection from '@/components/admin/admin-payouts-section';
import AdminTeachersSection from '@/components/admin/admin-teachers-section';
import PaymentGatewaysSection from '@/components/admin/payment-gateways-section';
import type { UserProfile } from '@/lib/types';

type FinancialTab = 'dashboard' | 'payouts' | 'teachers' | 'gateways';

interface Props {
  profile: UserProfile;
}

export default function AdminFinancialManagementSection({ profile }: Props) {
  const { t, direction } = useTranslations();
  const [activeTab, setActiveTab] = useState<FinancialTab>('dashboard');
  const isSuperadmin = profile.role === 'superadmin';

  // Restore tab from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash.replace('#financial-', '');
    if (['dashboard', 'payouts', 'teachers', 'gateways'].includes(hash)) {
      setActiveTab(hash as FinancialTab);
    }
  }, []);

  const tabs: Array<{ id: FinancialTab; label: string; icon: typeof DollarSign; superadminOnly?: boolean }> = [
    { id: 'dashboard', label: 'اللوحة المالية', icon: DollarSign },
    { id: 'payouts', label: 'المدفوعات', icon: CreditCard },
    { id: 'teachers', label: 'حسابات المعلمين', icon: Users },
    { id: 'gateways', label: 'بوابات الدفع', icon: Wallet, superadminOnly: true },
  ];

  const visibleTabs = tabs.filter(tab => !tab.superadminOnly || isSuperadmin);

  return (
    <div className="space-y-4" dir={direction}>
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b pb-2 overflow-x-auto">
        {visibleTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <Button
              key={tab.id}
              variant={isActive ? 'default' : 'ghost'}
              size="sm"
              className={`h-9 text-xs whitespace-nowrap ${isActive ? 'bg-sky-600 text-white' : ''}`}
              onClick={() => {
                setActiveTab(tab.id);
                window.location.hash = `financial-${tab.id}`;
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
        {activeTab === 'dashboard' && <AdminFinancialSection profile={profile} />}
        {activeTab === 'payouts' && <AdminPayoutsSection />}
        {activeTab === 'teachers' && <AdminTeachersSection />}
        {activeTab === 'gateways' && isSuperadmin && <PaymentGatewaysSection />}
      </div>
    </div>
  );
}
