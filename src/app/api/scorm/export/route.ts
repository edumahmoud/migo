import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import JSZip from 'jszip';
import type { ScormVersion } from '@/lib/scorm-types';

// ─── POST Handler: Export subject content (quiz/lessons) as a SCORM package ───

export async function POST(request: NextRequest) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { subjectId, contentType, contentIds, version, title, description } = body as {
      subjectId: string;
      contentType: 'quiz' | 'lesson' | 'subject';
      contentIds?: string[];
      version?: ScormVersion;
      title?: string;
      description?: string;
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
      case 'quiz':
        zip = await exportQuizAsScorm(subjectId, contentIds || [], scormVersion, packageTitle, authResult.user.id);
        break;
      case 'lesson':
        zip = await exportLessonAsScorm(subjectId, contentIds || [], scormVersion, packageTitle, authResult.user.id);
        break;
      case 'subject':
        zip = await exportSubjectAsScorm(subjectId, scormVersion, packageTitle, packageDescription, authResult.user.id);
        break;
      default:
        return NextResponse.json(
          { success: false, error: `Invalid contentType: ${contentType}` },
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
    return NextResponse.json(
      { success: false, error: 'Failed to export SCORM package' },
      { status: 500 }
    );
  }
}

// ─── Export Quiz as SCORM Package ───

