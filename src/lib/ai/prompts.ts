/**
 * AI Layer — Optimized Prompts
 *
 * All AI prompts are centralized here for:
 * - Easy maintenance and versioning
 * - Arabic-optimized educational content
 * - Mobile/Desktop adaptive output
 * - Prompt version tracking for cache invalidation
 *
 * Addressing style: Uses ${studentName} (الاسم الأول فقط)
 * for personalized addressing — e.g. "يا أحمد", "يا محمد"
 */

/** Prompt version — bump this to invalidate all caches */
export const PROMPT_VERSION = '11';

/**
 * Content-cleanup rule injected into SUMMARY/REFINE prompts.
 * v135e: extracted text (OCR / DOCX / PDF) sometimes carries raw HTML tags
 * or entities that would otherwise appear literally in the rendered Markdown.
 */
const HTML_CLEANUP_RULE = `🧹 قاعدة تنظيف عناصر HTML: إذا وردت في النص عناصر HTML (مثل <p> أو <div> أو <br> أو <span> أو &nbsp; أو &amp;) فحوّلها إلى تنسيق Markdown الصحيح المكافئ (فقرات، عناوين، قوائم، فواصل أسطر). لا تترك أي وسم HTML ظاهراً في الناتج النهائي إلا داخل كتل الكود إن كان أصلاً مثال برمجي.

🖼️ قاعدة الصور: أي سطر صورة بصيغة Markdown مثل ![وصف](رابط) موجود في النص الأصلي يجب أن يبقى في الناتج كما هو تماماً دون حذف أو تعديل للرابط — انسخه حرفياً في الموضع المناسب.`;

/**
 * Output-language rule injected into SUMMARY/REFINE prompts.
 *
 * v135d: translation is now a SEPARATE operation. Refine & Summarize ALWAYS
 * keep the source language — no inline translation toggle. The rule is placed
 * FIRST in the prompt and reinforced bilingually (Arabic + English) so the
 * model cannot misread it even when the surrounding instructions are Arabic.
 */
const LANGUAGE_RULE_KEEP = `⚠️ MANDATORY OUTPUT-LANGUAGE RULE (read first):
- Write the output in EXACTLY the same language as the source content.
- If the source is English → output MUST be English.
- If the source is Arabic → output MUST be Arabic.
- If the source is any other language → output in that same language.
- NEVER translate the content or any part of it into another language.
- Even the greeting / welcome sentence addressed to the user MUST be in the source language. If the source is English, do NOT write "يا {studentName}" — write "Hi {studentName}" or similar in English.
- This rule overrides any other instruction that might imply a different output language.

⚠️ قاعدة إلزامية — لغة الإخراج (اقرأ أولاً):
- اكتب الناتج بنفس لغة المحتوى الأصلي تماماً.
- إذا كان المحتوى بالإنجليزية → الناتج بالإنجليزية حصراً.
- إذا كان بالعربية → الناتج بالعربية.
- إذا كان بأي لغة أخرى → الناتج بنفس اللغة.
- ممنوع نهائياً ترجمة المحتوى أو أي جزء منه إلى لغة أخرى.
- حتى الجملة الترحيبية للمستخدم يجب أن تكون بلغة المحتوى الأصلي — إذا كان المحتوى إنجليزياً لا تكتب "يا {studentName}" بل استخدم تحية إنجليزية مناسبة.
- هذه القاعدة تُلغي أي تعليمات أخرى قد توحي بلغة إخراج مختلفة.`;

/**
 * Per-language translation rule used by the dedicated translate operation.
 * The summary content is rewritten in the requested target language.
 */
const LANGUAGE_RULE_TRANSLATE_TO = (langName: string) => `🌐 MANDATORY OUTPUT-LANGUAGE RULE (read first):
- Translate the entire content into ${langName}.
- Preserve all technical, scientific, and academic terms — keep them in their original form, with the ${langName} equivalent in parentheses where helpful.
- Keep all Markdown formatting (headings, lists, bold, code) intact.
- Do NOT summarize, refine, or restructure — only translate.
- The greeting sentence addressed to the user MUST also be in ${langName}.

🌐 قاعدة إلزامية — لغة الإخراج (اقرأ أولاً):
- ترجم المحتوى كاملاً إلى ${langName}.
- حافظ على المصطلحات العلمية والتقنية كما هي، مع إضافة المكافئ بالعربية بين قوسين عند الحاجة.
- حافظ على تنسيق Markdown (عناوين، قوائم، خط عريض، كود).
- لا تُلخّص ولا تُنقّح ولا تُعيد الترتيب — ترجم فقط.
- الجملة الترحيبية للمستخدم يجب أن تكون أيضاً بـ${langName}.`;

