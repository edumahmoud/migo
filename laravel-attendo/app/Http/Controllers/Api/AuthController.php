<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\BannedUser;
use App\Models\InstitutionSetting;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;

class AuthController extends Controller
{
    /**
     * Register a new user
     */
    public function register(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
            'name' => ['required', 'string', 'max:100'],
            'role' => ['required', 'in:student,teacher'],
            'gender' => ['nullable', 'string', 'max:50'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        // Check if email is banned
        if (BannedUser::isEmailBanned($request->email)) {
            return response()->json([
                'success' => false,
                'error' => 'هذا الحساب محظور',
            ], 403);
        }

        // Check registration settings
        $settings = InstitutionSetting::getSettings();
        if (!$settings->allow_registration) {
            return response()->json([
                'success' => false,
                'error' => 'التسجيل غير مفعّل حالياً',
            ], 403);
        }

        // Create user
        $user = User::create([
            'id' => Str::uuid(),
            'email' => $request->email,
            'password' => Hash::make($request->password),
            'name' => $request->name,
            'role' => $request->role,
            'gender' => $request->gender,
        ]);

        // Generate teacher code for teachers
        if ($user->role === 'teacher') {
            do {
                $code = strtoupper(substr(md5(uniqid()), 0, 6));
            } while (User::where('teacher_code', $code)->exists());
            
            $user->update(['teacher_code' => $code]);
        }

        // Check if first user (promote to superadmin)
        $isFirstUser = User::count() === 1;
        if ($isFirstUser) {
            $user->update(['role' => 'superadmin']);
        }

        // Create Sanctum token
        $token = $user->createToken('auth_token')->plainTextToken;

        return response()->json([
            'success' => true,
            'user' => $this->formatUser($user),
            'token' => $token,
            'is_first_user' => $isFirstUser,
        ], 201);
    }

    /**
     * Login user
     */
    public function login(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => 'يرجى إدخال البريد الإلكتروني وكلمة المرور',
            ], 422);
        }

        // Check if email is banned
        if (BannedUser::isEmailBanned($request->email)) {
            return response()->json([
                'success' => false,
                'error' => 'هذا الحساب محظور',
            ], 403);
        }

        $user = User::where('email', $request->email)->first();

        if (!$user || !Hash::check($request->password, $user->password)) {
            return response()->json([
                'success' => false,
                'error' => 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
            ], 401);
        }

        // Check ban status
        $ban = $user->banRecord;
        if ($ban && $ban->isActive()) {
            $reason = $ban->reason ?? 'تم حظر حسابك';
            return response()->json([
                'success' => false,
                'error' => $reason,
                'is_banned' => true,
            ], 403);
        }

        // Create token
        $token = $user->createToken('auth_token')->plainTextToken;

        return response()->json([
            'success' => true,
            'user' => $this->formatUser($user),
            'token' => $token,
        ]);
    }

    /**
     * Logout user
     */
    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json([
            'success' => true,
            'message' => 'تم تسجيل الخروج بنجاح',
        ]);
    }

    /**
     * Get current user
     */
    public function me(Request $request): JsonResponse
    {
        $user = $request->user();
        
        // Check ban status
        $ban = $user->banRecord;
        $isBanned = $ban && $ban->isActive();

        return response()->json([
            'success' => true,
            'profile' => $this->formatUser($user),
            'is_banned' => $isBanned,
            'ban_info' => $isBanned ? [
                'reason' => $ban->reason,
                'banned_at' => $ban->banned_at,
                'ban_until' => $ban->ban_until,
                'is_permanent' => $ban->is_permanent,
            ] : null,
        ]);
    }

    /**
     * Update profile
     */
    public function updateProfile(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name' => ['sometimes', 'string', 'max:100'],
            'email' => ['sometimes', 'string', 'email', 'unique:users,email,' . $request->user()->id],
            'avatar_url' => ['nullable', 'string', 'url'],
            'gender' => ['nullable', 'string', 'max:50'],
            'title_id' => ['nullable', 'string', 'max:255'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $user = $request->user();
        $user->update($request->only(['name', 'email', 'avatar_url', 'gender', 'title_id']));

        return response()->json([
            'success' => true,
            'profile' => $this->formatUser($user->fresh()),
        ]);
    }

    /**
     * Change password
     */
    public function changePassword(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', 'min:8', 'confirmed', Password::defaults()],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $user = $request->user();

        if (!Hash::check($request->current_password, $user->password)) {
            return response()->json([
                'success' => false,
                'error' => 'كلمة المرور الحالية غير صحيحة',
            ], 401);
        }

        $user->update(['password' => Hash::make($request->password)]);

        return response()->json([
            'success' => true,
            'message' => 'تم تغيير كلمة المرور بنجاح',
        ]);
    }

    /**
     * Forgot password
     */
    public function forgotPassword(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'email' => ['required', 'string', 'email'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => 'يرجى إدخال بريد إلكتروني صحيح',
            ], 422);
        }

        $user = User::where('email', $request->email)->first();

        if ($user) {
            // Generate reset token (in production, send email)
            $token = Str::random(64);
            
            // Store token in cache (in production, use database or mail)
            Cache::put('password_reset_' . $user->email, $token, now()->addHour());
        }

        // Always return success to prevent email enumeration
        return response()->json([
            'success' => true,
            'message' => 'إذا كان البريد الإلكتروني مسجلاً، ستصلك رسالة لإعادة تعيين كلمة المرور',
        ]);
    }

    /**
     * Reset password
     */
    public function resetPassword(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'email' => ['required', 'string', 'email'],
            'token' => ['required', 'string'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $storedToken = Cache::get('password_reset_' . $request->email);

        if (!$storedToken || $storedToken !== $request->token) {
            return response()->json([
                'success' => false,
                'error' => 'رمز إعادة التعيين غير صالح أو منتهي الصلاحية',
            ], 400);
        }

        $user = User::where('email', $request->email)->first();

        if (!$user) {
            return response()->json([
                'success' => false,
                'error' => 'المستخدم غير موجود',
            ], 404);
        }

        $user->update(['password' => Hash::make($request->password)]);
        Cache::forget('password_reset_' . $request->email);

        return response()->json([
            'success' => true,
            'message' => 'تم إعادة تعيين كلمة المرور بنجاح',
        ]);
    }

    /**
     * Check first user (for promotion to superadmin)
     */
    public function checkFirstUser(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'userId' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json(['success' => false], 422);
        }

        $isFirstUser = User::count() === 1;
        $user = User::find($request->userId);

        if ($isFirstUser && $user && $user->role !== 'superadmin') {
            $user->update(['role' => 'superadmin']);
            
            return response()->json([
                'success' => true,
                'promoted' => true,
                'user' => $this->formatUser($user->fresh()),
            ]);
        }

        return response()->json([
            'success' => true,
            'promoted' => false,
        ]);
    }

    /**
     * Delete account
     */
    public function deleteAccount(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'password' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => 'يرجى تأكيد كلمة المرور',
            ], 422);
        }

        $user = $request->user();

        if (!Hash::check($request->password, $user->password)) {
            return response()->json([
                'success' => false,
                'error' => 'كلمة المرور غير صحيحة',
            ], 401);
        }

        // Delete user (cascades will handle related data)
        $user->tokens()->delete();
        $user->delete();

        return response()->json([
            'success' => true,
            'message' => 'تم حذف الحساب بنجاح',
        ]);
    }

    /**
     * Format user data for response
     */
    private function formatUser(User $user): array
    {
        return [
            'id' => $user->id,
            'email' => $user->email,
            'name' => $user->name,
            'username' => $user->username,
            'role' => $user->role,
            'teacher_code' => $user->teacher_code,
            'avatar_url' => $user->avatar_url,
            'gender' => $user->gender,
            'title_id' => $user->title_id,
            'is_admin' => in_array($user->role, ['admin', 'superadmin']),
            'created_at' => $user->created_at->toIso8601String(),
            'updated_at' => $user->updated_at->toIso8601String(),
        ];
    }
}