import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import JSZip from 'jszip';
import type { ScormVersion } from '@/lib/scorm-types';

// ─── POST Handler: Export content as a SCORM package ───
// Supports: lesson, subject, questionBank
// Question bank export allows selecting specific banks or questions

export async function POST(request: NextRequest) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { subjectId, contentType, contentIds, version, title, description, bankIds, questionIds } = body as {
      subjectId: string;
      contentType: 'lesson' | 'subject' | 'questionBank';
      contentIds?: string[];
      version?: ScormVersion;
      title?: string;
      description?: string;
      bankIds?: string[];
      questionIds?: string[];
    };

    if (!subjectId || !contentType) {
      return NextResponse.json(
        { success: false, error: 'subjectId and contentType are required' },
        { status: 400 }
      );
    }

    const scormVersion = version || '1.2';

    // ── Verify subject ownership ──
    const { data: subject, error: subjectError } = await supabaseServer
      .from('subjects')
      .select('id, name, description, teacher_id')
      .eq('id', subjectId)
      .single();

    if (subjectError || !subject) {
      console.error('[SCORM Export] Subject query error:', subjectError?.message);
      return NextResponse.json(
        { success: false, error: 'Subject not found' },
        { status: 404 }
      );
    }

    // Verify teacher is owner or co-teacher
    if (subject.teacher_id !== authResult.user.id) {
      const { data: coTeacher } = await supabaseServer
        .from('subject_teachers')
        .select('id')
        .eq('subject_id', subjectId)
        .eq('teacher_id', authResult.user.id)
        .maybeSingle();
      if (!coTeacher) {
        return NextResponse.json(
          { success: false, error: 'You do not have access to this subject' },
          { status: 403 }
        );
      }
    }

    const packageTitle = title || subject.name;
    const packageDescription = description || subject.description || '';

    let zip: JSZip;

    switch (contentType) {
      case 'lesson':
        zip = await exportLessonAsScorm(subjectId, contentIds || [], scormVersion, packageTitle, authResult.user.id);
        break;
      case 'subject':
        zip = await exportSubjectAsScorm(subjectId, scormVersion, packageTitle, packageDescription, authResult.user.id);
        break;
      case 'questionBank':
        zip = await exportQuestionBankAsScorm(
          subjectId,
          bankIds || [],
          questionIds || [],
          scormVersion,
          packageTitle,
          authResult.user.id
        );
        break;
      default:
        return NextResponse.json(
          { success: false, error: `Invalid contentType: ${contentType}. Supported types: 'lesson', 'subject', 'questionBank'` },
          { status: 400 }
        );
    }

    // ── Generate the ZIP buffer ──
    const zipBuffer = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // ── Return the ZIP as a downloadable file ──
    const fileName = `${packageTitle.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_')}_scorm_${scormVersion}.zip`;

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': zipBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error('[SCORM Export] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to export SCORM package';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

// ─── Export Lesson as SCORM Package ───

async function exportLessonAsScorm(
  subjectId: string,
  lessonIds: string[],
  version: ScormVersion,
  packageTitle: string,
  userId: string
): Promise<JSZip> {
  let lessonsQuery = supabaseServer
    .from('lessons')
    .select('id, title, content_html, content_json, published_json, status, subject_id')
    .eq('subject_id', subjectId);

  if (lessonIds.length > 0) {
    lessonsQuery = lessonsQuery.in('id', lessonIds);
  }

  // Only export published lessons
  lessonsQuery = lessonsQuery.eq('status', 'published');

  const { data: lessons, error } = await lessonsQuery;
  if (error) {
    console.error('[SCORM Export] Lessons query error:', error.message);
    throw new Error(`Failed to fetch lessons: ${error.message}`);
  }
  if (!lessons || lessons.length === 0) {
    throw new Error('No published lessons found for export. Please publish at least one lesson first.');
  }

  const zip = new JSZip();
  const items: Array<{ identifier: string; title: string; identifierref: string }> = [];

  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i];
    const scoId = `lesson_${lesson.id}`;
    const resourceId = `res_lesson_${lesson.id}`;
    const htmlFileName = `lesson_${i + 1}.html`;

    // Generate lesson HTML content
    const lessonHtml = generateLessonHtml(lesson, version);

    zip.file(htmlFileName, lessonHtml);

    items.push({
      identifier: scoId,
      title: lesson.title || `Lesson ${i + 1}`,
      identifierref: resourceId,
    });
  }

  // Generate manifest
  const manifest = generateManifest(packageTitle, items, version, 'lesson');
  zip.file('imsmanifest.xml', manifest);

  // Add SCORM API wrapper script
  zip.file('scorm_api_wrapper.js', generateScormApiWrapper(version));

  // Add required XSD files
  addXsdFiles(zip, version);

  return zip;
}

// ─── Export Entire Subject as SCORM Package (lessons only) ───

