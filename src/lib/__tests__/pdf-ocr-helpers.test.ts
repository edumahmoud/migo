import { describe, test, expect } from 'bun:test';
import {
  looksGarbled,
  arrayBufferToBase64,
  MAX_OCR_INLINE_BYTES,
  computeInlineOcrChunkBoundaries,
  OCR_CHUNK_MAX_PAGES,
  OCR_CHUNK_TARGET_BYTES,
} from '../pdf-client';

describe('looksGarbled', () => {
  test('normal Arabic text is NOT garbled', () => {
    const text = 'هذا نص عربي طبيعي يحتوي على كلمات مفهومة وتراكيب سليمة يمكن قراءتها بوضوح تام.';
    expect(looksGarbled(text)).toBe(false);
  });

  test('normal English text is NOT garbled', () => {
    const text = 'This is a normal English sentence extracted from a digital PDF file with proper encoding.';
    expect(looksGarbled(text)).toBe(false);
  });

  test('empty text is garbled', () => {
    expect(looksGarbled('')).toBe(true);
  });

  test('very short text is garbled', () => {
    expect(looksGarbled('قصير')).toBe(true);
  });

  test('text with many Unicode replacement chars IS garbled', () => {
    // Simulates broken CID font mapping: >2% replacement characters
    const text = '������ ���� ������ ��� ��� ������� ������� ��� ��������';
    expect(looksGarbled(text)).toBe(true);
  });

  test('text with a couple of replacement chars is NOT garbled', () => {
    const text = 'مقدمة في علم الأحياء: الخلية هي وحدة البناء والوظيفة في الكائنات الحية، وتتكون من نواة وسيتوبلازم وغشاء خلوي وجدار خلوي في بعض الأنواع، كما تحتوي على البلاستيدات الخضراء التي تقوم بعملية البناء الضوئي بإذن الله � تعمل الميتوكوندريا على إنتاج الطاقة اللازمة للخلية.';
    expect(looksGarbled(text)).toBe(false);
  });

  test('mojibake punctuation soup IS garbled', () => {
    // Simulates Latin-1 mojibake of Arabic: Ø§Ù"Ø³Ù"Ø§Ù... Ø¹Ù"ÙŠÙƒÙ...
    const text = 'Ø§Ù"Ø³Ù"Ø§Ù Ø¹Ù"ÙŠÙƒÙ… Ø£Ù†Ø§ Ø£Ø­Ù…Ø¯ Ù…Ø­Ù…Ø¯ Ø¹Ù"ÙŠ Ù…ØµØ± Ø§Ù"Ù‚Ø§Ù‡Ø±Ø©';
    expect(looksGarbled(text)).toBe(true);
  });
});

describe('arrayBufferToBase64', () => {
  test('round-trips small binary data', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const b64 = arrayBufferToBase64(buf);
    expect(b64).toBe(btoa('%PDF-1.7'));
    // Decode back and compare
    const decoded = Buffer.from(b64, 'base64');
    expect(new Uint8Array(decoded)).toEqual(bytes);
  });

  test('handles large buffers without stack overflow (chunked path)', () => {
    // 1MB buffer — larger than the 32KB chunk size, exercises the loop
    const size = 1024 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 256;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const b64 = arrayBufferToBase64(buf);
    expect(b64.length).toBe(Math.ceil(size / 3) * 4);
    const decoded = new Uint8Array(Buffer.from(b64, 'base64'));
    expect(decoded.length).toBe(size);
    expect(decoded[size - 1]).toBe((size - 1) % 256);
  });

  test('empty buffer produces empty string', () => {
    const b64 = arrayBufferToBase64(new ArrayBuffer(0));
    expect(b64).toBe('');
  });
});

