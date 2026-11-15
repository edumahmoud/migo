import { describe, expect, test } from 'bun:test';
import {
  isTruncatedText,
  mergeContinuation,
  stripTruncationMarkers,
} from '../completion-utils';

// -------------------------------------------------------
// isTruncatedText
// -------------------------------------------------------

describe('isTruncatedText — explicit provider markers', () => {
  test('flags the timeout-cut marker', () => {
    const text = '## ملخص\n- نقطة أولى\n- نقطة ثانية\n\n[... تم قطع الاستجابة بسبب انتهاء المهلة ...]';
    expect(isTruncatedText(text)).toBe(true);
  });

  test('flags the MAX_TOKENS-cut marker (no space after [...])', () => {
    const text = 'Summary text here.\n\n[...تم قطع الاستجابة بسبب بلوغ حد المخرجات ...]';
    expect(isTruncatedText(text)).toBe(true);
  });

  test('flags the stream-error marker even after otherwise complete text', () => {
    const text = 'A complete-looking paragraph ending with a period.\n\n[... تم قطع الاستجابة بسبب خطأ في الاتصال ...]';
    expect(isTruncatedText(text)).toBe(true);
  });

  test('does NOT flag the input-reduction marker (input truncation, not output)', () => {
    const text =
      '## الملخص\nهذا ملخص مكتمل ينتهي بجملة ختامية مشجعة للطالب.\n\n## الخلاصة\nأهم النقاط موجودة هنا كاملة. بالتوفيق!\n\n[... تم تقليص المحتوى ليتناسب مع حد المعالجة ...]';
    // The reduction marker relates to the INPUT content; the output itself
    // ends completely, so this must not be treated as a truncated output.
    expect(isTruncatedText(text)).toBe(false);
  });
});

describe('isTruncatedText — mid-sentence heuristic', () => {
  test('accepts a complete Arabic summary ending with a period', () => {
    const text =
      '## ملخص الدرس\n\nيا أحمد، هذا ملخص شامل للدرس.\n\n- **التعريف**: عملية التمثيل الضوئي هي...\n- **الأهمية**: مصدر الأكسجين...\n\n## الخلاصة\nالتمثيل الضوئي أساس الحياة على الأرض. بالتوفيق يا أحمد!';
    expect(isTruncatedText(text)).toBe(false);
  });

  test('flags a long Arabic line cut mid-sentence (no terminal punctuation)', () => {
    const text =
      '## ملخص الدرس\n\n- نقطة كاملة أولى.\n- نقطة كاملة ثانية.\n\nوفي الختام نجد أن عملية التمثيل الضوئي تعتبر من أهم العمليات الحيوية التي تحدث داخل البلاستيدات الخضراء وتؤثر بشكل مباشر على';
    expect(isTruncatedText(text)).toBe(true);
  });

  test('flags a cut in the middle of a word', () => {
    const text =
      'Photosynthesis is the process by which green plants and other organisms convert light energy into chemical en';
    expect(isTruncatedText(text)).toBe(true);
  });

  test('accepts a complete English summary with a closing sentence', () => {
    const text =
      '## Summary\n\nHi Ahmed, here is your summary.\n\n- **Definition**: Photosynthesis converts light into chemical energy.\n- **Importance**: Produces oxygen.\n\n## Key Takeaways\nPhotosynthesis sustains life on Earth. Good luck!';
    expect(isTruncatedText(text)).toBe(false);
  });

  test('accepts short bullet items that end without punctuation', () => {
    const text =
      '## ملخص\n\n- **التعريف**: تحويل الطاقة الضوئية\n- **المكان**: البلاستيدات الخضراء\n- **الناتج**: الجلوكوز والأكسجين';
    expect(isTruncatedText(text)).toBe(false);
  });

  test('accepts text ending with markdown bold / table / closing bracket', () => {
    expect(isTruncatedText('The final answer is **photosynthesis**')).toBe(false);
    expect(isTruncatedText('| Process | Location |\n| --- | --- |\n| Photosynthesis | Chloroplast |')).toBe(false);
    expect(isTruncatedText('Some final statement (see chapter 4)')).toBe(false);
  });

  test('treats empty text as truncated', () => {
    expect(isTruncatedText('')).toBe(true);
    expect(isTruncatedText('   \n  ')).toBe(true);
  });
});

