<?php

use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Attendo (EduAI) LMS - Web Routes
|
| For now, we serve the React SPA for all non-API routes.
| In production, you can serve the built Next.js frontend or
| use Laravel as an API-only backend.
|
*/

Route::get('/', function () {
    // In production, return the Next.js built frontend
    // For API-only mode, return a simple landing page
    return response()->json([
        'name' => 'Attendo (EduAI)',
        'version' => '1.0.0',
        'description' => 'AI-Powered Learning Management System',
        'api_docs' => '/api',
        'health' => '/up',
    ]);
});

Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'timestamp' => now()->toIso8601String(),
    ]);
});