import React from 'react';
import Link from 'next/link';
import AutoPrint from './auto-print';
import { POLICY_LABELS, type LegalDoc, type PolicySlug } from '@/lib/legal';

/** Renders inline **bold** markers inside policy text. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold text-gray-900 dark:text-gray-100">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

const NAV: { key: PolicySlug; href: string }[] = [
  { key: 'terms', href: '/terms' },
  { key: 'refund', href: '/refund' },
  { key: 'privacy', href: '/privacy' },
];

export default function LegalDocument({ doc, slug }: { doc: LegalDoc; slug: PolicySlug }) {
  return (
    <div className="print:bg-white min-h-screen bg-gradient-to-br from-sky-50 via-white to-teal-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950" dir="rtl">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none print:hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-sky-100/40 dark:bg-sky-900/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-teal-100/40 dark:bg-teal-900/20 rounded-full blur-3xl" />
      </div>

      <AutoPrint />
      <div className="relative z-10 max-w-3xl mx-auto px-4 py-10 sm:py-14 print:py-0 print:px-0 print:max-w-none">
        <div className="bg-white/90 dark:bg-card/90 backdrop-blur-sm rounded-3xl shadow-xl border border-sky-100/50 dark:border-border p-6 sm:p-10 print:shadow-none print:border-0 print:rounded-none print:p-0 print:bg-white">
          <p className="text-sm font-semibold text-sky-700 dark:text-sky-400 mb-2">AttenDo | أتيندو</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-50 mb-1">
            {doc.title}
          </h1>
          <p className="text-xs text-gray-400 mb-8">{doc.updatedAt}</p>

          {doc.sections.map((section, si) => (
            <section key={si} className="mb-8 last:mb-0">
              <h2 className="text-lg font-bold text-sky-800 dark:text-sky-300 mb-3 pb-2 border-b border-sky-100 dark:border-border">
                {section.heading}
              </h2>
              {section.blocks.map((block, bi) =>
                block.type === 'ul' ? (
                  <ul key={bi} className="list-disc pr-6 space-y-2 mb-3 text-gray-700 dark:text-gray-300 leading-8">
                    {block.items.map((item, ii) => (
                      <li key={ii}>
                        <RichText text={item} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p key={bi} className="mb-3 text-gray-700 dark:text-gray-300 leading-8">
                    <RichText text={block.text} />
                  </p>
                ),
              )}
            </section>
          ))}
        </div>

        <nav className="print:hidden mt-6 text-center text-xs text-gray-400 space-x-3 space-x-reverse">
          {NAV.filter((n) => n.key !== slug).map((n) => (
            <Link key={n.key} href={n.href} className="hover:text-sky-600 hover:underline transition-colors">
              {POLICY_LABELS[n.key]}
            </Link>
          ))}
          <Link href="/" className="hover:text-sky-600 hover:underline transition-colors">
            العودة إلى المنصة
          </Link>
        </nav>
      </div>
    </div>
  );
}
