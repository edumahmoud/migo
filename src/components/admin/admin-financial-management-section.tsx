'use client';

import { useState, useEffect } from 'react';
import { DollarSign, Wallet, Users, CreditCard, Calendar, Receipt } from 'lucide-react';
import { useAppStore } from '@/stores/app-store';
import { useTranslations } from '@/i18n/use-translations';
import AdminFinancialSection from '@/components/admin/admin-financial-section';
import AdminPayoutsSection from '@/components/admin/admin-payouts-section';
import AdminTeachersSection from '@/components/admin/admin-teachers-section';
import PaymentGatewaysSection from '@/components/admin/payment-gateways-section';
import AdminFinancialBreakdownSection from '@/components/admin/admin-financial-breakdown-section';
import AdminFeeCatalogSection from '@/components/admin/admin-fee-catalog-section';
import type { UserProfile } from '@/lib/types';

type FinancialTab = 'dashboard' | 'breakdown' | 'payouts' | 'teachers' | 'fees' | 'gateways';

interface Props {
  profile: UserProfile;
}

export default function AdminFinancialManagementSection({ profile }: Props) {
  const { t, direction } = useTranslations();
  const [activeTab, setActiveTab] = useState<FinancialTab>('dashboard');
  const isSuperadmin = profile.role === 'superadmin';

  useEffect(() => {
    const hash = window.location.hash.replace('#financial-', '');
    if (['dashboard', 'breakdown', 'payouts', 'teachers', 'fees', 'gateways'].includes(hash)) {
      setActiveTab(hash as FinancialTab);
    }
  }, []);

  const tabs: Array<{ id: FinancialTab; labelKey: string; icon: typeof DollarSign; superadminOnly?: boolean }> = [
    { id: 'dashboard', labelKey: 'financial.tabDashboard', icon: DollarSign },
    { id: 'breakdown', labelKey: 'financial.tabBreakdown', icon: Calendar },
    { id: 'payouts', labelKey: 'financial.tabPayouts', icon: CreditCard },
    { id: 'teachers', labelKey: 'financial.tabTeachers', icon: Users },
    { id: 'fees', labelKey: 'financial.tabFees', icon: Receipt },
    { id: 'gateways', labelKey: 'financial.tabGateways', icon: Wallet, superadminOnly: true },
  ];

  const visibleTabs = tabs.filter(tab => !tab.superadminOnly || isSuperadmin);

  return (
    <div className="space-y-4" dir={direction}>
      <div className="flex items-center gap-1 border-b pb-2 overflow-x-auto">
        {visibleTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                window.location.hash = `financial-${tab.id}`;
              }}
              className={`inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium whitespace-nowrap rounded-md transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>

      <div>
        {activeTab === 'dashboard' && <AdminFinancialSection profile={profile} />}
        {activeTab === 'breakdown' && <AdminFinancialBreakdownSection />}
        {activeTab === 'payouts' && <AdminPayoutsSection />}
        {activeTab === 'teachers' && <AdminTeachersSection />}
        {activeTab === 'fees' && <AdminFeeCatalogSection />}
        {activeTab === 'gateways' && isSuperadmin && <PaymentGatewaysSection />}
      </div>
    </div>
  );
}