describe('MAX_OCR_INLINE_BYTES', () => {
  test('is 3MB (within Vercel 4.5MB body limit after base64 expansion)', () => {
    expect(MAX_OCR_INLINE_BYTES).toBe(3 * 1024 * 1024);
    // base64 of 3MB is ~4MB, leaving headroom in the JSON body
    const base64Size = Math.ceil(MAX_OCR_INLINE_BYTES / 3) * 4;
    expect(base64Size).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe('computeInlineOcrChunkBoundaries', () => {
  test('small PDF (few pages, few bytes) stays a single chunk', () => {
    expect(computeInlineOcrChunkBoundaries(8, 500 * 1024)).toEqual([[1, 8]]);
  });

  test('exactly at both limits stays a single chunk', () => {
    expect(computeInlineOcrChunkBoundaries(OCR_CHUNK_MAX_PAGES, MAX_OCR_INLINE_BYTES)).toEqual([
      [1, OCR_CHUNK_MAX_PAGES],
    ]);
  });

  test('the real-world case: 45 pages / 5.29MB scan splits into byte+page bounded chunks', () => {
    const boundaries = computeInlineOcrChunkBoundaries(45, 5_549_236);
    // Every page covered exactly once, in order
    expect(boundaries[0][0]).toBe(1);
    expect(boundaries[boundaries.length - 1][1]).toBe(45);
    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i][0]).toBe(boundaries[i - 1][1] + 1);
    }
    // Multiple chunks required, page ceiling respected per chunk
    expect(boundaries.length).toBeGreaterThan(1);
    for (const [start, end] of boundaries) {
      expect(end - start + 1).toBeLessThanOrEqual(OCR_CHUNK_MAX_PAGES);
    }
    // 5.29MB / 2.6MB target ⇒ at least 3 chunks; 45 pages / 12 ⇒ at least 4
    expect(boundaries.length).toBeGreaterThanOrEqual(4);
  });

  test('many pages but small file splits by page ceiling only', () => {
    // 30 pages, 1MB: fits inline byte-wise but exceeds the page ceiling
    const boundaries = computeInlineOcrChunkBoundaries(30, 1024 * 1024);
    expect(boundaries.length).toBeGreaterThanOrEqual(Math.ceil(30 / OCR_CHUNK_MAX_PAGES));
    for (const [start, end] of boundaries) {
      expect(end - start + 1).toBeLessThanOrEqual(OCR_CHUNK_MAX_PAGES);
    }
  });

  test('huge page count keeps chunks page-bounded', () => {
    const boundaries = computeInlineOcrChunkBoundaries(200, 10 * 1024 * 1024);
    expect(boundaries[boundaries.length - 1][1]).toBe(200);
    for (const [start, end] of boundaries) {
      expect(end - start + 1).toBeLessThanOrEqual(OCR_CHUNK_MAX_PAGES);
    }
    // 200 pages / 12 ⇒ at least 17 chunks
    expect(boundaries.length).toBeGreaterThanOrEqual(17);
  });

  test('zero pages yields no chunks', () => {
    expect(computeInlineOcrChunkBoundaries(0, 1000)).toEqual([]);
  });

  test('estimated per-chunk bytes stay under the inline limit for the real file', () => {
    // For the 45-page / 5.29MB scan: pages are roughly uniform, so each chunk's
    // byte share must remain safely below MAX_OCR_INLINE_BYTES after base64 (+33%).
    const totalPages = 45;
    const totalBytes = 5_549_236;
    const boundaries = computeInlineOcrChunkBoundaries(totalPages, totalBytes);
    for (const [start, end] of boundaries) {
      const pages = end - start + 1;
      const estimatedBytes = (totalBytes * pages) / totalPages;
      // +10% re-serialization slack, then +4/3 base64 expansion
      const worstCase = estimatedBytes * 1.1 * (4 / 3);
      expect(worstCase).toBeLessThan(4.5 * 1024 * 1024);
    }
  });

  test('chunk target bytes keep base64 payload within the Vercel body limit', () => {
    // A chunk at the target size, base64-encoded, must stay under 4.5MB.
    const base64Size = Math.ceil(OCR_CHUNK_TARGET_BYTES / 3) * 4;
    expect(base64Size).toBeLessThan(4.5 * 1024 * 1024);
  });
});
