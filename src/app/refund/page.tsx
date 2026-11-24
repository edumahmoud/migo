import type { Metadata } from 'next';
import LegalDocument from '@/components/legal/legal-document';
import { policies } from '@/components/legal/policies-content';

export const metadata: Metadata = {
  title: 'سياسة الاسترجاع | AttenDo',
  description: 'سياسة استرجاع الاشتراكات في منصة AttenDo',
};

export default function RefundPage() {
  return <LegalDocument doc={policies.refund} />;
}
