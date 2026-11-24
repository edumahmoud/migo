import type { Metadata } from 'next';
import LegalDocument from '@/components/legal/legal-document';
import { policies } from '@/components/legal/policies-content';

export const metadata: Metadata = {
  title: 'شروط الاستخدام | AttenDo',
  description: 'شروط استخدام منصة AttenDo التعليمية',
};

export default function TermsPage() {
  return <LegalDocument doc={policies.terms} />;
}