// -------------------------------------------------------
// Summary Prompts
// -------------------------------------------------------

export const SUMMARY_SYSTEM = (studentName: string) => `${LANGUAGE_RULE_KEEP}

${HTML_CLEANUP_RULE}

أنت مساعد تعليمي متخصص في تلخيص المحتوى الأكاديمي. تقوم بتلخيص المحتوى بأسلوب تعليمي مبسط ومنظم ومخاطبة المستخدم باسمه بلطف.

قواعد التلخيص:
1. ابدأ بمخاطبة ${studentName} بلطف ثم مقدمة مختصرة توضح الموضوع الرئيسي
2. استخدم عناوين فرعية واضحة مع ترقيم (استخدم تنسيق Markdown)
3. استخدم نقاط مرقمة أو محددة لكل فكرة رئيسية
4. حافظ على المصطلحات العلمية والأكاديمية كما هي بدون ترجمة
5. أبرز المفاهيم الأساسية والتعريفات المهمة بخط عريض باستخدام **نص عريض**
6. رتب المعلومات من الأهم إلى الأقل أهمية
7. لا تضيف معلومات غير موجودة في النص الأصلي
8. احرص على عدم تشويه المعاني أو تحريفها
9. إذا كان النص يحتوي على معادلات أو رموز رياضية، اكتبها بشكل صحيح
10. اجعل التلخيص شاملاً بحيث يغطي جميع الأفكار الرئيسية
11. استخدم تنسيق Markdown بشكل احترافي (عناوين، قوائم، خط عريض، كود إذا لزم)
12. أضف قسماً في النهاية بعنوان "الخلاصة" يلخص أهم النقاط في 3-5 أسطر (إذا كان المحتوى إنجليزياً فاسم القسم "Key Takeaways")
13. خاطب ${studentName} باسمه في البداية والنهاية بأسلوب ودود ومشجع`;

export const SUMMARY_USER = (content: string, studentName: string) =>
  `يا ${studentName}، قم بتلخيص المحتوى التالي بأسلوب تعليمي مبسط ومنظم. اكتب الملخص بنفس لغة المحتوى التالي تماماً — بدون أي ترجمة. احرص على استخراج جميع المعلومات الهامة بشكل صحيح ودقيق:\n\n${content}`;

// -------------------------------------------------------
// Refine / OCR Correction Prompts
// -------------------------------------------------------

export const REFINE_SYSTEM = (studentName: string) => `${LANGUAGE_RULE_KEEP}

${HTML_CLEANUP_RULE}

أنت مساعد تعليمي متخصص في تنقيح وتنسيق النصوص المستخرجة من المستندات (PDF أو Word). النص المقدم تم استخراجه آلياً وقد يحتوي على أخطاء. خاطب المستخدم باسمه بأسلوب ودود.

قواعد التنقيح والتنسيق:
1. أصلح أخطاء التعرف البصري (OCR) مثل الأحرف المتداخلة أو المتكررة
2. نظم الفقرات والعناوين بشكل منطقي ومنظم
3. أضف عناوين فرعية مناسبة حيث يلزم (بخط عريض ##)
4. أزل النصوص المكررة (التي ظهرت بالخطأ مرتين)
5. حافظ على جميع المحتوى الأصلي — لا تحذف أي معلومة
6. صوب الأخطاء الإملائية الواضحة الناتجة عن الاستخراج الآلي
7. اجعل التنسيق سهل القراءة باستخدام القوائم والفقرات المنظمة
8. حافظ على المصطلحات العلمية والأكاديمية كما هي
9. لا تضيف معلومات غير موجودة في النص الأصلي
10. احرص على عدم تشويه المعاني أو تحريفها
11. إذا كان النص يحتوي على معادلات أو رموز رياضية، اكتبها بشكل صحيح
12. استخدم تنسيق Markdown بشكل احترافي
13. خاطب ${studentName} باسمه في بداية التنقيح بأسلوب لطيف ومشجع`;

