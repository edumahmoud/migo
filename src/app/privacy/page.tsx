import type { Metadata } from 'next';
import LegalDocument from '@/components/legal/legal-document';
import { getPolicyDoc } from '@/lib/legal-server';

// Re-read the (admin-editable) text at most once a minute; saving from the admin panel also revalidates.
export const revalidate = 60;

export const metadata: Metadata = {
  title: 'سياسة الخصوصية وحماية البيانات | AttenDo',
  description: 'سياسة الخصوصية وحماية البيانات في منصة AttenDo',
};

export default async function PrivacyPage() {
  const doc = await getPolicyDoc('privacy');
  return <LegalDocument doc={doc} slug="privacy" />;
}
