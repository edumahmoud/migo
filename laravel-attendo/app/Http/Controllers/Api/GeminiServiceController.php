<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\GeminiService;
use Illuminate\Http\JsonResponse;

class GeminiServiceController extends Controller
{
    protected GeminiService $geminiService;

    public function __construct(GeminiService $geminiService)
    {
        $this->geminiService = $geminiService;
    }

    /**
     * Check AI provider health
     */
    public function health(): JsonResponse
    {
        $health = $this->geminiService->checkHealth();

        return response()->json([
            'success' => true,
            'health' => $health,
        ]);
    }

    /**
     * Get AI service stats
     */
    public function stats(): JsonResponse
    {
        $stats = $this->geminiService->getStats();

        return response()->json([
            'success' => true,
            'stats' => $stats,
        ]);
    }
}