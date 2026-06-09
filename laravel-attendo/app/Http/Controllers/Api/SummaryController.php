<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Summary;
use App\Services\GeminiService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class SummaryController extends Controller
{
    protected GeminiService $geminiService;

    public function __construct(GeminiService $geminiService)
    {
        $this->geminiService = $geminiService;
    }

    /**
     * List user's summaries
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $summaries = Summary::where('user_id', $user->id)
            ->when($request->subject_id, fn($q) => $q->where('subject_id', $request->subject_id))
            ->with('subject:id,name,color')
            ->orderBy('created_at', 'desc')
            ->limit(50)
            ->get();

        return response()->json([
            'success' => true,
            'summaries' => $summaries->map(fn($s) => $this->formatSummary($s)),
        ]);
    }

    /**
     * Create a new summary
     */
    public function store(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'title' => ['required', 'string', 'max:255'],
            'content' => ['required', 'string'],
            'subject_id' => ['nullable', 'string', 'exists:subjects,id'],
            'source_file_type' => ['nullable', 'string', 'in:pdf,docx,pptx,txt'],
            'source_file_url' => ['nullable', 'string', 'url'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $user = $request->user();

        // Generate summary using AI
        try {
            $summaryContent = $this->geminiService->generateSummary(
                $request->content,
                $request->subject_id ? "مادة تعليمية" : null
            );

            $summary = Summary::create([
                'id' => Str::uuid(),
                'user_id' => $user->id,
                'title' => $request->title,
                'original_content' => $request->content,
                'summary_content' => $summaryContent,
                'subject_id' => $request->subject_id,
                'source_file_type' => $request->source_file_type,
                'source_file_url' => $request->source_file_url,
            ]);

            return response()->json([
                'success' => true,
                'summary' => $this->formatSummary($summary->fresh()->load('subject')),
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Get summary details
     */
    public function show(string $id): JsonResponse
    {
        $summary = Summary::with(['subject', 'user:id,name,avatar_url'])->find($id);

        if (!$summary) {
            return response()->json([
                'success' => false,
                'error' => 'الملخص غير موجود',
            ], 404);
        }

        $user = request()->user();

        // Only owner or linked teachers can view
        if ($summary->user_id !== $user->id && !$user->teachers()->where('users.id', $summary->user_id)->exists()) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        return response()->json([
            'success' => true,
            'summary' => $this->formatSummary($summary, true),
        ]);
    }

    /**
     * Delete summary
     */
    public function destroy(string $id): JsonResponse
    {
        $summary = Summary::find($id);

        if (!$summary) {
            return response()->json([
                'success' => false,
                'error' => 'الملخص غير موجود',
            ], 404);
        }

        $user = request()->user();

        if ($summary->user_id !== $user->id) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $summary->delete();

        return response()->json([
            'success' => true,
            'message' => 'تم حذف الملخص بنجاح',
        ]);
    }

    /**
     * Refine transcribed text
     */
    public function refineText(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'text' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => 'يرجى إدخال النص',
            ], 422);
        }

        try {
            $refinedText = $this->geminiService->refineTranscribedText($request->text);

            return response()->json([
                'success' => true,
                'text' => $refinedText,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Format summary for response
     */
    private function formatSummary(Summary $summary, bool $includeContent = false): array
    {
        $data = [
            'id' => $summary->id,
            'title' => $summary->title,
            'subject_id' => $summary->subject_id,
            'source_file_type' => $summary->source_file_type,
            'source_file_url' => $summary->source_file_url,
            'compression_ratio' => $summary->compressionRatio(),
            'created_at' => $summary->created_at->toIso8601String(),
        ];

        if ($summary->relationLoaded('subject') && $summary->subject) {
            $data['subject'] = [
                'id' => $summary->subject->id,
                'name' => $summary->subject->name,
                'color' => $summary->subject->color,
            ];
        }

        if ($includeContent) {
            $data['original_content'] = $summary->original_content;
            $data['summary_content'] = $summary->summary_content;
        }

        return $data;
    }
}