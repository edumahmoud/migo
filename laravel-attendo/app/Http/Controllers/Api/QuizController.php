<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Quiz;
use App\Models\Score;
use App\Models\Subject;
use App\Services\GeminiService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class QuizController extends Controller
{
    protected GeminiService $geminiService;

    public function __construct(GeminiService $geminiService)
    {
        $this->geminiService = $geminiService;
    }

    /**
     * List quizzes
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = Quiz::query();

        // Filter by subject
        if ($request->has('subject_id')) {
            $query->where('subject_id', $request->subject_id);
        }

        // Filter by user role
        if ($user->role === 'teacher') {
            // Get teacher's own quizzes and from their subjects
            $query->where(function ($q) use ($user) {
                $q->where('user_id', $user->id)
                  ->orWhereHas('subject', fn($sq) => $sq->where('teacher_id', $user->id));
            });
        } else {
            // Students see quizzes from their enrolled subjects and linked teachers
            $query->whereHas('subject.students', fn($q) => $q->where('student_id', $user->id))
                  ->orWhereHas('user.teachers', fn($q) => $q->where('users.id', $user->id));
        }

        $quizzes = $query->with(['subject:id,name,color', 'user:id,name,avatar_url'])
            ->orderBy('created_at', 'desc')
            ->limit(50)
            ->get();

        return response()->json([
            'success' => true,
            'quizzes' => $quizzes->map(fn($q) => $this->formatQuiz($q, $user)),
        ]);
    }

    /**
     * Create a new quiz
     */
    public function store(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'title' => ['required', 'string', 'max:255'],
            'subject_id' => ['nullable', 'string', 'exists:subjects,id'],
            'duration' => ['nullable', 'integer', 'min:1'],
            'scheduled_date' => ['nullable', 'string'],
            'scheduled_time' => ['nullable', 'string'],
            'questions' => ['required', 'array', 'min:1'],
            'show_results' => ['nullable', 'boolean'],
            'show_review' => ['nullable', 'boolean'],
            'allow_retake' => ['nullable', 'boolean'],
            'shuffle_questions' => ['nullable', 'boolean'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $user = $request->user();

        // Validate subject access if subject_id provided
        if ($request->subject_id) {
            $subject = Subject::find($request->subject_id);
            if ($subject && !$subject->isTeacher($user)) {
                return response()->json([
                    'success' => false,
                    'error' => 'غير مصرح بإنشاء اختبارات لهذه المادة',
                ], 403);
            }
        }

        // Validate questions structure
        $questions = $request->questions;
        foreach ($questions as $index => $question) {
            if (!isset($question['type']) || !in_array($question['type'], ['mcq', 'boolean', 'completion', 'matching'])) {
                return response()->json([
                    'success' => false,
                    'error' => "نوع السؤال {$index} غير صالح",
                ], 422);
            }

            if (!isset($question['question']) || empty($question['question'])) {
                return response()->json([
                    'success' => false,
                    'error' => "نص السؤال {$index} فارغ",
                ], 422);
            }
        }

        $quiz = Quiz::create([
            'id' => Str::uuid(),
            'user_id' => $user->id,
            'title' => $request->title,
            'subject_id' => $request->subject_id,
            'duration' => $request->duration,
            'scheduled_date' => $request->scheduled_date,
            'scheduled_time' => $request->scheduled_time,
            'questions' => $questions,
            'show_results' => $request->show_results ?? true,
            'show_review' => $request->show_review ?? false,
            'allow_retake' => $request->allow_retake ?? false,
            'shuffle_questions' => $request->shuffle_questions ?? false,
        ]);

        return response()->json([
            'success' => true,
            'quiz' => $this->formatQuiz($quiz->fresh()->load(['subject', 'user']), $user),
        ], 201);
    }

    /**
     * Get quiz details
     */
    public function show(string $id): JsonResponse
    {
        $quiz = Quiz::with(['subject', 'user:id,name,avatar_url', 'scores.student:id,name,avatar_url'])
            ->find($id);

        if (!$quiz) {
            return response()->json([
                'success' => false,
                'error' => 'الاختبار غير موجود',
            ], 404);
        }

        $user = request()->user();

        // Check access
        $hasAccess = $quiz->user_id === $user->id ||
                     ($quiz->subject && $quiz->subject->isTeacher($user)) ||
                     ($quiz->subject && $quiz->subject->hasStudent($user));

        if (!$hasAccess) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        return response()->json([
            'success' => true,
            'quiz' => $this->formatQuiz($quiz, $user),
        ]);
    }

    /**
     * Update quiz
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'title' => ['sometimes', 'string', 'max:255'],
            'duration' => ['nullable', 'integer', 'min:1'],
            'scheduled_date' => ['nullable', 'string'],
            'scheduled_time' => ['nullable', 'string'],
            'questions' => ['sometimes', 'array', 'min:1'],
            'show_results' => ['nullable', 'boolean'],
            'show_review' => ['nullable', 'boolean'],
            'allow_retake' => ['nullable', 'boolean'],
            'shuffle_questions' => ['nullable', 'boolean'],
            'is_finished' => ['nullable', 'boolean'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $quiz = Quiz::find($id);

        if (!$quiz) {
            return response()->json([
                'success' => false,
                'error' => 'الاختبار غير موجود',
            ], 404);
        }

        $user = request()->user();

        if ($quiz->user_id !== $user->id && !$user->isSuperAdmin()) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $quiz->update($request->only([
            'title', 'duration', 'scheduled_date', 'scheduled_time',
            'questions', 'show_results', 'show_review', 'allow_retake',
            'shuffle_questions', 'is_finished'
        ]));

        return response()->json([
            'success' => true,
            'quiz' => $this->formatQuiz($quiz->fresh()->load(['subject', 'user']), $user),
        ]);
    }

    /**
     * Delete quiz
     */
    public function destroy(string $id): JsonResponse
    {
        $quiz = Quiz::find($id);

        if (!$quiz) {
            return response()->json([
                'success' => false,
                'error' => 'الاختبار غير موجود',
            ], 404);
        }

        $user = request()->user();

        if ($quiz->user_id !== $user->id && !$user->isSuperAdmin()) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $quiz->delete();

        return response()->json([
            'success' => true,
            'message' => 'تم حذف الاختبار بنجاح',
        ]);
    }

    /**
     * Submit quiz answers
     */
    public function submit(Request $request, string $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'answers' => ['required', 'array'],
            'time_taken' => ['nullable', 'integer'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $quiz = Quiz::find($id);

        if (!$quiz) {
            return response()->json([
                'success' => false,
                'error' => 'الاختبار غير موجود',
            ], 404);
        }

        $user = $request->user();

        // Check access (student must be enrolled in subject or linked to teacher)
        $hasAccess = $quiz->subject && (
            $quiz->subject->hasStudent($user) ||
            $quiz->user->teachers()->where('users.id', $user->id)->exists()
        );

        if (!$hasAccess) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        // Check if already submitted (unless retake allowed)
        $existingScore = Score::where('quiz_id', $id)
            ->where('student_id', $user->id)
            ->first();

        if ($existingScore && !$quiz->allow_retake) {
            return response()->json([
                'success' => false,
                'error' => 'تم حل هذا الاختبار بالفعل',
            ], 400);
        }

        // Grade the quiz
        $questions = $quiz->questions;
        $answers = $request->answers;
        $score = 0;
        $total = count($questions);
        $userAnswers = [];

        foreach ($questions as $index => $question) {
            $userAnswer = $answers[$index] ?? null;
            $isCorrect = false;

            if ($userAnswer !== null) {
                switch ($question['type']) {
                    case 'mcq':
                        $isCorrect = ($userAnswer === $question['correctAnswer']);
                        break;
                    case 'boolean':
                        $isCorrect = (strtolower($userAnswer) === strtolower($question['correctAnswer']));
                        break;
                    case 'completion':
                        // Use AI to evaluate completion answers
                        try {
                            $isCorrect = $this->geminiService->evaluateAnswer(
                                $question['question'],
                                $question['correctAnswer'],
                                $userAnswer
                            );
                        } catch (\Exception $e) {
                            // Fallback: simple string comparison
                            $isCorrect = levenshtein(
                                strtolower(trim($userAnswer)),
                                strtolower(trim($question['correctAnswer']))
                            ) < 3;
                        }
                        break;
                    case 'matching':
                        $isCorrect = $userAnswer === $question['correctAnswer'];
                        break;
                }

                if ($isCorrect) {
                    $score++;
                }
            }

            $userAnswers[] = [
                'questionIndex' => $index,
                'type' => $question['type'],
                'answer' => $userAnswer,
                'isCorrect' => $isCorrect,
            ];
        }

        // Delete existing score if retake
        if ($existingScore) {
            $existingScore->delete();
        }

        // Create new score
        $scoreRecord = Score::create([
            'id' => Str::uuid(),
            'student_id' => $user->id,
            'teacher_id' => $quiz->user_id,
            'quiz_id' => $id,
            'quiz_title' => $quiz->title,
            'score' => $score,
            'total' => $total,
            'user_answers' => $userAnswers,
            'completed_at' => now(),
        ]);

        return response()->json([
            'success' => true,
            'score' => [
                'id' => $scoreRecord->id,
                'score' => $score,
                'total' => $total,
                'percentage' => $total > 0 ? round(($score / $total) * 100, 2) : 0,
                'completed_at' => $scoreRecord->completed_at->toIso8601String(),
            ],
            'show_results' => $quiz->show_results,
            'show_review' => $quiz->show_review,
            'questions' => $quiz->show_review ? $questions : null,
            'user_answers' => $quiz->show_review ? $userAnswers : null,
        ]);
    }

    /**
     * Get quiz scores
     */
    public function scores(string $id): JsonResponse
    {
        $quiz = Quiz::find($id);

        if (!$quiz) {
            return response()->json([
                'success' => false,
                'error' => 'الاختبار غير موجود',
            ], 404);
        }

        $user = request()->user();

        // Teachers see all scores
        if ($quiz->user_id === $user->id || ($quiz->subject && $quiz->subject->isTeacher($user))) {
            $scores = Score::where('quiz_id', $id)
                ->with('student:id,name,email,avatar_url')
                ->orderBy('completed_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'scores' => $scores->map(fn($s) => [
                    'id' => $s->id,
                    'student' => [
                        'id' => $s->student->id,
                        'name' => $s->student->name,
                        'email' => $s->student->email,
                        'avatar_url' => $s->student->avatar_url,
                    ],
                    'score' => $s->score,
                    'total' => $s->total,
                    'percentage' => $s->percentage(),
                    'completed_at' => $s->completed_at->toIso8601String(),
                ]),
            ]);
        }

        // Students see their own scores
        $scores = Score::where('quiz_id', $id)
            ->where('student_id', $user->id)
            ->orderBy('completed_at', 'desc')
            ->get();

        return response()->json([
            'success' => true,
            'scores' => $scores->map(fn($s) => [
                'id' => $s->id,
                'score' => $s->score,
                'total' => $s->total,
                'percentage' => $s->percentage(),
                'completed_at' => $s->completed_at->toIso8601String(),
            ]),
        ]);
    }

    /**
     * AI: Generate quiz from topic
     */
    public function generateQuiz(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'topic' => ['required', 'string'],
            'question_count' => ['nullable', 'integer', 'min:1', 'max:50'],
            'difficulty' => ['nullable', 'string', 'in:easy,medium,hard'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        try {
            $questions = $this->geminiService->generateQuiz(
                $request->topic,
                $request->question_count ?? 5,
                $request->difficulty
            );

            return response()->json([
                'success' => true,
                'questions' => $questions,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Format quiz for response
     */
    private function formatQuiz(Quiz $quiz, ?User $user = null): array
    {
        $data = [
            'id' => $quiz->id,
            'title' => $quiz->title,
            'duration' => $quiz->duration,
            'scheduled_date' => $quiz->scheduled_date,
            'scheduled_time' => $quiz->scheduled_time,
            'questions_count' => $quiz->totalQuestions(),
            'show_results' => $quiz->show_results,
            'show_review' => $quiz->show_review,
            'allow_retake' => $quiz->allow_retake,
            'shuffle_questions' => $quiz->shuffle_questions,
            'is_finished' => $quiz->is_finished,
            'created_at' => $quiz->created_at->toIso8601String(),
        ];

        if ($quiz->relationLoaded('subject') && $quiz->subject) {
            $data['subject'] = [
                'id' => $quiz->subject->id,
                'name' => $quiz->subject->name,
                'color' => $quiz->subject->color,
            ];
        }

        if ($quiz->relationLoaded('user') && $quiz->user) {
            $data['creator'] = [
                'id' => $quiz->user->id,
                'name' => $quiz->user->name,
                'avatar_url' => $quiz->user->avatar_url,
            ];
        }

        if ($user && $quiz->relationLoaded('scores')) {
            $userScore = $quiz->scores->first(fn($s) => $s->student_id === $user->id);
            if ($userScore) {
                $data['my_score'] = [
                    'score' => $userScore->score,
                    'total' => $userScore->total,
                    'percentage' => $userScore->percentage(),
                    'completed_at' => $userScore->completed_at->toIso8601String(),
                ];
            }
        }

        return $data;
    }
}