async function exportQuizAsScorm(
  subjectId: string,
  quizIds: string[],
  version: ScormVersion,
  packageTitle: string,
  userId: string
): Promise<JSZip> {
  // Fetch quizzes
  let quizzesQuery = supabaseServer
    .from('quizzes')
    .select('id, title, questions, duration, subject_id')
    .eq('subject_id', subjectId);

  if (quizIds.length > 0) {
    quizzesQuery = quizzesQuery.in('id', quizIds);
  }

  const { data: quizzes, error } = await quizzesQuery;
  if (error || !quizzes || quizzes.length === 0) {
    throw new Error('No quizzes found for export');
  }

  const zip = new JSZip();
  const items: Array<{ identifier: string; title: string; identifierref: string }> = [];

  for (let i = 0; i < quizzes.length; i++) {
    const quiz = quizzes[i];
    const scoId = `quiz_${quiz.id}`;
    const resourceId = `res_quiz_${quiz.id}`;
    const htmlFileName = `quiz_${i + 1}.html`;

    // Generate quiz HTML content
    const quizHtml = generateQuizHtml(quiz, version);

    zip.file(htmlFileName, quizHtml);

    items.push({
      identifier: scoId,
      title: quiz.title || `Quiz ${i + 1}`,
      identifierref: resourceId,
    });

    // Add resource entry for manifest
    if (version === '1.2') {
      zip.file(
        `adlcp_rootv1p2.xsd`,
        ADLCP_ROOTV1P2_XSD
      );
    }
  }

  // Generate manifest
  const manifest = generateManifest(packageTitle, items, version, 'quiz');
  zip.file('imsmanifest.xml', manifest);

  // Add SCORM API wrapper script
  zip.file('scorm_api_wrapper.js', generateScormApiWrapper(version));

  // Add required XSD files
  addXsdFiles(zip, version);

  return zip;
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
    .select('id, title, content_html, published_json, status, subject_id')
    .eq('subject_id', subjectId);

  if (lessonIds.length > 0) {
    lessonsQuery = lessonsQuery.in('id', lessonIds);
  }

  // Only export published lessons
  lessonsQuery = lessonsQuery.eq('status', 'published');

  const { data: lessons, error } = await lessonsQuery;
  if (error || !lessons || lessons.length === 0) {
    throw new Error('No published lessons found for export');
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

// ─── Export Entire Subject as SCORM Package ───

async function exportSubjectAsScorm(
  subjectId: string,
  version: ScormVersion,
  packageTitle: string,
  packageDescription: string,
  userId: string
): Promise<JSZip> {
  // Fetch all published lessons and quizzes
  const { data: lessons } = await supabaseServer
    .from('lessons')
    .select('id, title, content_html, published_json, status, subject_id')
    .eq('subject_id', subjectId)
    .eq('status', 'published');

  const { data: quizzes } = await supabaseServer
    .from('quizzes')
    .select('id, title, questions, duration, subject_id')
    .eq('subject_id', subjectId);

  const zip = new JSZip();
  const items: Array<{ identifier: string; title: string; identifierref: string }> = [];

  // Create folder structure
  const lessonsFolder = zip.folder('lessons');
  const quizzesFolder = zip.folder('quizzes');

  // Add lessons
  if (lessons && lessons.length > 0) {
    for (let i = 0; i < lessons.length; i++) {
      const lesson = lessons[i];
      const scoId = `lesson_${lesson.id}`;
      const resourceId = `res_lesson_${lesson.id}`;
      const htmlFileName = `lessons/lesson_${i + 1}.html`;

      const lessonHtml = generateLessonHtml(lesson, version);
      lessonsFolder!.file(`lesson_${i + 1}.html`, lessonHtml);

      items.push({
        identifier: scoId,
        title: lesson.title || `Lesson ${i + 1}`,
        identifierref: resourceId,
      });
    }
  }

  // Add quizzes
  if (quizzes && quizzes.length > 0) {
    for (let i = 0; i < quizzes.length; i++) {
      const quiz = quizzes[i];
      const scoId = `quiz_${quiz.id}`;
      const resourceId = `res_quiz_${quiz.id}`;
      const htmlFileName = `quizzes/quiz_${i + 1}.html`;

      const quizHtml = generateQuizHtml(quiz, version);
      quizzesFolder!.file(`quiz_${i + 1}.html`, quizHtml);

      items.push({
        identifier: scoId,
        title: quiz.title || `Quiz ${i + 1}`,
        identifierref: resourceId,
      });
    }
  }

  if (items.length === 0) {
    throw new Error('No content found in this subject to export');
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

// ─── HTML Generation Helpers ───

function generateQuizHtml(quiz: Record<string, unknown>, version: ScormVersion): string {
  const questions = (quiz.questions as Array<Record<string, unknown>>) || [];
  const quizTitle = (quiz.title as string) || 'Untitled Quiz';
  const duration = (quiz.duration as number) || 0;

  // Generate question HTML
  const questionsHtml = questions.map((q, index) => {
    const type = q.type as string;
    const questionText = escapeHtml(q.question as string || '');

    switch (type) {
      case 'mcq':
        const options = (q.options as string[]) || [];
        const optionsHtml = options.map((opt, optIdx) =>
          `<div class="option" data-index="${optIdx}" onclick="selectOption(${index}, ${optIdx})">
            <span class="option-marker">${String.fromCharCode(65 + optIdx)}</span>
            <span class="option-text">${escapeHtml(opt)}</span>
          </div>`
        ).join('\n');
        return `<div class="question mcq" id="q${index}">
          <div class="question-number">${index + 1}</div>
          <div class="question-text">${questionText}</div>
          <div class="options">${optionsHtml}</div>
          <input type="hidden" id="answer_${index}" value="">
        </div>`;

      case 'boolean':
        return `<div class="question boolean" id="q${index}">
          <div class="question-number">${index + 1}</div>
          <div class="question-text">${questionText}</div>
          <div class="boolean-options">
            <button class="bool-btn" onclick="selectBoolean(${index}, 'true')">${/* TRUE label */''}<span>✓ True</span></button>
            <button class="bool-btn" onclick="selectBoolean(${index}, 'false')"><span>✗ False</span></button>
          </div>
          <input type="hidden" id="answer_${index}" value="">
        </div>`;

      case 'completion':
        return `<div class="question completion" id="q${index}">
          <div class="question-number">${index + 1}</div>
          <div class="question-text">${questionText}</div>
          <input type="text" id="answer_${index}" class="completion-input" placeholder="Type your answer...">
        </div>`;

      case 'matching':
        const pairs = (q.pairs as Array<{ key: string; value: string }>) || [];
        const leftItems = pairs.map((p, pIdx) =>
          `<div class="match-item left" data-pair="${pIdx}" id="match_left_${index}_${pIdx}">${escapeHtml(p.key)}</div>`
        ).join('\n');
        const rightItems = pairs.map((p, pIdx) =>
          `<div class="match-item right" data-pair="${pIdx}" data-value="${escapeHtml(p.value)}" id="match_right_${index}_${pIdx}" onclick="selectMatch(${index}, ${pIdx})">${escapeHtml(p.value)}</div>`
        ).join('\n');
        return `<div class="question matching" id="q${index}">
          <div class="question-number">${index + 1}</div>
          <div class="question-text">${questionText}</div>
          <div class="matching-container">
            <div class="match-left-column">${leftItems}</div>
            <div class="match-right-column">${rightItems}</div>
          </div>
          <input type="hidden" id="answer_${index}" value="">
        </div>`;

      default:
        return `<div class="question" id="q${index}">
          <div class="question-number">${index + 1}</div>
          <div class="question-text">${questionText}</div>
        </div>`;
    }
  }).join('\n');

  const apiInitCode = version === '1.2'
    ? `var scormApi = window.API || parent.API || opener.API || null;`
    : `var scormApi = window.API_1484_11 || parent.API_1484_11 || opener.API_1484_11 || null;`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(quizTitle)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #f5f5f5; color: #333; padding: 20px; direction: rtl; }
    .quiz-container { max-width: 800px; margin: 0 auto; background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .quiz-header { text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e0e0e0; }
    .quiz-title { font-size: 24px; font-weight: bold; color: #1a1a1a; }
    .quiz-info { font-size: 14px; color: #666; margin-top: 8px; }
    .question { margin-bottom: 24px; padding: 16px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa; }
    .question-number { font-size: 14px; color: #0369A1; font-weight: bold; margin-bottom: 8px; }
    .question-text { font-size: 18px; font-weight: 500; margin-bottom: 12px; line-height: 1.6; }
    .options { display: flex; flex-direction: column; gap: 8px; }
    .option { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border: 2px solid #e0e0e0; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
    .option:hover { border-color: #0369A1; background: #e8f4fd; }
    .option.selected { border-color: #0369A1; background: #0369A1; color: white; }
    .option.selected .option-marker { background: white; color: #0369A1; }
    .option-marker { width: 28px; height: 28px; border-radius: 50%; background: #0369A1; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; }
    .boolean-options { display: flex; gap: 16px; }
    .bool-btn { padding: 12px 24px; border: 2px solid #e0e0e0; border-radius: 8px; cursor: pointer; font-size: 16px; transition: all 0.2s; background: white; }
    .bool-btn:hover { border-color: #0369A1; }
    .bool-btn.selected { border-color: #0369A1; background: #0369A1; color: white; }
    .completion-input { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; direction: rtl; }
    .completion-input:focus { border-color: #0369A1; outline: none; }
    .matching-container { display: flex; gap: 24px; }
    .match-left-column, .match-right-column { display: flex; flex-direction: column; gap: 8px; flex: 1; }
    .match-item { padding: 12px 16px; border: 2px solid #e0e0e0; border-radius: 8px; cursor: pointer; transition: all 0.2s; text-align: center; }
    .match-item:hover { border-color: #0369A1; }
    .match-item.selected { border-color: #0369A1; background: #0369A1; color: white; }
    .submit-btn { display: block; width: 100%; padding: 16px; background: #0369A1; color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; margin-top: 24px; transition: all 0.2s; }
    .submit-btn:hover { background: #0284c7; }
    .submit-btn:disabled { background: #ccc; cursor: not-allowed; }
    .results { margin-top: 24px; padding: 16px; border-radius: 8px; text-align: center; }
    .results.passed { background: #d4edda; color: #155724; }
    .results.failed { background: #f8d7da; color: #721c24; }
    .score-display { font-size: 36px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="quiz-container">
    <div class="quiz-header">
      <div class="quiz-title">${escapeHtml(quizTitle)}</div>
      ${duration > 0 ? `<div class="quiz-info">Duration: ${duration} minutes</div>` : ''}
      <div class="quiz-info">Questions: ${questions.length}</div>
    </div>
    ${questionsHtml}
    <button class="submit-btn" onclick="submitQuiz()">Submit Quiz</button>
    <div id="results" class="results" style="display:none;"></div>
  </div>

  <script src="scorm_api_wrapper.js"></script>
  <script>
    ${apiInitCode}

    // Initialize SCORM
    if (scormApi) {
      scormApi.LMSInitialize("");
    }

    var answers = {};
    var correctAnswers = {};
    var totalQuestions = ${questions.length};

    // Build correct answers map
    ${questions.map((q, i) => {
      const type = q.type as string;
      if (type === 'mcq') {
        return `correctAnswers[${i}] = "${escapeHtml((q.correctAnswer as string) || '')}";`;
      } else if (type === 'boolean') {
        return `correctAnswers[${i}] = "${(q.correctAnswer as string) || ''}";`;
      } else if (type === 'completion') {
        return `correctAnswers[${i}] = "${escapeHtml((q.correctAnswer as string) || '')}";`;
      } else if (type === 'matching') {
        const pairs = (q.pairs as Array<{ key: string; value: string }>) || [];
        return `correctAnswers[${i}] = ${JSON.stringify(pairs.map(p => p.value))};`;
      }
      return `correctAnswers[${i}] = "";`;
    }).join('\n')}

    function selectOption(qIndex, optIndex) {
      var options = document.querySelectorAll('#q' + qIndex + ' .option');
      options.forEach(function(opt) { opt.classList.remove('selected'); });
      options[optIndex].classList.add('selected');
      answers[qIndex] = optIndex;
      document.getElementById('answer_' + qIndex).value = optIndex;
      reportProgress();
    }

    function selectBoolean(qIndex, value) {
      var btns = document.querySelectorAll('#q' + qIndex + ' .bool-btn');
      btns.forEach(function(btn) { btn.classList.remove('selected'); });
      if (value === 'true') btns[0].classList.add('selected');
      else btns[1].classList.add('selected');
      answers[qIndex] = value;
      document.getElementById('answer_' + qIndex).value = value;
      reportProgress();
    }

    function selectMatch(qIndex, pairIdx) {
      var rightItems = document.querySelectorAll('#q' + qIndex + ' .match-item.right');
      rightItems.forEach(function(item) { item.classList.remove('selected'); });
      rightItems[pairIdx].classList.add('selected');
      answers[qIndex] = pairIdx;
      document.getElementById('answer_' + qIndex).value = pairIdx;
      reportProgress();
    }

    function reportProgress() {
      if (scormApi) {
        var answered = Object.keys(answers).length;
        var status = answered === 0 ? 'not_attempted' : answered < totalQuestions ? 'incomplete' : 'completed';
        if (version === '1.2' || '${version}' === '1.2') {
          scormApi.LMSSetValue("cmi.core.lesson_status", status);
        } else {
          scormApi.LMSSetValue("cmi.completion_status", status);
        }
        scormApi.LMSCommit("");
      }
    }

    function submitQuiz() {
      var correct = 0;
      for (var i = 0; i < totalQuestions; i++) {
        var userAnswer = answers[i];
        var correctAnswer = correctAnswers[i];
        // Simple comparison for scoring
        if (userAnswer !== undefined && userAnswer !== null && userAnswer.toString() === correctAnswer.toString()) {
          correct++;
        }
      }
      var score = Math.round((correct / totalQuestions) * 100);
      var passed = score >= 50;

      // Display results
      var resultsDiv = document.getElementById('results');
      resultsDiv.style.display = 'block';
      resultsDiv.className = 'results ' + (passed ? 'passed' : 'failed');
      resultsDiv.innerHTML = '<div class="score-display">' + score + '%</div>' +
        '<div>' + correct + ' / ' + totalQuestions + ' correct</div>' +
        '<div>' + (passed ? 'Passed ✓' : 'Failed ✗') + '</div>';

      // Disable submit button
      document.querySelector('.submit-btn').disabled = true;
      document.querySelector('.submit-btn').textContent = 'Quiz Completed';

      // Report to SCORM
      if (scormApi) {
        if ('${version}' === '1.2') {
          scormApi.LMSSetValue("cmi.core.score.raw", score.toString());
          scormApi.LMSSetValue("cmi.core.score.min", "0");
          scormApi.LMSSetValue("cmi.core.score.max", "100");
          scormApi.LMSSetValue("cmi.core.lesson_status", passed ? "passed" : "failed");
        } else {
          scormApi.LMSSetValue("cmi.score.raw", score.toString());
          scormApi.LMSSetValue("cmi.score.min", "0");
          scormApi.LMSSetValue("cmi.score.max", "100");
          scormApi.LMSSetValue("cmi.score.scaled", (score / 100).toString());
          scormApi.LMSSetValue("cmi.completion_status", "completed");
          scormApi.LMSSetValue("cmi.success_status", passed ? "passed" : "failed");
        }
        scormApi.LMSCommit("");
        scormApi.LMSFinish("");
      }
    }
  </script>
</body>
</html>`;
}

function generateLessonHtml(lesson: Record<string, unknown>, version: ScormVersion): string {
  const lessonTitle = (lesson.title as string) || 'Untitled Lesson';
  const contentHtml = (lesson.content_html as string) || (lesson.published_json as string) || '<p>No content available.</p>';

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
      // Set initial status
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

// ─── Manifest Generation ───

function generateManifest(
  title: string,
  items: Array<{ identifier: string; title: string; identifierref: string }>,
  version: ScormVersion,
  contentType: string,
  description?: string
): string {
  const manifestIdentifier = `manifest_${contentType}_${Date.now()}`;
  const orgIdentifier = `org_${contentType}`;

  if (version === '1.2') {
    // SCORM 1.2 manifest
    const resourcesXml = items.map(item => {
      // Determine href based on content type
      const href = item.identifierref.startsWith('res_quiz_')
        ? item.identifierref.replace('res_quiz_', 'quiz_') + '.html'
        : item.identifierref.startsWith('res_lesson_')
          ? item.identifierref.replace('res_lesson_', 'lesson_') + '.html'
          : 'index.html';

      // For subject export, resources may be in subfolders
      const actualHref = contentType === 'subject'
        ? (item.identifierref.startsWith('res_quiz_')
          ? `quizzes/${item.identifierref.replace('res_quiz_', 'quiz_')}.html`
          : `lessons/${item.identifierref.replace('res_lesson_', 'lesson_')}.html`)
        : href;

      return `    <resource identifier="${item.identifierref}" type="webcontent" href="${actualHref}" adlcp:scormType="sco">
      <file href="${actualHref}" />
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
    const href = contentType === 'subject'
      ? (item.identifierref.startsWith('res_quiz_')
        ? `quizzes/${item.identifierref.replace('res_quiz_', 'quiz_')}.html`
        : `lessons/${item.identifierref.replace('res_lesson_', 'lesson_')}.html`)
      : (item.identifierref.startsWith('res_quiz_')
        ? item.identifierref.replace('res_quiz_', 'quiz_') + '.html'
        : item.identifierref.startsWith('res_lesson_')
          ? item.identifierref.replace('res_lesson_', 'lesson_') + '.html'
          : 'index.html');

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
// This script provides a communication layer between SCO content and the LMS.
// It finds the SCORM API object provided by the LMS and wraps it for easier use.

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
  
  // Search parent frames
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
// This script provides a communication layer between SCO content and the LMS.
// It finds the SCORM 2004 API object (API_1484_11) provided by the LMS.

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
  
  // Search parent frames
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
  // SCORM 1.2 required XSD files
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

const IMSCP_V1P1_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema targetNamespace="http://www.imsproject.org/xsd/imscp_v1p1"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns="http://www.imsproject.org/xsd/imscp_v1p1"
  elementFormDefault="qualified">
  <xsd:element name="manifest" type="xsd:anyType" />
  <xsd:element name="organization" type="xsd:anyType" />
  <xsd:element name="item" type="xsd:anyType" />
  <xsd:element name="resource" type="xsd:anyType" />
  <xsd:element name="file" type="xsd:anyType" />
</xsd:schema>`;

const IMSMD_V1P2P2_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema targetNamespace="http://www.imsglobal.org/xsd/imsmd_v1p2"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns="http://www.imsglobal.org/xsd/imsmd_v1p2"
  elementFormDefault="qualified">
  <xsd:element name="metadata" type="xsd:anyType" />
  <xsd:element name="schema" type="xsd:string" />
  <xsd:element name="schemaversion" type="xsd:string" />
</xsd:schema>`;

const ADLCP_ROOTV1P2_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema targetNamespace="http://www.adlnet.org/xsd/adlcp_v1p2"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns="http://www.adlnet.org/xsd/adlcp_v1p2"
  elementFormDefault="qualified">
  <xsd:element name="scormType" type="xsd:string" />
</xsd:schema>`;

const ADLCP_V1P3_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema targetNamespace="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns="http://www.adlnet.org/xsd/adlcp_v1p3"
  elementFormDefault="qualified">
  <xsd:element name="scormType" type="xsd:string" />
</xsd:schema>`;

const IMSSS_V1P0_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema targetNamespace="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns="http://www.imsglobal.org/xsd/imsss"
  elementFormDefault="qualified">
  <xsd:element name="sequencing" type="xsd:anyType" />
</xsd:schema>`;

const ADLSEQ_V1P3_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema targetNamespace="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns="http://www.adlnet.org/xsd/adlseq_v1p3"
  elementFormDefault="qualified">
  <xsd:element name="sequencing" type="xsd:anyType" />
</xsd:schema>`;