async function exportSubjectAsScorm(
  subjectId: string,
  version: ScormVersion,
  packageTitle: string,
  packageDescription: string,
  userId: string
): Promise<JSZip> {
  // Fetch all published lessons (question banks are NOT included — they use JSON format separately)
  const { data: lessons, error: lessonsError } = await supabaseServer
    .from('lessons')
    .select('id, title, content_html, content_json, published_json, status, subject_id')
    .eq('subject_id', subjectId)
    .eq('status', 'published');

  if (lessonsError) {
    console.error('[SCORM Export] Subject lessons query error:', lessonsError.message);
    throw new Error(`Failed to fetch subject lessons: ${lessonsError.message}`);
  }

  if (!lessons || lessons.length === 0) {
    throw new Error('No published lessons found in this subject. Please publish at least one lesson before exporting as SCORM.');
  }

  const zip = new JSZip();
  const items: Array<{ identifier: string; title: string; identifierref: string }> = [];

  // Create lessons folder
  const lessonsFolder = zip.folder('lessons');

  // Add lessons
  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i];
    const scoId = `lesson_${lesson.id}`;
    const resourceId = `res_lesson_${lesson.id}`;

    const lessonHtml = generateLessonHtml(lesson, version);
    lessonsFolder!.file(`lesson_${i + 1}.html`, lessonHtml);

    items.push({
      identifier: scoId,
      title: lesson.title || `Lesson ${i + 1}`,
      identifierref: resourceId,
    });
  }

  // Generate manifest
  const manifest = generateManifest(packageTitle, items, version, 'subject', packageDescription);
  zip.file('imsmanifest.xml', manifest);

  // Add SCORM API wrapper script
  zip.file('scorm_api_wrapper.js', generateScormApiWrapper(version));

  // Add required XSD files
  addXsdFiles(zip, version);

  return zip;
}

// ─── Export Question Banks as SCORM Package ───
// Supports selective export: bankIds to select whole banks, questionIds to select individual questions

async function exportQuestionBankAsScorm(
  subjectId: string,
  bankIds: string[],
  questionIds: string[],
  version: ScormVersion,
  packageTitle: string,
  userId: string
): Promise<JSZip> {
  // ── Fetch question banks ──
  let banksQuery = supabaseServer
    .from('question_banks')
    .select('id, name, description, subject_id, teacher_id')
    .eq('subject_id', subjectId);

  if (bankIds.length > 0) {
    banksQuery = banksQuery.in('id', bankIds);
  }

  const { data: banks, error: banksError } = await banksQuery;
  if (banksError) {
    console.error('[SCORM Export] Question banks query error:', banksError.message);
    throw new Error(`Failed to fetch question banks: ${banksError.message}`);
  }

  if (!banks || banks.length === 0) {
    throw new Error('No question banks found for export. Please select at least one question bank.');
  }

  const zip = new JSZip();
  const items: Array<{ identifier: string; title: string; identifierref: string }> = [];

  // ── Fetch questions for each bank ──
  const allBankIds = banks.map(b => b.id);

  let questionsQuery = supabaseServer
    .from('bank_questions')
    .select('id, bank_id, type, question, options, correct_answer, pairs, difficulty, category')
    .in('bank_id', allBankIds)
    .order('created_at', { ascending: true });

  // If specific question IDs are provided, filter to only those
  if (questionIds.length > 0) {
    questionsQuery = questionsQuery.in('id', questionIds);
  }

  const { data: questions, error: questionsError } = await questionsQuery;
  if (questionsError) {
    console.error('[SCORM Export] Bank questions query error:', questionsError.message);
    throw new Error(`Failed to fetch bank questions: ${questionsError.message}`);
  }

  if (!questions || questions.length === 0) {
    throw new Error('No questions found in the selected question banks. Please select banks with questions.');
  }

  // ── Group questions by bank ──
  const questionsByBank: Record<string, Array<Record<string, unknown>>> = {};
  for (const q of questions) {
    if (!questionsByBank[q.bank_id]) {
      questionsByBank[q.bank_id] = [];
    }
    questionsByBank[q.bank_id].push(q);
  }

  // ── Generate quiz HTML for each bank ──
  const quizzesFolder = zip.folder('quizzes');
  let quizIndex = 0;

  for (const bank of banks) {
    const bankQuestions = questionsByBank[bank.id] || [];
    if (bankQuestions.length === 0) continue; // Skip empty banks

    quizIndex++;
    const scoId = `quiz_${bank.id}`;
    const resourceId = `res_quiz_${bank.id}`;
    const htmlFileName = `quiz_${quizIndex}.html`;

    const quizHtml = generateQuizHtml(bank, bankQuestions, version);
    quizzesFolder!.file(htmlFileName, quizHtml);

    items.push({
      identifier: scoId,
      title: bank.name || `Quiz ${quizIndex}`,
      identifierref: resourceId,
    });
  }

  if (items.length === 0) {
    throw new Error('No questions found to export. Please select question banks that contain questions.');
  }

  // Generate manifest — each quiz is a SCO
  const manifestItems = items.map(item => ({
    ...item,
    hrefOverride: `quizzes/${item.identifierref.replace('res_quiz_', 'quiz_')}.html`,
  }));

  const manifest = generateManifest(
    packageTitle,
    manifestItems,
    version,
    'questionBank',
    packageDescription || ''
  );
  zip.file('imsmanifest.xml', manifest);

  // Add SCORM API wrapper script
  zip.file('scorm_api_wrapper.js', generateScormApiWrapper(version));

  // Add required XSD files
  addXsdFiles(zip, version);

  return zip;
}

