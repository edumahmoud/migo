import type { Metadata } from 'next';
import LegalDocument from '@/components/legal/legal-document';
import { getPolicyDoc } from '@/lib/legal-server';

// Re-read the (admin-editable) text at most once a minute; saving from the admin panel also revalidates.
export const revalidate = 60;

export const metadata: Metadata = {
  title: 'شروط الاستخدام | AttenDo',
  description: 'شروط استخدام منصة AttenDo التعليمية',
};

export default async function TermsPage() {
  const doc = await getPolicyDoc('terms');
  return <LegalDocument doc={doc} slug="terms" />;
}
