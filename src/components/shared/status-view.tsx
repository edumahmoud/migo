import Link from 'next/link';

export const STATUS_COPY: Record<number, { ar: [string, string]; en: [string, string] }> = {
  401: { ar: ['يلزم تسجيل الدخول', 'من فضلك سجّل الدخول للوصول إلى هذه الصفحة.'], en: ['Sign in required', 'Please sign in to access this page.'] },
  403: { ar: ['غير مسموح بالوصول', 'ليست لديك صلاحية لفتح هذه الصفحة.'], en: ['Access denied', 'You do not have permission to open this page.'] },
  404: { ar: ['الصفحة غير موجودة', 'الرابط الذي فتحته غير صحيح أو تم نقله.'], en: ['Page not found', 'The link you opened is wrong or has moved.'] },
  405: { ar: ['طريقة الطلب غير مسموحة', 'لا يمكن فتح هذا العنوان بهذه الطريقة.'], en: ['Method not allowed', 'This address cannot be opened this way.'] },
  429: { ar: ['محاولات كثيرة', 'من فضلك انتظر قليلاً ثم حاول مرة أخرى.'], en: ['Too many requests', 'Please wait a moment and try again.'] },
  500: { ar: ['حدث خطأ في الخادم', 'نعمل على حل المشكلة. حاول مرة أخرى بعد قليل.'], en: ['Server error', 'Something went wrong on our side. Please try again shortly.'] },
  503: { ar: ['الخدمة غير متاحة مؤقتاً', 'نقوم بأعمال صيانة. عد بعد قليل.'], en: ['Service unavailable', 'We are doing maintenance. Please come back shortly.'] },
};

export default function StatusView({ code }: { code: number }) {
  const c = STATUS_COPY[code] ?? STATUS_COPY[500];
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'linear-gradient(135deg,#f0f9ff,#e0f2fe)', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 460, width: '100%', background: '#fff', borderRadius: 20, padding: 32, textAlign: 'center', boxShadow: '0 10px 30px rgba(3,105,161,.12)' }}>
        <div style={{ fontSize: 64, fontWeight: 800, color: '#0369a1', lineHeight: 1 }}>{STATUS_COPY[code] ? code : 500}</div>
        <h1 dir="rtl" style={{ fontSize: 22, margin: '16px 0 6px', color: '#0f172a' }}>{c.ar[0]}</h1>
        <p dir="rtl" style={{ margin: 0, color: '#475569' }}>{c.ar[1]}</p>
        <hr style={{ margin: '20px 0', border: 0, borderTop: '1px solid #e2e8f0' }} />
        <h2 dir="ltr" style={{ fontSize: 18, margin: '0 0 6px', color: '#0f172a' }}>{c.en[0]}</h2>
        <p dir="ltr" style={{ margin: 0, color: '#475569' }}>{c.en[1]}</p>
        <Link href="/" style={{ display: 'inline-block', marginTop: 24, padding: '10px 22px', borderRadius: 12, background: '#0369a1', color: '#fff', textDecoration: 'none', fontWeight: 600 }}>
          الرئيسية / Home
        </Link>
      </div>
    </main>
  );
}