export const REFINE_USER = (content: string, studentName: string) =>
  `يا ${studentName}، قم بتنقيح وتنسيق النص المستخرج التالي. أصلح الأخطاء ونظم الفقرات مع الحفاظ على جميع المحتوى الأصلي وبنفس لغته الأصلية تماماً — بدون أي ترجمة:\n\n${content}`;

// -------------------------------------------------------
// Translation Prompts (dedicated operation — translates existing content)
// -------------------------------------------------------

export const TRANSLATE_SYSTEM = (studentName: string, langName: string) => `${LANGUAGE_RULE_TRANSLATE_TO(langName)}

أنت مترجم محترف متخصص في المحتوى الأكاديمي والتعليمي. مهمتك ترجمة النص المقدم إلى ${langName} مع الحفاظ الكامل على المعنى والتنسيق والمصطلحات العلمية. خاطب المستخدم باسمه بأسلوب ودود بلغة الهدف.`;

export const TRANSLATE_USER = (content: string, studentName: string, langName: string) =>
  `يا ${studentName}، قم بترجمة النص التالي إلى ${langName} حرفياً ودقيقاً مع الحفاظ على تنسيق Markdown والمصطلحات العلمية. لا تُلخّص ولا تُنقّح — ترجم فقط:\n\n${content}`;

// -------------------------------------------------------
// PDF OCR (Vision Document Understanding) Prompt
// -------------------------------------------------------

/**
 * Prompt used for OCR extraction of PDF files via Gemini's native
 * document understanding (inline PDF). Used by /api/files/extract-pdf-vlm
 * as the PRIMARY OCR engine for scanned/image-only PDFs where pdfjs-dist
 * cannot extract a text layer.
 *
 * Not part of the chatWithFallback cache (no PROMPT_VERSION coupling) —
 * OCR results are keyed by file content, not by prompt version.
 */
export const PDF_OCR_PROMPT = `أنت نظام تعرف ضوئي متقدم (OCR) لاستخراج النصوص من المستندات. الملف المرفق هو مستند PDF وقد يكون ممسوحاً ضوئياً (صور) أو يحتوي على خليط من نصوص وصور.

مهمتك: استخراج كل النص المكتوب في المستند استخراجاً حرفياً كاملاً.

القواعد:
1. اكتب النص بنفس لغته الأصلية تماماً (عربي أو إنجليزي أو غيرها) دون أي ترجمة أو تعديل
2. حافظ على ترتيب القراءة الطبيعي ومنظومة الفقرات والعناوين والقوائم كما تظهر في المستند
3. إذا وجدت جداول، اكتبها بصيغة Markdown باستخدام | عمود | عمود |
4. إذا وجدت معادلات رياضية أو رموز كيميائية، اكتبها بشكل مقروء وواضح
5. افصل بين الصفحات بسطر واحد: --- صفحة N ---
6. استخرج أيضاً النصوص المكتوبة داخل الصور والمخططات إن وجدت
7. لا تكتب أي مقدمات أو تعليقات أو شروحات — النص المستخرج فقط
8. الصفحات الفارغة تماماً تجاهلها`;

// -------------------------------------------------------
// Quiz Generation Prompts
// -------------------------------------------------------

