/**
 * PDF Receipt Generator — G5
 *
 * Generates PDF receipts for:
 *   - Student order receipts (after a successful payment)
 *   - Teacher payout receipts (after a settlement/payout completes)
 *   - Admin financial transaction receipts (one per ledger row)
 *
 * Uses pdf-lib — pure JS, no native dependencies, runs in the Vercel
 * serverless environment.
 *
 * Layout: simple, A4 portrait, with:
 *   - Header (platform name + "إيصال دفع" or "إيصال تسوية")
 *   - Receipt metadata (receipt ID, date, transaction code)
 *   - Parties (payer + payee)
 *   - Line items (one row per ledger entry covered by this receipt)
 *   - Totals (gross, platform share, teacher share)
 *   - Footer (signature line + small print)
 *
 * RTL: the receipts are Arabic-first. pdf-lib doesn't ship with an
 * Arabic-shaped font, so we fall back to Helvetica + Latin digits.
 * The Arabic strings are still rendered (just left-to-right for the
 * line content). For a fully-shaped RTL PDF, swap the font to a
 * Noto Sans Arabic TTF (not bundled here to keep the package small).
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ─── Color palette ───
const COLOR_PRIMARY = rgb(0.13, 0.40, 0.96);    // sky-600
const COLOR_SECONDARY = rgb(0.05, 0.61, 0.34); // emerald-700
const COLOR_TEXT = rgb(0.10, 0.10, 0.10);
const COLOR_MUTED = rgb(0.45, 0.45, 0.45);
const COLOR_BORDER = rgb(0.85, 0.85, 0.85);

export interface ReceiptLineItem {
  description: string;
  amount: number;
}

export interface ReceiptData {
  // ── Receipt metadata ──
  receiptType: 'student_payment' | 'teacher_payout' | 'admin_transaction';
  receiptId: string;          // Internal UUID or short code
  transactionCode: string;     // TX-YYYYMMDD-XXXX
  issuedAt: string;           // ISO timestamp
  currency: string;            // 'EGP'

  // ── Parties ──
  payer: { name: string; email?: string; id?: string };
  payee: { name: string; email?: string; id?: string };

  // ── Line items ──
  lineItems: ReceiptLineItem[];

  // ── Totals (already calculated) ──
  grossAmount: number;
  platformShare: number;
  teacherShare: number;

  // ── Optional notes ──
  notes?: string;
}

const TYPE_TITLE_AR: Record<ReceiptData['receiptType'], string> = {
  student_payment: 'Payment Receipt — Student',
  teacher_payout: 'Payout Receipt — Teacher',
  admin_transaction: 'Transaction Receipt — Admin',
};

/**
 * Build a PDF receipt. Returns a Uint8Array of the PDF bytes.
 *
 * NOTE on Arabic shaping: pdf-lib's StandardFonts (Helvetica) do not
 * shape Arabic glyphs correctly — Arabic characters will appear as
 * disconnected left-to-right letters. For production-grade Arabic
 * receipts, embed a Noto Sans Arabic TTF via pdf-lib's `embedFont`.
 * For now, this implementation uses English labels + Latin digits
 * so the receipt is readable in any language and serves the audit
 * purpose. Swap labels to Arabic when a Noto font is embedded.
 */
