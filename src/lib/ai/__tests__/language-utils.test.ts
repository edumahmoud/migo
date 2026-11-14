import { describe, expect, test } from 'bun:test';
import {
  analyzeScript,
  describeDetectedLanguage,
  patchBooleanOptions,
  quizQuestionsText,
  stripNonLinguisticNoise,
  textDir,
  questionDir,
} from '../language-utils';

describe('stripNonLinguisticNoise', () => {
  test('removes code fences, URLs, images and HTML', () => {
    const input = [
      '# Heading',
      '```python',
      'print("hello world")',
      '```',
      'See https://example.com/page for details',
      '![diagram](https://cdn.example.com/img.png)',
      '<p>HTML tag</p>',
      'Normal English text remains here friend',
    ].join('\n');
    const cleaned = stripNonLinguisticNoise(input);
    expect(cleaned).not.toContain('https://');
    expect(cleaned).not.toContain('print');
    expect(cleaned).not.toContain('<p>');
    expect(cleaned).toContain('Normal English text remains here friend');
  });
});

describe('analyzeScript', () => {
  test('English text → Latin dominant, not Arabic', () => {
    const r = analyzeScript(
      'Photosynthesis is the process by which green plants convert sunlight into chemical energy. Chlorophyll absorbs light most strongly in the blue region of the spectrum.',
    );
    expect(r.script).toBe('latin');
    expect(r.isArabicDominant).toBe(false);
    expect(r.isAmbiguous).toBe(false);
    expect(r.arabicRatio).toBeLessThan(0.05);
  });

  test('Arabic text → Arabic dominant', () => {
    const r = analyzeScript(
      'التمثيل الضوئي هو العملية التي تحول بها النباتات الخضراء ضوء الشمس إلى طاقة كيميائية، ويقوم الكلوروفيل بامتصاص الضوء في المنطقة الزرقاء من الطيف بشكل قوي جداً.',
    );
    expect(r.script).toBe('arabic');
    expect(r.isArabicDominant).toBe(true);
    expect(r.latinRatio).toBeLessThan(0.05);
  });

  test('English text with Arabic greeting line still Latin dominant', () => {
    const r = analyzeScript(
      'يا أحمد، هنا ملخص الدرس\n\nPhotosynthesis converts sunlight into chemical energy. Chlorophyll absorbs blue light. The light-dependent reactions occur in the thylakoid membranes. ATP and NADPH are produced.',
    );
    expect(r.isArabicDominant).toBe(false);
    expect(r.script).toBe('latin');
  });

  test('French text → Latin dominant', () => {
    const r = analyzeScript(
      'La photosynthèse est le processus par lequel les plantes vertes convertissent la lumière solaire en énergie chimique. La chlorophylle absorbe la lumière bleue.',
    );
    expect(r.script).toBe('latin');
  });

  test('Russian text → Cyrillic dominant', () => {
    const r = analyzeScript(
      'Фотосинтез — это процесс, при котором зелёные растения преобразуют солнечный свет в химическую энергию.',
    );
    expect(r.script).toBe('cyrillic');
    expect(r.isArabicDominant).toBe(false);
  });

  test('English summary containing many technical terms stays Latin', () => {
    const r = analyzeScript(
      'Unit Testing: individual components are tested in isolation. Integration Testing: modules are combined. Regression Testing: ensures new changes do not break features. Alpha testing occurs before beta testing.',
    );
    expect(r.script).toBe('latin');
  });

  test('empty / tiny text is ambiguous and defaults to Arabic track', () => {
    const r = analyzeScript('12345 !!! ???');
    expect(r.isAmbiguous).toBe(true);
    expect(r.isArabicDominant).toBe(true);
  });
});

describe('describeDetectedLanguage', () => {
  test('labels Latin script generically', () => {
    expect(describeDetectedLanguage(analyzeScript('hello world this is english text'))).toContain('Latin');
  });
  test('labels Arabic', () => {
    expect(describeDetectedLanguage(analyzeScript('هذا نص عربي واضح للكشف عن اللغة'))).toContain('Arabic');
  });
});

describe('quizQuestionsText + validation flow', () => {
  test('concatenates questions, options, answers and pairs', () => {
    const text = quizQuestionsText([
      { question: 'What is photosynthesis?', options: ['A process', 'A plant', 'A color'], correctAnswer: 'A process' },
      { type: 'matching', question: 'Match', pairs: [{ key: 'ATP', value: 'Energy currency' }] } as never,
    ]);
    expect(text).toContain('What is photosynthesis?');
    expect(text).toContain('Energy currency');
  });

  test('Arabic questions are detected as Arabic dominant', () => {
    const text = quizQuestionsText([
      { question: 'ما هو التمثيل الضوئي؟', options: ['عملية', 'نبات', 'لون'], correctAnswer: 'عملية' },
      { question: 'أين يحدث التمثيل الضوئي داخل الخلية؟', correctAnswer: 'البلاستيدات الخضراء' },
    ]);
    expect(analyzeScript(text).isArabicDominant).toBe(true);
  });

  test('English questions with one Arabic boolean option pair still Latin', () => {
    const text = quizQuestionsText([
      { question: 'What does chlorophyll absorb?', options: ['Blue light', 'Red light', 'Green light'], correctAnswer: 'Blue light' },
      { question: 'ATP is produced in mitochondria.', options: ['صح', 'خطأ'], correctAnswer: 'خطأ' },
    ]);
    expect(analyzeScript(text).script).toBe('latin');
  });
});