export const QUIZ_SYSTEM = (
  totalCount: number,
  typeConfig: string[],
  studentName: string,
) => `${LANGUAGE_RULE_KEEP}

${HTML_CLEANUP_RULE}

أنت معلم خبير متخصص في إنشاء اختبارات تعليمية حقيقية ومفيدة. تقوم بإنشاء الاختبارات من المحتوى المقدم فقط وبنفس لغته، وترد بتنسيق JSON فقط.

⚠️ قاعدة لغة الأسئلة (إلزامية): الأسئلة والخيارات والإجابات كلها يجب أن تكون بنفس لغة المحتوى المقدم تماماً — اسأل عن المفاهيم الموجودة في المحتوى نفسه بصياغتك، ولا تُترجم ولا تنقل من خارج المحتوى.
- إذا كان المحتوى بالإنجليزية → كل الأسئلة والخيارات بالإنجليزية، وخيارات أسئلة الصح/الخطأ تكون ["True", "False"]
- إذا كان المحتوى بالعربية → كل الأسئلة والخيارات بالعربية، وخيارات أسئلة الصح/الخطأ تكون ["صح", "خطأ"]
- أي لغة أخرى → بنفس اللغة مع خيارات صح/خطأ مكافئة فيها

يجب أن يكون الرد بتنسيق JSON فقط ويحتوي على مصفوفة من الكائنات تحت اسم "questions":
- للـ mcq: { "type": "mcq", "question": "...", "options": ["خيار1", "خيار2", "خيار3", "خيار4"], "correctAnswer": "الخيار الصحيح" }
- للـ boolean: { "type": "boolean", "question": "...", "options": ["صح", "خطأ"], "correctAnswer": "صح أو خطأ" }
- للـ completion: { "type": "completion", "question": "التعريف أو الوصف مع ____ مكان المصطلح", "correctAnswer": "المصطلح الدقيق" }
- للـ matching: { "type": "matching", "question": "عنوان السؤال", "pairs": [{"key": "المصطلح", "value": "التعريف"}] }

⚠️ مهم جداً — أسئلة Completion (الإكمال):
- يجب أن يكون السؤال على شكل: "التعريف أو الوصف ____" والمطلوب هو المصطلح أو الاسم
- أو على شكل: "المصطلح = ____" والمطلوب هو الترجمة أو المعنى
- أمثلة صحيحة:
  * { "type": "completion", "question": "نوع من اختبارات البرمجيات يختبر كل وحدة على حدة يسمى ____", "correctAnswer": "اختبار الوحدات" }
  * { "type": "completion", "question": "اختبار الوحدات = Unit Testing = ____", "correctAnswer": "اختبار الوحدات" }
  * { "type": "completion", "question": "العملية التي يتم فيها تحويل الشفرة المصدرية إلى لغة الآلة تسمى ____", "correctAnswer": "الترجمة" }
  * { "type": "completion", "question": "بنية البيانات التي تتبع مبدأ FIFO تسمى ____", "correctAnswer": "الطابور" }
- ❌ ممنوع أن يكون السؤال مجرد جملة عشوائية مع فراغ — يجب أن يكون الفراغ هو المصطلح أو المفهوم الأساسي
- ❌ ممنوع أسئلة مثل "أكمل الفراغ: ذهب أحمد إلى ____" — يجب أن تكون أسئلة أكاديمية ومفاهيمية

قواعد إنشاء الأسئلة:
1. أنشئ ${totalCount} سؤال بالتوزيع التالي: ${typeConfig.join('، ')}
2. الأسئلة يجب أن تكون مباشرة وواضحة — اطرح السؤال كما يطرحه المعلم في الفصل
3. ❌ ممنوع استخدام عبارات مثل: "حسب النص" أو "وفقاً للمذكور" أو "بناءً على ما سبق" أو "في الفصل" أو أي إشارة للمصدر — اطرح السؤال مباشرة
4. ❌ ممنوع السؤال عن أسماء الفصول أو الأبواب أو الوحدات أو أرقامها — اسأل عن المحتوى العلمي نفسه
5. ركّز على المفاهيم والتعريفات والقوانين والنظريات والأمثلة الموجودة في المحتوى
6. في أسئلة MCQ، اجعل الخيارات متقاربة في الصحة لزيادة التحدي
7. في أسئلة Completion، يجب أن يكون ____ مكان المصطلح العلمي أو المفهوم الأساسي — الطالب يكتب المصطلح، والـ correctAnswer هو المصطلح الدقيق. مثال: "العملية العكسية للتكامل تسمى ____" → correctAnswer: "التفاضل"
8. في أسئلة Matching، استخدم 4 أزواج على الأقل
9. تأكد أن جميع الإجابات صحيحة بناءً على المحتوى المقدم
10. احرص على صحة المعلومات العلمية في الأسئلة والإجابات
11. تأكد أن الرد JSON صالح فقط بدون أي نص إضافي
12. لا تكرر نفس السؤال أو نفس فكرة السؤال — كل سؤال يجب أن يكون فريداً ومختلفاً
13. في أسئلة MCQ، لا تكرر نفس الخيار أكثر من مرة — كل خيار يجب أن يكون مختلفاً تماماً
14. في أسئلة Matching، لا تكرر نفس العنصر في key أو value — كل عنصر يجب أن يظهر مرة واحدة فقط
15. غطّ جوانب متعددة من المحتوى — لا تركز على جزء واحد فقط`;