// -------------------------------------------------------
// stripTruncationMarkers
// -------------------------------------------------------

describe('stripTruncationMarkers', () => {
  test('removes the timeout marker with surrounding whitespace', () => {
    const text = 'بداية النص المقطوع\n\n[... تم قطع الاستجابة بسبب انتهاء المهلة ...]';
    expect(stripTruncationMarkers(text)).toBe('بداية النص المقطوع');
  });

  test('removes the MAX_TOKENS marker', () => {
    const text = 'Start of text\n\n[... تم قطع الاستجابة بسبب بلوغ حد المخرجات ...]';
    expect(stripTruncationMarkers(text)).toBe('Start of text');
  });

  test('removes every marker when multiple are present', () => {
    const text = 'A\n\n[... تم قطع الاستجابة بسبب خطأ في الاتصال ...]\n\nB\n\n[... تم قطع الاستجابة بسبب انتهاء المهلة ...]';
    expect(stripTruncationMarkers(text)).toBe('A\n\nB');
  });

  test('keeps the input-reduction marker untouched', () => {
    const text = 'Summary body.\n\n[... تم تقليص المحتوى ليتناسب مع حد المعالجة ...]';
    expect(stripTruncationMarkers(text)).toBe(text);
  });
});

// -------------------------------------------------------
// mergeContinuation
// -------------------------------------------------------

describe('mergeContinuation', () => {
  test('returns the prefix unchanged when the model signals [COMPLETE]', () => {
    const prefix = 'ملخص كامل ينتهي بجملة تامة.';
    expect(mergeContinuation(prefix, '[COMPLETE]')).toBe(prefix);
    expect(mergeContinuation(prefix, '  \n[COMPLETE]\n')).toBe(prefix);
  });

  test('splices a word-boundary continuation that repeats the final line', () => {
    const prefix = '## الخلاصة\nالتمثيل الضوئي عملية حيوية';
    const continuation = 'التمثيل الضوئي عملية حيوية تحدث في البلاستيدات الخضراء وتنتج الأكسجين. بالتوفيق!';
    const merged = mergeContinuation(prefix, continuation);
    expect(merged).toBe('## الخلاصة\nالتمثيل الضوئي عملية حيوية تحدث في البلاستيدات الخضراء وتنتج الأكسجين. بالتوفيق!');
    expect(merged).not.toContain('حيويةحيوية');
  });

  test('splices a mid-word cut when the model repeats the partial line', () => {
    const prefix = 'وتؤثر بشكل مباشر على';
    const continuation = 'وتؤثر بشكل مباشر على توازن النظام البيئي ككل.';
    const merged = mergeContinuation(prefix, continuation);
    expect(merged).toBe('وتؤثر بشكل مباشر على توازن النظام البيئي ككل.');
  });

  test('joins with a space when the model skipped the repeat instruction', () => {
    const prefix = 'The summary so far ends here';
    const continuation = 'and this is the missing rest of the sentence.';
    const merged = mergeContinuation(prefix, continuation);
    expect(merged).toBe('The summary so far ends here and this is the missing rest of the sentence.');
  });

  test('starts block-level continuations on a new line', () => {
    const prefix = 'First paragraph ends.';
    const continuation = '## الخلاصة\n- نقطة أخيرة';
    const merged = mergeContinuation(prefix, continuation);
    expect(merged).toBe('First paragraph ends.\n## الخلاصة\n- نقطة أخيرة');
  });

  test('strips code fences wrapping the continuation', () => {
    const prefix = 'Text before the cut';
    const continuation = '```markdown\nText before the cut and the continuation after it.\n```';
    const merged = mergeContinuation(prefix, continuation);
    expect(merged).toBe('Text before the cut and the continuation after it.');
  });

  test('handles a model that repeats MORE than the final line', () => {
    const prefix = '## القسم\n- نقطة أولى.\n- نقطة ثانية.';
    const continuation = '## القسم\n- نقطة أولى.\n- نقطة ثانية.\n- نقطة ثالثة تكميلية.';
    const merged = mergeContinuation(prefix, continuation);
    expect(merged).toBe('## القسم\n- نقطة أولى.\n- نقطة ثانية.\n- نقطة ثالثة تكميلية.');
  });
});