// ─── Quiz HTML Generation ───
// Generates an interactive quiz page with SCORM API integration for score tracking

function generateQuizHtml(
  bank: Record<string, unknown>,
  questions: Array<Record<string, unknown>>,
  version: ScormVersion
): string {
  const bankName = (bank.name as string) || 'Quiz';
  const bankDescription = (bank.description as string) || '';

  // Serialize questions as JSON for the quiz engine
  const quizData = questions.map(q => ({
    id: q.id,
    type: q.type,
    question: q.question,
    options: q.options,
    correct_answer: q.correct_answer,
    pairs: q.pairs,
    difficulty: q.difficulty,
    category: q.category,
  }));

  const quizDataJson = JSON.stringify(quizData);

  const apiInitCode = version === '1.2'
    ? `var scormApi = window.API || parent.API || opener.API || null;`
    : `var scormApi = window.API_1484_11 || parent.API_1484_11 || opener.API_1484_11 || null;`;

  const scormSetPrefix = version === '1.2' ? 'cmi.core' : 'cmi';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bankName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #f5f5f5; color: #333; padding: 20px; direction: rtl; }
    .quiz-container { max-width: 800px; margin: 0 auto; background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .quiz-header { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e0e0e0; }
    .quiz-title { font-size: 24px; font-weight: bold; color: #1a1a1a; }
    .quiz-desc { font-size: 14px; color: #666; margin-top: 8px; }
    .question-card { margin-bottom: 24px; padding: 16px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa; }
    .question-number { font-size: 12px; color: #0369A1; font-weight: bold; margin-bottom: 8px; }
    .question-text { font-size: 16px; font-weight: 500; margin-bottom: 12px; line-height: 1.6; }
    .options-list { list-style: none; padding: 0; }
    .option-item { padding: 12px 16px; margin-bottom: 8px; border: 2px solid #e0e0e0; border-radius: 8px; cursor: pointer; transition: all 0.2s; font-size: 14px; }
    .option-item:hover { border-color: #0369A1; background: #f0f9ff; }
    .option-item.selected { border-color: #0369A1; background: #0369A1; color: white; }
    .boolean-options { display: flex; gap: 12px; }
    .boolean-btn { padding: 12px 24px; border: 2px solid #e0e0e0; border-radius: 8px; cursor: pointer; transition: all 0.2s; font-size: 16px; font-weight: 500; }
    .boolean-btn:hover { border-color: #0369A1; }
    .boolean-btn.selected { border-color: #0369A1; background: #0369A1; color: white; }
    .completion-input { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; direction: rtl; }
    .completion-input:focus { border-color: #0369A1; outline: none; }
    .matching-container { display: flex; flex-direction: column; gap: 12px; }
    .match-row { display: flex; gap: 12px; align-items: center; }
    .match-left { flex: 1; padding: 8px 12px; background: #f0f9ff; border-radius: 8px; font-size: 14px; }
    .match-select { flex: 1; padding: 8px 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; background: white; }
    .progress-bar { width: 100%; height: 6px; background: #e0e0e0; border-radius: 3px; margin-bottom: 24px; }
    .progress-fill { height: 100%; background: #0369A1; border-radius: 3px; transition: width 0.3s; }
    .submit-btn { display: block; width: 100%; padding: 16px; background: #0369A1; color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; margin-top: 24px; transition: all 0.2s; }
    .submit-btn:hover { background: #0284c7; }
    .submit-btn:disabled { background: #ccc; cursor: not-allowed; }
    .results-container { text-align: center; padding: 32px; }
    .score-display { font-size: 48px; font-weight: bold; color: #0369A1; }
    .score-label { font-size: 16px; color: #666; margin-top: 8px; }
    .pass-badge { display: inline-block; padding: 8px 16px; background: #10b981; color: white; border-radius: 8px; font-weight: bold; margin-top: 16px; }
    .fail-badge { display: inline-block; padding: 8px 16px; background: #ef4444; color: white; border-radius: 8px; font-weight: bold; margin-top: 16px; }
    .review-section { margin-top: 24px; }
    .review-item { padding: 12px; margin-bottom: 8px; border-radius: 8px; }
    .review-item.correct { background: #f0fdf4; border: 1px solid #10b981; }
    .review-item.incorrect { background: #fef2f2; border: 1px solid #ef4444; }
    .review-q { font-weight: 500; margin-bottom: 4px; }
    .review-answer { font-size: 14px; }
    .nav-buttons { display: flex; gap: 8px; justify-content: center; margin-top: 16px; }
    .nav-btn { padding: 8px 16px; border: 1px solid #0369A1; border-radius: 8px; cursor: pointer; background: white; color: #0369A1; }
    .nav-btn:hover { background: #0369A1; color: white; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="quiz-container">
    <div class="quiz-header">
      <div class="quiz-title">${escapeHtml(bankName)}</div>
      ${bankDescription ? `<div class="quiz-desc">${escapeHtml(bankDescription)}</div>` : ''}
    </div>

    <div class="progress-bar">
      <div class="progress-fill" id="progressFill" style="width: 0%"></div>
    </div>

    <div id="quizContent"></div>

    <div class="nav-buttons">
      <button class="nav-btn" id="prevBtn" onclick="prevQuestion()" style="display:none">السابق</button>
      <button class="nav-btn" id="nextBtn" onclick="nextQuestion()">التالي</button>
    </div>

    <button class="submit-btn" id="submitBtn" onclick="submitQuiz()" disabled>تسليم الاختبار</button>

    <div id="resultsContainer" class="hidden">
      <div class="results-container">
        <div class="score-display" id="scoreDisplay"></div>
        <div class="score-label" id="scoreLabel"></div>
        <div id="passBadge"></div>
        <div class="review-section" id="reviewSection"></div>
      </div>
    </div>
  </div>

  <script src="scorm_api_wrapper.js"></script>
  <script>
    ${apiInitCode}

    // Initialize SCORM
    if (scormApi) {
      scormApi.LMSInitialize("");
      scormApi.LMSSetValue("${scormSetPrefix}.lesson_status", "incomplete");
      scormApi.LMSCommit("");
    }

    var questions = ${quizDataJson};
    var currentQ = 0;
    var answers = {};
    var totalQuestions = questions.length;
    var passingScore = 60;

    function renderQuestion(index) {
      var q = questions[index];
      var html = '<div class="question-card">';
      html += '<div class="question-number">السؤال ' + (index + 1) + ' من ' + totalQuestions + '</div>';
      html += '<div class="question-text">' + escapeHtmlContent(String(q.question)) + '</div>';

      if (q.type === 'mcq') {
        html += '<ul class="options-list">';
        var opts = q.options || [];
        for (var i = 0; i < opts.length; i++) {
          var selClass = (answers[q.id] === opts[i]) ? ' selected' : '';
          html += '<li class="option-item' + selClass + '" onclick="selectOption(\\'' + q.id + '\\', \\'' + escapeJs(String(opts[i])) + '\\')">' + escapeHtmlContent(String(opts[i])) + '</li>';
        }
        html += '</ul>';
      } else if (q.type === 'boolean') {
        var trueSel = (answers[q.id] === 'true') ? ' selected' : '';
        var falseSel = (answers[q.id] === 'false') ? ' selected' : '';
        html += '<div class="boolean-options">';
        html += '<button class="boolean-btn' + trueSel + '" onclick="selectOption(\\'' + q.id + '\\', \\'' + 'true' + '\\')">صحيح</button>';
        html += '<button class="boolean-btn' + falseSel + '" onclick="selectOption(\\'' + q.id + '\\', \\'' + 'false' + '\\')">خطأ</button>';
        html += '</div>';
      } else if (q.type === 'completion') {
        html += '<input type="text" class="completion-input" placeholder="اكتب الإجابة هنا..." value="' + (answers[q.id] || '') + '" onchange="selectOption(\\'' + q.id + '\\', this.value)" />';
      } else if (q.type === 'matching') {
        html += '<div class="matching-container">';
        var pairs = q.pairs || [];
        var shuffledValues = pairs.map(function(p) { return p.value; });
        // Shuffle values
        for (var i = shuffledValues.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var temp = shuffledValues[i];
          shuffledValues[i] = shuffledValues[j];
          shuffledValues[j] = temp;
        }
        for (var i = 0; i < pairs.length; i++) {
          var selVal = answers[q.id] ? answers[q.id][pairs[i].key] : '';
          html += '<div class="match-row">';
          html += '<div class="match-left">' + escapeHtmlContent(pairs[i].key) + '</div>';
          html += '<select class="match-select" onchange="selectMatch(\\'' + q.id + '\\', \\'' + escapeJs(pairs[i].key) + '\\', this.value)">';
          html += '<option value="">اختر...</option>';
          for (var j = 0; j < shuffledValues.length; j++) {
            var isSel = (selVal === shuffledValues[j]) ? ' selected' : '';
            html += '<option value="' + escapeHtmlContent(shuffledValues[j]) + '"' + isSel + '>' + escapeHtmlContent(shuffledValues[j]) + '</option>';
          }
          html += '</select>';
          html += '</div>';
        }
        html += '</div>';
      }

      html += '</div>';

      // Update progress bar
      var progress = ((index + 1) / totalQuestions) * 100;
      document.getElementById('progressFill').style.width = progress + '%';

      // Update navigation buttons
      document.getElementById('prevBtn').style.display = (index > 0) ? 'inline-block' : 'none';
      document.getElementById('nextBtn').style.display = (index < totalQuestions - 1) ? 'inline-block' : 'none';

      // Check if all questions answered
      var answeredCount = 0;
      for (var key in answers) { answeredCount++; }
      document.getElementById('submitBtn').disabled = (answeredCount < totalQuestions);

      document.getElementById('quizContent').innerHTML = html;
    }

    function selectOption(qId, value) {
      answers[qId] = value;
      renderQuestion(currentQ);
    }

    function selectMatch(qId, key, value) {
      if (!answers[qId]) answers[qId] = {};
      answers[qId][key] = value;
      renderQuestion(currentQ);
    }

    function nextQuestion() {
      if (currentQ < totalQuestions - 1) {
        currentQ++;
        renderQuestion(currentQ);
      }
    }

    function prevQuestion() {
      if (currentQ > 0) {
        currentQ--;
        renderQuestion(currentQ);
      }
    }

    function calculateScore() {
      var correct = 0;
      var total = totalQuestions;

      for (var i = 0; i < questions.length; i++) {
        var q = questions[i];
        var userAnswer = answers[q.id];

        if (q.type === 'mcq' || q.type === 'boolean' || q.type === 'completion') {
          var correctAnswer = String(q.correct_answer || '').trim().toLowerCase();
          var userStr = String(userAnswer || '').trim().toLowerCase();
          if (userStr === correctAnswer) correct++;
        } else if (q.type === 'matching') {
          var pairs = q.pairs || [];
          var allCorrect = true;
          for (var j = 0; j < pairs.length; j++) {
            var expected = String(pairs[j].value).trim().toLowerCase();
            var actual = userAnswer && userAnswer[pairs[j].key] ? String(userAnswer[pairs[j].key]).trim().toLowerCase() : '';
            if (actual !== expected) allCorrect = false;
          }
          if (allCorrect) correct++;
        }
      }

      return { correct: correct, total: total, percentage: Math.round((correct / total) * 100) };
    }

    function submitQuiz() {
      var result = calculateScore();
      var passed = result.percentage >= passingScore;

      // Hide quiz content, show results
      document.getElementById('quizContent').innerHTML = '';
      document.getElementById('prevBtn').style.display = 'none';
      document.getElementById('nextBtn').style.display = 'none';
      document.getElementById('submitBtn').style.display = 'none';
      document.getElementById('progressFill').style.width = '100%';

      // Show results
      document.getElementById('resultsContainer').classList.remove('hidden');
      document.getElementById('scoreDisplay').textContent = result.percentage + '%';
      document.getElementById('scoreLabel').textContent = result.correct + ' من ' + result.total + ' أسئلة صحيحة';
      document.getElementById('passBadge').innerHTML = passed
        ? '<div class="pass-badge">ناجح ✓</div>'
        : '<div class="fail-badge">راسب ✗</div>';

      // Review section
      var reviewHtml = '';
      for (var i = 0; i < questions.length; i++) {
        var q = questions[i];
        var userAnswer = answers[q.id];
        var isCorrect = false;

        if (q.type === 'mcq' || q.type === 'boolean' || q.type === 'completion') {
          var correctAnswer = String(q.correct_answer || '').trim().toLowerCase();
          var userStr = String(userAnswer || '').trim().toLowerCase();
          isCorrect = (userStr === correctAnswer);
        } else if (q.type === 'matching') {
          var pairs = q.pairs || [];
          var allCorrect = true;
          for (var j = 0; j < pairs.length; j++) {
            var expected = String(pairs[j].value).trim().toLowerCase();
            var actual = userAnswer && userAnswer[pairs[j].key] ? String(userAnswer[pairs[j].key]).trim().toLowerCase() : '';
            if (actual !== expected) allCorrect = false;
          }
          isCorrect = allCorrect;
        }

        var cls = isCorrect ? 'correct' : 'incorrect';
        reviewHtml += '<div class="review-item ' + cls + '">';
        reviewHtml += '<div class="review-q">' + escapeHtmlContent(String(q.question)) + '</div>';
        reviewHtml += '<div class="review-answer">إجابتك: ' + escapeHtmlContent(String(userAnswer || 'لم يتم الإجابة')) + '</div>';
        if (!isCorrect) {
          reviewHtml += '<div class="review-answer">الإجابة الصحيحة: ' + escapeHtmlContent(String(q.correct_answer || '')) + '</div>';
        }
        reviewHtml += '</div>';
      }
      document.getElementById('reviewSection').innerHTML = reviewHtml;

      // Report to SCORM
      if (scormApi) {
        if ('${version}' === '1.2') {
          scormApi.LMSSetValue("cmi.core.score.raw", String(result.percentage));
          scormApi.LMSSetValue("cmi.core.score.min", "0");
          scormApi.LMSSetValue("cmi.core.score.max", "100");
          scormApi.LMSSetValue("cmi.core.lesson_status", passed ? "passed" : "failed");
        } else {
          scormApi.LMSSetValue("cmi.score.raw", String(result.percentage));
          scormApi.LMSSetValue("cmi.score.min", "0");
          scormApi.LMSSetValue("cmi.score.max", "100");
          scormApi.LMSSetValue("cmi.score.scaled", String(result.percentage / 100));
          scormApi.LMSSetValue("cmi.completion_status", "completed");
          scormApi.LMSSetValue("cmi.success_status", passed ? "passed" : "failed");
        }
        scormApi.LMSCommit("");
        scormApi.LMSFinish("");
      }
    }

    function escapeHtmlContent(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escapeJs(str) {
      return str.replace(/\\\\/g, '\\\\\\\\\\').replace(/'/g, "\\\\\\\\'").replace(/"/g, '\\\\\\\\\\"');
    }

    // Start the quiz
    renderQuestion(0);
  </script>
</body>
</html>`;
}

// ─── HTML Generation Helpers ───

function generateLessonHtml(lesson: Record<string, unknown>, version: ScormVersion): string {
  const lessonTitle = (lesson.title as string) || 'Untitled Lesson';

  // Try to get content from multiple possible fields
  let contentHtml = '';
  if (lesson.content_html && typeof lesson.content_html === 'string') {
    contentHtml = lesson.content_html;
  } else if (lesson.published_json && typeof lesson.published_json === 'object') {
    try {
      const jsonContent = lesson.published_json as Record<string, unknown>;
      if (jsonContent.html) {
        contentHtml = jsonContent.html as string;
      } else if (jsonContent.blocks) {
        contentHtml = convertBlocksToHtml(jsonContent.blocks as Array<Record<string, unknown>>);
      } else {
        contentHtml = `<p>${JSON.stringify(jsonContent)}</p>`;
      }
    } catch {
      contentHtml = `<p>${String(lesson.published_json)}</p>`;
    }
  } else if (lesson.content_json && typeof lesson.content_json === 'object') {
    try {
      const jsonContent = lesson.content_json as Record<string, unknown>;
      if (jsonContent.html) {
        contentHtml = jsonContent.html as string;
      } else if (jsonContent.blocks) {
        contentHtml = convertBlocksToHtml(jsonContent.blocks as Array<Record<string, unknown>>);
      } else {
        contentHtml = `<p>${JSON.stringify(jsonContent)}</p>`;
      }
    } catch {
      contentHtml = `<p>${String(lesson.content_json)}</p>`;
    }
  }

  if (!contentHtml) {
    contentHtml = '<p>No content available for this lesson.</p>';
  }

  const apiInitCode = version === '1.2'
    ? `var scormApi = window.API || parent.API || opener.API || null;`
    : `var scormApi = window.API_1484_11 || parent.API_1484_11 || opener.API_1484_11 || null;`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(lessonTitle)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #f5f5f5; color: #333; padding: 20px; direction: rtl; }
    .lesson-container { max-width: 800px; margin: 0 auto; background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .lesson-header { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e0e0e0; }
    .lesson-title { font-size: 24px; font-weight: bold; color: #1a1a1a; }
    .lesson-content { line-height: 1.8; font-size: 16px; }
    .lesson-content img { max-width: 100%; height: auto; border-radius: 8px; margin: 16px 0; }
    .lesson-content h1, .lesson-content h2, .lesson-content h3 { margin-top: 24px; margin-bottom: 12px; color: #0369A1; }
    .lesson-content p { margin-bottom: 12px; }
    .lesson-content ul, .lesson-content ol { margin-bottom: 12px; padding-right: 24px; }
    .lesson-content table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .lesson-content th, .lesson-content td { border: 1px solid #ddd; padding: 8px 12px; text-align: right; }
    .lesson-content th { background: #0369A1; color: white; }
    .complete-btn { display: block; width: 100%; padding: 16px; background: #0369A1; color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; margin-top: 24px; transition: all 0.2s; }
    .complete-btn:hover { background: #0284c7; }
    .complete-btn.completed { background: #10b981; }
  </style>
</head>
<body>
  <div class="lesson-container">
    <div class="lesson-header">
      <div class="lesson-title">${escapeHtml(lessonTitle)}</div>
    </div>
    <div class="lesson-content">${contentHtml}</div>
    <button id="completeBtn" class="complete-btn" onclick="markComplete()">Mark as Complete</button>
  </div>

  <script src="scorm_api_wrapper.js"></script>
  <script>
    ${apiInitCode}

    // Initialize SCORM
    if (scormApi) {
      scormApi.LMSInitialize("");
      if ('${version}' === '1.2') {
        scormApi.LMSSetValue("cmi.core.lesson_status", "incomplete");
      } else {
        scormApi.LMSSetValue("cmi.completion_status", "incomplete");
      }
      scormApi.LMSCommit("");
    }

    function markComplete() {
      var btn = document.getElementById('completeBtn');
      btn.textContent = 'Completed ✓';
      btn.classList.add('completed');
      btn.disabled = true;

      if (scormApi) {
        if ('${version}' === '1.2') {
          scormApi.LMSSetValue("cmi.core.lesson_status", "completed");
          scormApi.LMSSetValue("cmi.core.score.raw", "100");
        } else {
          scormApi.LMSSetValue("cmi.completion_status", "completed");
          scormApi.LMSSetValue("cmi.success_status", "passed");
          scormApi.LMSSetValue("cmi.score.raw", "100");
          scormApi.LMSSetValue("cmi.score.scaled", "1");
        }
        scormApi.LMSCommit("");
        scormApi.LMSFinish("");
      }
    }
  </script>
</body>
</html>`;
}

// ─── Convert structured blocks to HTML ───

function convertBlocksToHtml(blocks: Array<Record<string, unknown>>): string {
  if (!Array.isArray(blocks)) return '<p>Content unavailable.</p>';

  return blocks.map(block => {
    const type = block.type as string;
    const data = (block.data as Record<string, unknown>) || {};

    switch (type) {
      case 'paragraph':
        return `<p>${data.text || ''}</p>`;
      case 'header':
        const level = (data.level as number) || 2;
        return `<h${level}>${data.text || ''}</h${level}>`;
      case 'list':
        const items = (data.items as string[]) || [];
        const style = (data.style as string) === 'ordered' ? 'ol' : 'ul';
        return `<${style}>${items.map(item => `<li>${item}</li>`).join('')}</${style}>`;
      case 'image':
        return `<img src="${data.url || ''}" alt="${data.caption || ''}" />${data.caption ? `<p><em>${data.caption}</em></p>` : ''}`;
      case 'quote':
        return `<blockquote><p>${data.text || ''}</p>${data.caption ? `<cite>${data.caption}</cite>` : ''}</blockquote>`;
      case 'table':
        const content = (data.content as string[][]) || [];
        if (content.length === 0) return '';
        const headerRow = content[0].map(cell => `<th>${cell}</th>`).join('');
        const bodyRows = content.slice(1).map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('');
        return `<table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table>`;
      case 'code':
        return `<pre><code>${data.code || ''}</code></pre>`;
      case 'raw':
        return data.html as string || '';
      default:
        return `<p>${String(data.text || '')}</p>`;
    }
  }).join('\n');
}

// ─── Manifest Generation ───

function generateManifest(
  title: string,
  items: Array<{ identifier: string; title: string; identifierref: string; hrefOverride?: string }>,
  version: ScormVersion,
  contentType: string,
  description?: string
): string {
  const manifestIdentifier = `manifest_${contentType}_${Date.now()}`;
  const orgIdentifier = `org_${contentType}`;

  // Determine href for each resource
  const getHref = (item: { identifierref: string; hrefOverride?: string }) => {
    if (item.hrefOverride) return item.hrefOverride;
    if (contentType === 'subject') {
      return `lessons/${item.identifierref.replace('res_lesson_', 'lesson_')}.html`;
    }
    return item.identifierref.replace('res_lesson_', 'lesson_') + '.html';
  };

  if (version === '1.2') {
    // SCORM 1.2 manifest
    const resourcesXml = items.map(item => {
      const href = getHref(item);
      return `    <resource identifier="${item.identifierref}" type="webcontent" href="${href}" adlcp:scormType="sco">
      <file href="${href}" />
      <file href="scorm_api_wrapper.js" />
    </resource>`;
    }).join('\n');

    const itemsXml = items.map(item =>
      `      <item identifier="${item.identifier}" identifierref="${item.identifierref}" isvisible="true">
        <title>${escapeXml(item.title)}</title>
      </item>`
    ).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${manifestIdentifier}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_v1p1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p2"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_v1p1 imscp_v1p1.xsd
    http://www.imsglobal.org/xsd/imsmd_v1p2 imsmd_v1p2p2.xsd
    http://www.adlnet.org/xsd/adlcp_v1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="${orgIdentifier}">
    <organization identifier="${orgIdentifier}">
      <title>${escapeXml(title)}</title>
${itemsXml}
    </organization>
  </organizations>
  <resources>
${resourcesXml}
  </resources>
</manifest>`;
  }

  // SCORM 2004 manifest
  const resourcesXml = items.map(item => {
    const href = getHref(item);
    return `    <resource identifier="${item.identifierref}" type="webcontent" href="${href}" adlcp:scormType="sco">
      <file href="${href}" />
      <file href="scorm_api_wrapper.js" />
    </resource>`;
  }).join('\n');

  const itemsXml = items.map(item =>
    `      <item identifier="${item.identifier}" identifierref="${item.identifierref}" isvisible="true">
        <title>${escapeXml(item.title)}</title>
      </item>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${manifestIdentifier}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
    http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd
    http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd
    http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="${orgIdentifier}">
    <organization identifier="${orgIdentifier}">
      <title>${escapeXml(title)}</title>
${itemsXml}
    </organization>
  </organizations>
  <resources>
${resourcesXml}
  </resources>
</manifest>`;
}

// ─── SCORM API Wrapper JS ───

function generateScormApiWrapper(version: ScormVersion): string {
  if (version === '1.2') {
    return `// SCORM 1.2 API Wrapper
var API = null;

function findAPI(win) {
  var attempts = 0;
  while (win && !win.API && attempts < 10) {
    if (win.parent && win.parent !== win) {
      win = win.parent;
    } else if (win.opener && win.opener !== win) {
      win = win.opener;
    } else {
      break;
    }
    attempts++;
  }
  return win ? win.API : null;
}

function getAPI() {
  if (window.API) return window.API;
  if (window.parent && window.parent.API) return window.parent.API;
  if (window.opener && window.opener.API) return window.opener.API;
  var theAPI = findAPI(window.parent);
  if (!theAPI && window.opener) {
    theAPI = findAPI(window.opener);
  }
  return theAPI;
}

API = getAPI();
`;
  }

  // SCORM 2004
  return `// SCORM 2004 API Wrapper
var API_1484_11 = null;

function findAPI(win) {
  var attempts = 0;
  while (win && !win.API_1484_11 && attempts < 10) {
    if (win.parent && win.parent !== win) {
      win = win.parent;
    } else if (win.opener && win.opener !== win) {
      win = win.opener;
    } else {
      break;
    }
    attempts++;
  }
  return win ? win.API_1484_11 : null;
}

function getAPI() {
  if (window.API_1484_11) return window.API_1484_11;
  if (window.parent && window.parent.API_1484_11) return window.parent.API_1484_11;
  if (window.opener && window.opener.API_1484_11) return window.opener.API_1484_11;
  var theAPI = findAPI(window.parent);
  if (!theAPI && window.opener) {
    theAPI = findAPI(window.opener);
  }
  return theAPI;
}

API_1484_11 = getAPI();
`;
}

// ─── XSD Files (minimal stubs required by SCORM spec) ───

function addXsdFiles(zip: JSZip, version: ScormVersion): void {
  zip.file('imscp_v1p1.xsd', IMSCP_V1P1_XSD);
  zip.file('imsmd_v1p2p2.xsd', IMSMD_V1P2P2_XSD);

  if (version === '1.2') {
    zip.file('adlcp_rootv1p2.xsd', ADLCP_ROOTV1P2_XSD);
  } else {
    zip.file('adlcp_v1p3.xsd', ADLCP_V1P3_XSD);
    zip.file('imsss_v1p0.xsd', IMSSS_V1P0_XSD);
    zip.file('adlseq_v1p3.xsd', ADLSEQ_V1P3_XSD);
  }
}

// ─── Utility functions ───

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Minimal XSD content stubs (required by SCORM validators) ───

const IMSCP_V1P1_XSD = '<?xml version="1.0" encoding="UTF-8"?><xsd:schema targetNamespace="http://www.imsproject.org/xsd/imscp_v1p1" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.imsproject.org/xsd/imscp_v1p1" elementFormDefault="qualified"><xsd:element name="manifest" type="xsd:anyType" /><xsd:element name="organization" type="xsd:anyType" /><xsd:element name="item" type="xsd:anyType" /><xsd:element name="resource" type="xsd:anyType" /><xsd:element name="file" type="xsd:anyType" /></xsd:schema>';

const IMSMD_V1P2P2_XSD = '<?xml version="1.0" encoding="UTF-8"?><xsd:schema targetNamespace="http://www.imsglobal.org/xsd/imsmd_v1p2" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.imsglobal.org/xsd/imsmd_v1p2" elementFormDefault="qualified"><xsd:element name="metadata" type="xsd:anyType" /><xsd:element name="schema" type="xsd:string" /><xsd:element name="schemaversion" type="xsd:string" /></xsd:schema>';

const ADLCP_ROOTV1P2_XSD = '<?xml version="1.0" encoding="UTF-8"?><xsd:schema targetNamespace="http://www.adlnet.org/xsd/adlcp_v1p2" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.adlnet.org/xsd/adlcp_v1p2" elementFormDefault="qualified"><xsd:element name="scormType" type="xsd:string" /></xsd:schema>';

const ADLCP_V1P3_XSD = '<?xml version="1.0" encoding="UTF-8"?><xsd:schema targetNamespace="http://www.adlnet.org/xsd/adlcp_v1p3" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.adlnet.org/xsd/adlcp_v1p3" elementFormDefault="qualified"><xsd:element name="scormType" type="xsd:string" /></xsd:schema>';

const IMSSS_V1P0_XSD = '<?xml version="1.0" encoding="UTF-8"?><xsd:schema targetNamespace="http://www.imsglobal.org/xsd/imsss" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.imsglobal.org/xsd/imsss" elementFormDefault="qualified"><xsd:element name="sequencing" type="xsd:anyType" /></xsd:schema>';

const ADLSEQ_V1P3_XSD = '<?xml version="1.0" encoding="UTF-8"?><xsd:schema targetNamespace="http://www.adlnet.org/xsd/adlseq_v1p3" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.adlnet.org/xsd/adlseq_v1p3" elementFormDefault="qualified"><xsd:element name="sequencing" type="xsd:anyType" /></xsd:schema>';