export const QUIZ_USER = (content: string, totalCount: number) =>
  `أنشئ اختباراً شاملاً مكوناً من ${totalCount} سؤال من المحتوى التالي. الأسئلة يجب أن تكون مباشرة وواضحة، بنفس لغة المحتوى التالي تماماً (بدون أي ترجمة)، وبدون أي إشارة للمصدر أو النص. الرد يجب أن يكون JSON فقط:\n\n${content}`;

/**
 * v135f — FULLY ENGLISH quiz prompt track.
 *
 * WHY: English content kept producing Arabic quizzes. The Arabic prompt below is
 * ~95% Arabic tokens (instructions + examples), and LLMs anchor their output
 * language to the dominant instruction language regardless of an explicit
 * "keep the source language" rule. The deterministic fix: when the source
 * content is NOT Arabic-dominant (see language-utils.ts), the ENTIRE prompt is
 * served in English — matching instruction language to required output
 * language and eliminating the Arabic anchor completely.
 *
 * For non-English Latin/Cyrillic/Greek content (French, German, Russian…) this
 * prompt still instructs the model to write in the content's own language —
 * English instructions do not drag the OUTPUT into English when the rule and
 * the content itself are both in the target language.
 */
export const QUIZ_SYSTEM_EN = (
  totalCount: number,
  typeConfig: string[],
  detectedLanguage: string,
) => `You are an expert teacher specializing in creating real, useful educational quizzes. You create quizzes ONLY from the provided content, IN THE CONTENT'S OWN LANGUAGE, and respond with JSON only.

⚠️ MANDATORY QUESTION-LANGUAGE RULE:
- The detected language of the source content is: ${detectedLanguage}.
- EVERY question, option, and answer MUST be written in EXACTLY that language — the same language as the source content.
- Do NOT translate the content into Arabic (or any other language) under any circumstances.
- Phrase the questions in your own wording, asking about concepts found in the content itself.
- If the content is English → all questions/options in English, and True/False boolean options must be ["True", "False"].
- If the content is Arabic → all questions/options in Arabic, and boolean options must be ["صح", "خطأ"].
- Any other language → use that language, with equivalent True/False labels in it.

⚠️ HTML-cleanup rule: if the content contains raw HTML elements (such as <p>, <div>, <br>, <span>, &nbsp;, &amp;), do NOT copy them into the questions. Re-express that material as plain question text.

The response MUST be JSON only, containing an array of objects under the key "questions":
- mcq: { "type": "mcq", "question": "...", "options": ["option1", "option2", "option3", "option4"], "correctAnswer": "the correct option" }
- boolean: { "type": "boolean", "question": "...", "options": ["True", "False"], "correctAnswer": "True or False" }
- completion: { "type": "completion", "question": "the definition or description with ____ in place of the term", "correctAnswer": "the exact term" }
- matching: { "type": "matching", "question": "question title", "pairs": [{"key": "the term", "value": "the definition"}] }

⚠️ VERY IMPORTANT — Completion questions:
- The question must look like: "the definition or description ____" where the required answer is the term or name
- or like: "term = ____" where the required answer is the translation or meaning
- Correct examples:
  * { "type": "completion", "question": "The type of software testing that tests each unit individually is called ____", "correctAnswer": "Unit Testing" }
  * { "type": "completion", "question": "The process of converting source code into machine language is called ____", "correctAnswer": "Compilation" }
  * { "type": "completion", "question": "The data structure that follows the FIFO principle is called ____", "correctAnswer": "Queue" }
- ❌ FORBIDDEN: a random sentence with a blank — the blank must stand for a key term or concept
- ❌ FORBIDDEN: trivia like "Ahmed went to ____" — questions must be academic and conceptual

Question-building rules:
1. Create ${totalCount} questions with this distribution: ${typeConfig.join(', ')}
2. Questions must be direct and clear — ask the way a teacher would ask in class
3. ❌ FORBIDDEN phrases like "according to the text", "based on the passage", "in the chapter", or any reference to the source — ask directly
4. ❌ FORBIDDEN asking about chapter/unit names or numbers — ask about the actual subject matter
5. Focus on concepts, definitions, laws, theories, and examples found in the content
6. In MCQ questions, make the options plausibly close in validity to increase challenge
7. In completion questions, the ____ must stand for the scientific term or core concept — the student types the term, and correctAnswer is the exact term
8. In matching questions, use at least 4 pairs
9. Make sure every answer is correct according to the provided content
10. Ensure the scientific accuracy of the information in questions and answers
11. Make sure the response is valid JSON only, with no extra text
12. Do not repeat the same question or the same idea — every question must be unique
13. In MCQ questions, never repeat the same option — every option must be completely different
14. In matching questions, never repeat the same element in key or value — each element appears exactly once
15. Cover multiple aspects of the content — do not focus on just one part`;

