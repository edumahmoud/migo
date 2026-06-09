<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\SubjectController;
use App\Http\Controllers\Api\QuizController;
use App\Http\Controllers\Api\SummaryController;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Attendo (EduAI) LMS - API Routes
|
*/

// Public routes
Route::prefix('auth')->group(function () {
    Route::post('/register', [AuthController::class, 'register']);
    Route::post('/login', [AuthController::class, 'login']);
    Route::post('/forgot-password', [AuthController::class, 'forgotPassword']);
    Route::post('/reset-password', [AuthController::class, 'resetPassword']);
});

// Protected routes
Route::middleware('auth:sanctum')->group(function () {
    
    // Auth routes
    Route::prefix('auth')->group(function () {
        Route::post('/logout', [AuthController::class, 'logout']);
        Route::get('/me', [AuthController::class, 'me']);
        Route::put('/profile', [AuthController::class, 'updateProfile']);
        Route::post('/change-password', [AuthController::class, 'changePassword']);
        Route::post('/check-first-user', [AuthController::class, 'checkFirstUser']);
        Route::post('/delete-account', [AuthController::class, 'deleteAccount']);
    });

    // User routes
    Route::prefix('users')->group(function () {
        Route::get('/', [UserController::class, 'index']);
        Route::get('/teachers', [UserController::class, 'index']);
        Route::get('/students', [UserController::class, 'getTeacherStudents']);
        Route::get('/{id}', [UserController::class, 'show']);
        Route::post('/batch', [UserController::class, 'batchOperations']);
    });

    // Teacher-Student links
    Route::prefix('link-teacher')->group(function () {
        Route::post('/', [UserController::class, 'linkTeacher']);
        Route::post('/send', [UserController::class, 'sendLinkRequest']);
        Route::post('/approve', [UserController::class, 'approveLink']);
        Route::post('/reject', [UserController::class, 'rejectLink']);
        Route::post('/unlink', [UserController::class, 'unlink']);
        Route::post('/cancel', [UserController::class, 'cancelLinkRequest']);
    });

    Route::post('/link-student-approve', [UserController::class, 'approveLink']);
    
    // Pending requests
    Route::get('/link-requests/pending', [UserController::class, 'getPendingRequests']);

    // Subject routes
    Route::prefix('subjects')->group(function () {
        Route::get('/', [SubjectController::class, 'index']);
        Route::post('/', [SubjectController::class, 'store']);
        Route::get('/categories', [SubjectController::class, 'categories']);
        Route::get('/{id}', [SubjectController::class, 'show']);
        Route::put('/{id}', [SubjectController::class, 'update']);
        Route::delete('/{id}', [SubjectController::class, 'destroy']);
        Route::post('/join', [SubjectController::class, 'join']);
        Route::post('/{id}/leave', [SubjectController::class, 'leave']);
        Route::get('/{id}/students', [SubjectController::class, 'students']);
        Route::post('/{id}/manage-student', [SubjectController::class, 'manageStudent']);
        Route::post('/{id}/teachers', [SubjectController::class, 'addTeacher']);
        Route::delete('/{id}/teachers', [SubjectController::class, 'removeTeacher']);
    });

    // Quiz routes
    Route::prefix('quizzes')->group(function () {
        Route::get('/', [QuizController::class, 'index']);
        Route::post('/', [QuizController::class, 'store']);
        Route::get('/generate', [QuizController::class, 'generateQuiz']);
        Route::get('/{id}', [QuizController::class, 'show']);
        Route::put('/{id}', [QuizController::class, 'update']);
        Route::delete('/{id}', [QuizController::class, 'destroy']);
        Route::post('/{id}/submit', [QuizController::class, 'submit']);
        Route::get('/{id}/scores', [QuizController::class, 'scores']);
    });

    // Summary routes
    Route::prefix('summaries')->group(function () {
        Route::get('/', [SummaryController::class, 'index']);
        Route::post('/', [SummaryController::class, 'store']);
        Route::post('/refine', [SummaryController::class, 'refineText']);
        Route::get('/{id}', [SummaryController::class, 'show']);
        Route::delete('/{id}', [SummaryController::class, 'destroy']);
    });

    // AI routes
    Route::prefix('ai')->group(function () {
        Route::get('/health', [GeminiServiceController::class, 'health']);
        Route::get('/stats', [GeminiServiceController::class, 'stats']);
    });

    // Attendance routes
    Route::prefix('attendance')->group(function () {
        Route::get('/sessions', [AttendanceController::class, 'sessions']);
        Route::post('/sessions', [AttendanceController::class, 'createSession']);
        Route::put('/sessions/{id}/end', [AttendanceController::class, 'endSession']);
        Route::post('/sessions/{id}/checkin', [AttendanceController::class, 'checkin']);
        Route::get('/records', [AttendanceController::class, 'records']);
    });

    // Assignment routes
    Route::prefix('assignments')->group(function () {
        Route::get('/', [AssignmentController::class, 'index']);
        Route::post('/', [AssignmentController::class, 'store']);
        Route::get('/{id}', [AssignmentController::class, 'show']);
        Route::put('/{id}', [AssignmentController::class, 'update']);
        Route::delete('/{id}', [AssignmentController::class, 'destroy']);
        Route::post('/{id}/submit', [AssignmentController::class, 'submit']);
        Route::put('/{id}/grade', [AssignmentController::class, 'grade']);
    });

    // File routes
    Route::prefix('files')->group(function () {
        Route::get('/', [FileController::class, 'index']);
        Route::post('/upload', [FileController::class, 'upload']);
        Route::get('/{id}', [FileController::class, 'show']);
        Route::delete('/{id}', [FileController::class, 'destroy']);
        Route::post('/{id}/share', [FileController::class, 'share']);
    });

    // Chat routes
    Route::prefix('chat')->group(function () {
        Route::get('/conversations', [ChatController::class, 'conversations']);
        Route::post('/conversations', [ChatController::class, 'create']);
        Route::get('/conversations/{id}', [ChatController::class, 'show']);
        Route::get('/conversations/{id}/messages', [ChatController::class, 'messages']);
        Route::post('/conversations/{id}/messages', [ChatController::class, 'sendMessage']);
        Route::put('/conversations/{id}/read', [ChatController::class, 'markRead']);
    });

    // Notification routes
    Route::prefix('notifications')->group(function () {
        Route::get('/', [NotificationController::class, 'index']);
        Route::put('/{id}/read', [NotificationController::class, 'markRead']);
        Route::put('/read-all', [NotificationController::class, 'markAllRead']);
    });

    // Report routes
    Route::prefix('reports')->group(function () {
        Route::get('/', [ReportController::class, 'index']);
        Route::post('/', [ReportController::class, 'store']);
        Route::get('/{id}', [ReportController::class, 'show']);
        Route::post('/{id}/respond', [ReportController::class, 'respond']);
        Route::post('/{id}/message', [ReportController::class, 'sendMessage']);
    });

    // Admin routes (protected by role middleware)
    Route::middleware('role:admin,superadmin')->prefix('admin')->group(function () {
        Route::get('/users', [AdminController::class, 'users']);
        Route::put('/users/{id}/role', [AdminController::class, 'changeRole']);
        Route::delete('/users/{id}', [AdminController::class, 'deleteUser']);
        Route::post('/users/{id}/ban', [AdminController::class, 'banUser']);
        Route::post('/users/{id}/unban', [AdminController::class, 'unbanUser']);
        Route::get('/stats', [AdminController::class, 'stats']);
        Route::get('/announcements', [AdminController::class, 'announcements']);
        Route::post('/announcements', [AdminController::class, 'createAnnouncement']);
        Route::put('/announcements/{id}', [AdminController::class, 'updateAnnouncement']);
        Route::delete('/announcements/{id}', [AdminController::class, 'deleteAnnouncement']);
    });
});