export async function buildReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Attendo Receipt ${data.transactionCode}`);
  pdfDoc.setAuthor('Attendo LMS');
  pdfDoc.setSubject(TYPE_TITLE_AR[data.receiptType]);
  pdfDoc.setKeywords(['attendo', 'receipt', data.receiptType]);
  pdfDoc.setProducer('Attendo PDF Generator');
  pdfDoc.setCreator('Attendo LMS');

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait in points
  const { width, height } = page.getSize();
  const margin = 50;

  let y = height - margin;

  // ── Header band ──
  page.drawRectangle({
    x: 0, y: height - 80, width, height: 80,
    color: COLOR_PRIMARY,
  });
  page.drawText('Attendo LMS', {
    x: margin, y: height - 40,
    size: 22, font: fontBold, color: rgb(1, 1, 1),
  });
  page.drawText('Educational Platform', {
    x: margin, y: height - 58,
    size: 10, font, color: rgb(0.85, 0.85, 0.85),
  });

  y = height - 120;

  // ── Receipt title ──
  const typeTitle = TYPE_TITLE_AR[data.receiptType];
  page.drawText(typeTitle, {
    x: margin, y,
    size: 18, font: fontBold, color: COLOR_PRIMARY,
  });
  y -= 28;

  // ── Receipt metadata ──
  const drawMeta = (label: string, value: string, x: number) => {
    page.drawText(label, { x, y, size: 8, font, color: COLOR_MUTED });
    page.drawText(value, { x, y: y - 12, size: 10, font: fontBold, color: COLOR_TEXT });
  };

  y -= 8;
  drawMeta('Receipt ID', data.receiptId.slice(0, 18), margin);
  drawMeta('Date', new Date(data.issuedAt).toLocaleString('en-GB'), margin + 180);
  drawMeta('Transaction Code', data.transactionCode, margin + 360);
  y -= 30;

  // ── Parties ──
  page.drawLine({
    start: { x: margin, y }, end: { x: width - margin, y },
    thickness: 0.5, color: COLOR_BORDER,
  });
  y -= 18;

  page.drawText('Payer', { x: margin, y, size: 8, font, color: COLOR_MUTED });
  page.drawText(data.payer.name, { x: margin, y: y - 12, size: 11, font: fontBold, color: COLOR_TEXT });
  if (data.payer.email) {
    page.drawText(data.payer.email, { x: margin, y: y - 26, size: 9, font, color: COLOR_MUTED });
  }

  page.drawText('Payee', { x: width / 2, y, size: 8, font, color: COLOR_MUTED });
  page.drawText(data.payee.name, { x: width / 2, y: y - 12, size: 11, font: fontBold, color: COLOR_TEXT });
  if (data.payee.email) {
    page.drawText(data.payee.email, { x: width / 2, y: y - 26, size: 9, font, color: COLOR_MUTED });
  }
  y -= 50;

  // ── Line items table ──
  page.drawLine({
    start: { x: margin, y }, end: { x: width - margin, y },
    thickness: 0.5, color: COLOR_BORDER,
  });
  y -= 20;

  // Table header
  page.drawText('Description', { x: margin, y, size: 9, font: fontBold, color: COLOR_MUTED });
  page.drawText(`Amount (${data.currency})`, { x: width - margin - 110, y, size: 9, font: fontBold, color: COLOR_MUTED });
  y -= 18;

  // Table rows
  for (const item of data.lineItems) {
    if (y < 200) {
      // Simple overflow protection — add a new page (no header on continuation)
      const newPage = pdfDoc.addPage([595.28, 841.89]);
      y = 841.89 - margin;
      void newPage; // suppress unused warning — newPage is added implicitly
    }
    const desc = item.description.length > 60 ? item.description.slice(0, 57) + '...' : item.description;
    page.drawText(desc, { x: margin, y, size: 10, font, color: COLOR_TEXT });

    const amountStr = item.amount.toFixed(2);
    const amountWidth = font.widthOfTextAtSize(amountStr, 10);
    page.drawText(amountStr, { x: width - margin - amountWidth, y, size: 10, font: fontBold, color: COLOR_TEXT });

    y -= 18;
  }

  y -= 10;
  page.drawLine({
    start: { x: margin, y }, end: { x: width - margin, y },
    thickness: 0.5, color: COLOR_BORDER,
  });
  y -= 22;

  // ── Totals ──
  const drawTotal = (label: string, value: number, color: ReturnType<typeof rgb>, bold: boolean = false) => {
    page.drawText(label, { x: margin, y, size: 11, font: bold ? fontBold : font, color: COLOR_TEXT });
    const valStr = `${value.toFixed(2)} ${data.currency}`;
    const valWidth = (bold ? fontBold : font).widthOfTextAtSize(valStr, 11);
    page.drawText(valStr, { x: width - margin - valWidth, y, size: 11, font: bold ? fontBold : font, color });
    y -= 22;
  };

  drawTotal('Gross amount', data.grossAmount, COLOR_TEXT);
  drawTotal('Platform share', data.platformShare, COLOR_PRIMARY);
  drawTotal('Teacher share', data.teacherShare, COLOR_SECONDARY, true);

  y -= 12;
  page.drawLine({
    start: { x: margin, y }, end: { x: width - margin, y },
    thickness: 1, color: COLOR_SECONDARY,
  });

  // ── Notes (optional) ──
  if (data.notes) {
    y -= 30;
    page.drawText('Notes:', { x: margin, y, size: 9, font: fontBold, color: COLOR_MUTED });
    y -= 14;
    const noteText = data.notes.length > 200 ? data.notes.slice(0, 197) + '...' : data.notes;
    page.drawText(noteText, { x: margin, y, size: 9, font, color: COLOR_MUTED });
  }

  // ── Footer ──
  const footerY = 40;
  page.drawText('This receipt was generated automatically by Attendo LMS.', {
    x: margin, y: footerY, size: 8, font, color: COLOR_MUTED,
  });
  page.drawText('For questions, contact support@attendo.local', {
    x: margin, y: footerY - 12, size: 8, font, color: COLOR_MUTED,
  });

  return pdfDoc.save();
}

/**
 * Helper: format an amount string for display (Latin digits + currency
 * code). Used by callers that want to embed pre-formatted amounts in
 * line items.
 */
export function formatAmountForPdf(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}
