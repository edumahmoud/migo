import type { Metadata } from 'next';
import LegalDocument from '@/components/legal/legal-document';
import { policies } from '@/components/legal/policies-content';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية وحماية البيانات | AttenDo',
  description: 'سياسة الخصوصية وحماية البيانات في منصة AttenDo',
};

export default function PrivacyPage() {
  return <LegalDocument doc={policies.privacy} />;
}
