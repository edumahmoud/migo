// =====================================================
// markdown-utils — URL protocol filtering tests (audit #9)
// =====================================================

import { describe, test, expect } from 'bun:test';
import { markdownToHtml } from '../markdown-utils';

describe('markdownToHtml — link/image URL safety', () => {
  test('https links are kept', () => {
    const html = markdownToHtml('[site](https://example.com)');
    expect(html).toContain('href="https://example.com"');
  });

  test('javascript: links are stripped (label kept, no href)', () => {
    const html = markdownToHtml('[click me](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<a href');
    expect(html).toContain('click me');
  });

  test('JavaScript with mixed case is stripped', () => {
    const html = markdownToHtml('[x](JaVaScRiPt:alert(1))');
    expect(html).not.toContain('<a href');
  });

  test('data: URLs are stripped', () => {
    const html = markdownToHtml('[x](data:text/html,<script>alert(1)</script>)');
    expect(html).not.toContain('<a href');
  });

  test('vbscript: URLs are stripped', () => {
    const html = markdownToHtml('[x](vbscript:msgbox(1))');
    expect(html).not.toContain('<a href');
  });

  test('relative and anchor links are kept', () => {
    expect(markdownToHtml('[page](/dashboard)')).toContain('href="/dashboard"');
    expect(markdownToHtml('[sec](#section)')).toContain('href="#section"');
  });

  test('mailto links are kept', () => {
    expect(markdownToHtml('[mail](mailto:a@b.com)')).toContain('href="mailto:a@b.com"');
  });

  test('javascript: image src is stripped', () => {
    const html = markdownToHtml('![pic](javascript:alert(1))');
    expect(html).not.toContain('<img');
    expect(html).toContain('pic');
  });

  test('https images are kept', () => {
    expect(markdownToHtml('![pic](https://example.com/a.png)')).toContain('<img src="https://example.com/a.png"');
  });

  test('HTML injection via markdown is escaped (unchanged behavior)', () => {
    const html = markdownToHtml('hello <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
