<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\Subject;
use App\Models\Report;
use App\Models\Announcement;
use App\Models\BannedUser;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class AdminController extends Controller
{
    /**
     * Get all users
     */
    public function users(Request $request): JsonResponse
    {
        $query = User::query();

        if ($request->has('role')) {
            $query->where('role', $request->role);
        }

        if ($request->has('search')) {
            $query->where(function ($q) use ($request) {
                $q->where('name', 'like', "%{$request->search}%")
                  ->orWhere('email', 'like', "%{$request->search}%");
            });
        }

        $users = $query->orderBy('created_at', 'desc')
            ->paginate($request->get('per_page', 20));

        return response()->json([
            'success' => true,
            'users' => $users->items(),
            'pagination' => [
                'current_page' => $users->currentPage(),
                'last_page' => $users->lastPage(),
                'per_page' => $users->perPage(),
                'total' => $users->total(),
            ],
        ]);
    }

    /**
     * Change user role
     */
    public function changeRole(Request $request, string $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'role' => ['required', 'in:student,teacher,admin,superadmin'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $user = User::find($id);

        if (!$user) {
            return response()->json([
                'success' => false,
                'error' => 'المستخدم غير موجود',
            ], 404);
        }

        $currentUser = request()->user();

        // Cannot change own role
        if ($user->id === $currentUser->id) {
            return response()->json([
                'success' => false,
                'error' => 'لا يمكنك تغيير دورك الخاص',
            ], 400);
        }

        // Only superadmin can assign superadmin role
        if ($request->role === 'superadmin' && !$currentUser->isSuperAdmin()) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $user->update(['role' => $request->role]);

        return response()->json([
            'success' => true,
            'message' => 'تم تغيير الدور بنجاح',
            'user' => [
                'id' => $user->id,
                'role' => $user->role,
            ],
        ]);
    }

    /**
     * Delete user
     */
    public function deleteUser(string $id): JsonResponse
    {
        $user = User::find($id);

        if (!$user) {
            return response()->json([
                'success' => false,
                'error' => 'المستخدم غير موجود',
            ], 404);
        }

        $currentUser = request()->user();

        // Cannot delete yourself
        if ($user->id === $currentUser->id) {
            return response()->json([
                'success' => false,
                'error' => 'لا يمكنك حذف حسابك الخاص',
            ], 400);
        }

        // Cannot delete superadmin unless you're superadmin
        if ($user->isSuperAdmin() && !$currentUser->isSuperAdmin()) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $user->delete();

        return response()->json([
            'success' => true,
            'message' => 'تم حذف المستخدم بنجاح',
        ]);
    }

    /**
     * Ban user
     */
    public function banUser(Request $request, string $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'reason' => ['nullable', 'string', 'max:1000'],
            'ban_until' => ['nullable', 'date', 'after:now'],
            'is_permanent' => ['nullable', 'boolean'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $user = User::find($id);

        if (!$user) {
            return response()->json([
                'success' => false,
                'error' => 'المستخدم غير موجود',
            ], 404);
        }

        $currentUser = request()->user();

        // Cannot ban yourself
        if ($user->id === $currentUser->id) {
            return response()->json([
                'success' => false,
                'error' => 'لا يمكنك حظر نفسك',
            ], 400);
        }

        // Cannot ban superadmin unless you're superadmin
        if ($user->isSuperAdmin() && !$currentUser->isSuperAdmin()) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        // Check if already banned
        $existingBan = BannedUser::where('user_id', $user->id)->first();
        if ($existingBan) {
            return response()->json([
                'success' => false,
                'error' => 'المستخدم محظور بالفعل',
            ], 400);
        }

        BannedUser::create([
            'id' => Str::uuid(),
            'user_id' => $user->id,
            'email' => $user->email,
            'reason' => $request->reason,
            'ban_until' => $request->ban_until,
            'is_permanent' => $request->is_permanent ?? false,
            'banned_by' => $currentUser->id,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'تم حظر المستخدم بنجاح',
        ]);
    }

    /**
     * Unban user
     */
    public function unbanUser(string $id): JsonResponse
    {
        $user = User::find($id);

        if (!$user) {
            return response()->json([
                'success' => false,
                'error' => 'المستخدم غير موجود',
            ], 404);
        }

        $ban = BannedUser::where('user_id', $id)->first();

        if (!$ban) {
            return response()->json([
                'success' => false,
                'error' => 'المستخدم غير محظور',
            ], 400);
        }

        $ban->delete();

        return response()->json([
            'success' => true,
            'message' => 'تم إلغاء حظر المستخدم بنجاح',
        ]);
    }

    /**
     * Get platform stats
     */
    public function stats(): JsonResponse
    {
        $stats = [
            'total_users' => User::count(),
            'total_students' => User::where('role', 'student')->count(),
            'total_teachers' => User::where('role', 'teacher')->count(),
            'total_admins' => User::whereIn('role', ['admin', 'superadmin'])->count(),
            'total_subjects' => Subject::count(),
            'total_reports' => Report::count(),
            'pending_reports' => Report::where('status', 'pending')->count(),
            'banned_users' => BannedUser::where('is_permanent', true)
                ->orWhere('ban_until', '>', now())
                ->count(),
        ];

        return response()->json([
            'success' => true,
            'stats' => $stats,
        ]);
    }

    /**
     * Get announcements
     */
    public function announcements(Request $request): JsonResponse
    {
        $announcements = Announcement::with('user:id,name,avatar_url')
            ->when($request->get('active'), fn($q) => $q->where('is_active', true))
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json([
            'success' => true,
            'announcements' => $announcements,
        ]);
    }

    /**
     * Create announcement
     */
    public function createAnnouncement(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'title' => ['required', 'string', 'max:255'],
            'content' => ['required', 'string'],
            'image_url' => ['nullable', 'string', 'url'],
            'priority' => ['nullable', 'in:low,medium,high'],
            'is_active' => ['nullable', 'boolean'],
            'starts_at' => ['nullable', 'date'],
            'ends_at' => ['nullable', 'date', 'after:starts_at'],
            'target_roles' => ['nullable', 'array'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $user = request()->user();

        $announcement = Announcement::create([
            'id' => Str::uuid(),
            'user_id' => $user->id,
            'title' => $request->title,
            'content' => $request->content,
            'image_url' => $request->image_url,
            'priority' => $request->priority ?? 'medium',
            'is_active' => $request->is_active ?? true,
            'starts_at' => $request->starts_at,
            'ends_at' => $request->ends_at,
            'target_roles' => $request->target_roles,
        ]);

        return response()->json([
            'success' => true,
            'announcement' => $announcement,
        ], 201);
    }

    /**
     * Update announcement
     */
    public function updateAnnouncement(Request $request, string $id): JsonResponse
    {
        $announcement = Announcement::find($id);

        if (!$announcement) {
            return response()->json([
                'success' => false,
                'error' => 'الإعلان غير موجود',
            ], 404);
        }

        $announcement->update($request->only([
            'title', 'content', 'image_url', 'priority', 
            'is_active', 'starts_at', 'ends_at', 'target_roles'
        ]));

        return response()->json([
            'success' => true,
            'announcement' => $announcement->fresh(),
        ]);
    }

    /**
     * Delete announcement
     */
    public function deleteAnnouncement(string $id): JsonResponse
    {
        $announcement = Announcement::find($id);

        if (!$announcement) {
            return response()->json([
                'success' => false,
                'error' => 'الإعلان غير موجود',
            ], 404);
        }

        $announcement->delete();

        return response()->json([
            'success' => true,
            'message' => 'تم حذف الإعلان بنجاح',
        ]);
    }
}