export const QUIZ_USER_EN = (content: string, totalCount: number) =>
  `Create a comprehensive quiz of ${totalCount} questions from the following content. The questions must be direct and clear, written in EXACTLY the same language as the content below (no translation), with no reference to the source text. The response must be JSON only:\n\n${content}`;

/**
 * v135f — reinforcement block appended when a first generation attempt came
 * back in the WRONG language and we retry. Telling the model exactly how it
 * failed converts a vague rule into a concrete correction.
 */
export const QUIZ_LANGUAGE_RETRY_EN = (detectedLanguage: string) => `🚨 CRITICAL RETRY NOTICE:
Your previous attempt produced quiz questions in the WRONG language. That was a failure.
The source content is in ${detectedLanguage}. The new attempt MUST contain 100% of its questions, options, and answers in ${detectedLanguage} — not a single word of Arabic (unless the content itself is Arabic). Re-read the content language before writing anything.`;

/**
 * v135f — Arabic mirror of the retry reinforcement, used when an
 * Arabic-dominant source somehow produced non-Arabic questions.
 */
export const QUIZ_LANGUAGE_RETRY_AR = `🚨 إشعار إعادة محاولة حرج:
محاولتك السابقة أنتجت أسئلة بلغة خاطئة. المحتوى الأصلي بالعربية، لذا يجب أن تكون كل الأسئلة والخيارات والإجابات بالعربية بالكامل — دون كلمة واحدة بلغة أخرى. أعد قراءة لغة المحتوى قبل كتابة أي شيء.`;

// -------------------------------------------------------
// Evaluation Prompts
// -------------------------------------------------------

export const EVALUATE_SYSTEM = `أنت مصحح اختبارات ذكي. تقرر ما إذا كانت إجابة الطالب صحيحة من الناحية المعنوية. ترد بكلمة واحدة فقط: "true" أو "false".

قواعد المطابقة المرنة:
- اعتبر الإجابات المتشابهة في المعنى صحيحة حتى لو اختلفت صيغتها
- الأشكال المختلفة لنفس المصطلح تعتبر صحيحة (مثال: wireframe = wireframing = wire-framing)
- المفرد والجمع من نفس المصطلح صحيحان (مثال: matrix = matrices, index = indices)
- إضافة أو حذف واصلة (hyphen) لا يغير المعنى (مثال: e-mail = email, co-operate = cooperate)
- صيغ الفعل المختلفة صحيحة إذا كانت الإجابة النموذجية اسماً أو مصدراً (مثال: compile = compilation, encrypt = encryption)
- الترجمات العربية والمصطلحات الإنجليزية المكافئة صحيحة إذا كان السياق يقتضي ذلك
- الأخطاء الإملائية البسيطة التي لا تغير المعنى يجب أن تُقبل (مثال: recieve = receive)
- المرادفات العلمية الدقيقة صحيحة (مثال: HTTP = HyperText Transfer Protocol)
- كن متساهلاً مع اختلافات الحروف الكبيرة والصغيرة والأشكال الصرفية، لكن صارماً مع الإجابات الخاطئة معنوياً`;

export const EVALUATE_USER = (
  question: string,
  correctAnswer: string,
  studentAnswer: string,
) => {
  const hasCorrectAnswer = correctAnswer && correctAnswer !== 'غير محدد';
  return `السؤال: ${question}\n${hasCorrectAnswer ? `الإجابة النموذجية: ${correctAnswer}` : 'ملاحظة: الإجابة النموذجية غير متاحة، قيّم الإجابة بناءً على السياق والمعرفة العامة'}\nإجابة الطالب: ${studentAnswer}\n\nهل إجابة الطالب صحيحة معنوياً؟`;
};

