import type { Metadata } from 'next';
import StatusView, { STATUS_COPY } from '@/components/shared/status-view';

export const metadata: Metadata = { title: 'AttenDo', robots: { index: false } };

export default async function StatusPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const n = Number(code);
  return <StatusView code={STATUS_COPY[n] ? n : 404} />;
}