describe('patchBooleanOptions', () => {
  test('Arabic boolean labels patched to True/False for Latin content', () => {
    const patched = patchBooleanOptions(
      [{ type: 'boolean', question: 'Photosynthesis needs light.', options: ['صح', 'خطأ'], correctAnswer: 'صح' }],
      false,
    );
    expect(patched[0].options).toEqual(['True', 'False']);
    expect(patched[0].correctAnswer).toBe('True');
  });

  test('English boolean labels patched to صح/خطأ for Arabic content', () => {
    const patched = patchBooleanOptions(
      [{ type: 'boolean', question: 'التمثيل الضوئي يحتاج ضوءاً.', options: ['True', 'False'], correctAnswer: 'False' }],
      true,
    );
    expect(patched[0].options).toEqual(['صح', 'خطأ']);
    expect(patched[0].correctAnswer).toBe('خطأ');
  });

  test('already-correct labels are left untouched', () => {
    const q = { type: 'boolean', question: 'Photosynthesis needs light.', options: ['True', 'False'], correctAnswer: 'True' };
    expect(patchBooleanOptions([q], false)[0]).toEqual(q);
  });

  test('non-boolean questions untouched', () => {
    const q = { type: 'mcq', question: 'Pick one', options: ['صح', 'خطأ', 'x'], correctAnswer: 'x' };
    expect(patchBooleanOptions([q], false)[0]).toEqual(q);
  });
});

describe('textDir', () => {
  test('English paragraph → ltr', () => {
    expect(textDir('Photosynthesis converts sunlight into chemical energy in green plants.')).toBe('ltr');
  });
  test('Arabic paragraph → rtl', () => {
    expect(textDir('التمثيل الضوئي يحول ضوء الشمس إلى طاقة كيميائية في النباتات الخضراء.')).toBe('rtl');
  });
  test('empty string → ltr (safe default)', () => {
    expect(textDir('')).toBe('ltr');
  });
  test('short English label "True" → ltr (first-strong rule)', () => {
    expect(textDir('True')).toBe('ltr');
  });
  test('short English label "False" → ltr', () => {
    expect(textDir('False')).toBe('ltr');
  });
  test('short Arabic label "صح" → rtl (first-strong rule)', () => {
    expect(textDir('صح')).toBe('rtl');
  });
  test('short Arabic label "خطأ" → rtl', () => {
    expect(textDir('خطأ')).toBe('rtl');
  });
  test('French label "Vrai" → ltr', () => {
    expect(textDir('Vrai')).toBe('ltr');
  });
  test('Russian label "Да" → ltr', () => {
    expect(textDir('Да')).toBe('ltr');
  });
  test('punctuation-only string → ltr (no strong char)', () => {
    expect(textDir('___ ??? !!!')).toBe('ltr');
  });
  test('English content prefixed with Arabic greeting still ltr', () => {
    expect(textDir('يا أحمد، هذا الملخص\n\nPhotosynthesis converts sunlight into chemical energy.')).toBe('ltr');
  });
});

describe('questionDir', () => {
  test('English MCQ question → ltr', () => {
    expect(questionDir({
      type: 'mcq',
      question: 'What do green plants convert sunlight into?',
      options: ['Chemical energy', 'Kinetic energy', 'Heat', 'Sound'],
      correctAnswer: 'Chemical energy',
    })).toBe('ltr');
  });
  test('Arabic MCQ question → rtl', () => {
    expect(questionDir({
      type: 'mcq',
      question: 'ما الذي تحوله النباتات الخضراء من ضوء الشمس؟',
      options: ['طاقة كيميائية', 'طاقة حركية', 'حرارة', 'صوت'],
      correctAnswer: 'طاقة كيميائية',
    })).toBe('rtl');
  });
  test('English boolean question with True/False → ltr', () => {
    expect(questionDir({
      type: 'boolean',
      question: 'Chlorophyll absorbs blue light most strongly.',
      options: ['True', 'False'],
      correctAnswer: 'True',
    })).toBe('ltr');
  });
  test('Arabic boolean question with صح/خطأ → rtl', () => {
    expect(questionDir({
      type: 'boolean',
      question: 'يمتص الكلوروفيل الضوء الأزرق بقوة.',
      options: ['صح', 'خطأ'],
      correctAnswer: 'صح',
    })).toBe('rtl');
  });
  test('English matching question → ltr', () => {
    expect(questionDir({
      type: 'matching',
      question: 'Match the term to its definition',
      pairs: [
        { key: 'ATP', value: 'Energy currency of the cell' },
        { key: 'Chlorophyll', value: 'Green pigment that absorbs light' },
        { key: 'Stomata', value: 'Pores for gas exchange' },
        { key: 'Xylem', value: 'Water transport tissue' },
      ],
    })).toBe('ltr');
  });
  test('Arabic matching question → rtl', () => {
    expect(questionDir({
      type: 'matching',
      question: 'طابق المصطلح بتعريفه',
      pairs: [
        { key: 'ATP', value: 'عملة الطاقة في الخلية' },
        { key: 'الكلوروفيل', value: 'صبغة خضراء تمتص الضوء' },
      ],
    })).toBe('rtl');
  });
  test('empty question → ltr (safe default)', () => {
    expect(questionDir({})).toBe('ltr');
  });
});