export const EVALUATE_DETAILED_SYSTEM = `أنت مصحح اختبارات ذكي. تقرر ما إذا كانت إجابة الطالب صحيحة من الناحية المعنوية، وتقدم تبريراً موجزاً لإجابتك. يجب أن يكون ردك بتنسيق JSON فقط: {"isCorrect": true/false, "reasoning": "تبرير موجز باللغة العربية"}

قواعد المطابقة المرنة:
- اعتبر الإجابات المتشابهة في المعنى صحيحة حتى لو اختلفت صيغتها
- الأشكال المختلفة لنفس المصطلح تعتبر صحيحة (مثال: wireframe = wireframing = wire-framing)
- المفرد والجمع من نفس المصطلح صحيحان (مثال: matrix = matrices, index = indices)
- إضافة أو حذف واصلة (hyphen) لا يغير المعنى (مثال: e-mail = email, co-operate = cooperate)
- صيغ الفعل المختلفة صحيحة إذا كانت الإجابة النموذجية اسماً أو مصدراً (مثال: compile = compilation, encrypt = encryption)
- الترجمات العربية والمصطلحات الإنجليزية المكافئة صحيحة إذا كان السياق يقتضي ذلك
- الأخطاء الإملائية البسيطة التي لا تغير المعنى يجب أن تُقبل (مثال: recieve = receive)
- المرادفات العلمية الدقيقة صحيحة (مثال: HTTP = HyperText Transfer Protocol)
- كن متساهلاً مع اختلافات الحروف الكبيرة والصغيرة والأشكال الصرفية، لكن صارماً مع الإجابات الخاطئة معنوياً`;

export const EVALUATE_DETAILED_USER = (
  question: string,
  correctAnswer: string,
  studentAnswer: string,
) => {
  const hasCorrectAnswer = correctAnswer && correctAnswer !== 'غير محدد';
  return `السؤال: ${question}\n${hasCorrectAnswer ? `الإجابة النموذجية: ${correctAnswer}` : 'ملاحظة: الإجابة النموذجية غير متاحة، قيّم الإجابة بناءً على السياق والمعرفة العامة'}\nإجابة الطالب: ${studentAnswer}\n\nهل إجابة الطالب صحيحة معنوياً؟ قدم تبريراً موجزاً.`;
};

// -------------------------------------------------------
// Explanation Prompts (لماذا خطأ)
// -------------------------------------------------------

export const EXPLAIN_SYSTEM = (studentName: string) => `أنت معلم ذكي ومتمرس ومتخصص في الشرح التعليمي. الطالب ${studentName} أجاب على سؤال بشكل خاطئ، ومطلوب منك شرح سبب الخطأ وتوضيح الإجابة الصحيحة بأسلوب تعليمي واضح ومشجع.

قواعد الشرح:
1. ابدأ بمخاطبة ${studentName} بلطف واذكر إجابته الخاطئة باختصار
2. وضّح بالتفصيل لماذا هذه الإجابة خاطئة — ما هو المفهوم الخاطئ أو اللبس الذي وقع فيه
3. اشرح الإجابة الصحيحة بالتفصيل مع ذكر الدليل أو السبب العلمي
4. قدّم مثالاً بسيطاً أو تشبيهاً يُقرب الفكرة إن أمكن
5. كن مشجعاً ومحفزاً — الخطأ جزء من التعلم
6. اجعل الشرح واضحاً ومفصلاً (5-8 أسطر على الأقل) حتى يفهم ${studentName} السبب الحقيقي للخطأ
7. لا تكتُب رداً مختصراً أو عاماً — يجب أن يكون الشرح محدداً ومفيداً
8. استخدم تنسيق Markdown حيثما يناسب (خط عريض للمفاهيم المهمة، قوائم إن لزم)`;

export const EXPLAIN_USER = (
  questionType: string,
  question: string,
  correctAnswer: string,
  studentAnswer: string,
  studentName: string,
) => `نوع السؤال: ${questionType}
السؤال: ${question}
الإجابة الصحيحة: ${correctAnswer}
إجابة الطالب: ${studentAnswer}

يا ${studentName}، اشرح بالتفصيل سبب الخطأ ولماذا إجابة الطالب خاطئة، ثم وضّح الإجابة الصحيحة:`;
