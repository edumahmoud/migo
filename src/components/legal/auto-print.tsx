'use client';

import { useEffect } from 'react';

/** Opens the browser print dialog (Save as PDF) when the page is opened with ?pdf=1. */
export default function AutoPrint() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('pdf') !== '1') return;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);
  return null;
}
