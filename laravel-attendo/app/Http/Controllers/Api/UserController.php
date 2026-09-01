<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\TeacherStudentLink;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;

class UserController extends Controller
{
    /**
     * Get user profile
     */
    public function show(string $id): JsonResponse
    {
        $user = User::find($id);

        if (!$user) {
            return response()->json([
                'success' => false,
                'error' => 'المستخدم غير موجود',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'profile' => $this->formatUser($user),
        ]);
    }

    /**
     * List users (with filters)
     */
    public function index(Request $request): JsonResponse
    {
        $query = User::query();

        // Filter by role
        if ($request->has('role')) {
            $query->where('role', $request->role);
        }

        // Search by name or email
        if ($request->has('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('email', 'like', "%{$search}%");
            });
        }

        // Get teachers
        if ($request->get('teachers_only')) {
            $query->where('role', 'teacher')
                  ->whereNotNull('teacher_code');
        }

        $users = $query->select(['id', 'name', 'email', 'role', 'avatar_url', 'teacher_code', 'gender', 'title_id'])
                       ->limit(50)
                       ->get()
                       ->map(fn($user) => $this->formatUser($user));

        return response()->json([
            'success' => true,
            'users' => $users,
        ]);
    }

    /**
     * Get students for a teacher
     */
    public function getTeacherStudents(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->role !== 'teacher') {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $status = $request->get('status', 'approved');
        
        $links = TeacherStudentLink::with('student:id,name,email,avatar_url,gender,title_id')
            ->where('teacher_id', $user->id)
            ->where('status', $status)
            ->get();

        $students = $links->map(function ($link) {
            return array_merge($this->formatUser($link->student), [
                'link_id' => $link->id,
                'link_status' => $link->status,
                'initiated_by' => $link->initiated_by,
                'created_at' => $link->created_at->toIso8601String(),
            ]);
        });

        return response()->json([
            'success' => true,
            'students' => $students,
        ]);
    }

    /**
     * Get teachers for a student
     */
    public function getStudentTeachers(Request $request): JsonResponse
    {
        $user = $request->user();

        $links = TeacherStudentLink::with('teacher:id,name,email,avatar_url,teacher_code,gender,title_id')
            ->where('student_id', $user->id)
            ->where('status', 'approved')
            ->get();

        $teachers = $links->map(function ($link) {
            return array_merge($this->formatUser($link->teacher), [
                'link_id' => $link->id,
            ]);
        });

        return response()->json([
            'success' => true,
            'teachers' => $teachers,
        ]);
    }

    /**
     * Link student to teacher
     */
    public function linkTeacher(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'teacher_code' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => 'يرجى إدخال كود المعلم',
            ], 422);
        }

        $student = $request->user();

        if ($student->role !== 'student') {
            return response()->json([
                'success' => false,
                'error' => 'فقط الطلاب يمكنهم الربط بالمعلمين',
            ], 403);
        }

        $teacher = User::where('teacher_code', $request->teacher_code)
                       ->where('role', 'teacher')
                       ->first();

        if (!$teacher) {
            return response()->json([
                'success' => false,
                'error' => 'كود المعلم غير صحيح',
            ], 404);
        }

        if ($teacher->id === $student->id) {
            return response()->json([
                'success' => false,
                'error' => 'لا يمكنك ربط نفسك',
            ], 400);
        }

        // Check if link already exists
        $existingLink = TeacherStudentLink::where('teacher_id', $teacher->id)
            ->where('student_id', $student->id)
            ->first();

        if ($existingLink) {
            if ($existingLink->status === 'approved') {
                return response()->json([
                    'success' => false,
                    'error' => 'أنت مرتبط بالفعل بهذا المعلم',
                ], 400);
            }

            if ($existingLink->status === 'pending') {
                return response()->json([
                    'success' => false,
                    'error' => 'طلب الربط قيد الانتظار',
                ], 400);
            }

            // Update rejected link
            $existingLink->update([
                'status' => 'pending',
                'initiated_by' => 'student',
            ]);

            return response()->json([
                'success' => true,
                'message' => 'تم إرسال طلب الربط بنجاح',
                'teacher' => $this->formatUser($teacher),
            ]);
        }

        // Create new link
        $link = TeacherStudentLink::create([
            'id' => \Illuminate\Support\Str::uuid(),
            'teacher_id' => $teacher->id,
            'student_id' => $student->id,
            'status' => 'pending',
            'initiated_by' => 'student',
        ]);

        return response()->json([
            'success' => true,
            'message' => 'تم إرسال طلب الربط بنجاح، انتظر موافقة المعلم',
            'teacher' => $this->formatUser($teacher),
        ]);
    }

    /**
     * Send teacher link request to student
     */
    public function sendLinkRequest(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'student_id' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => 'يرجى تحديد الطالب',
            ], 422);
        }

        $teacher = $request->user();

        if ($teacher->role !== 'teacher') {
            return response()->json([
                'success' => false,
                'error' => 'فقط المعلمون يمكنهم إرسال طلبات الربط',
            ], 403);
        }

        $student = User::find($request->student_id);

        if (!$student) {
            return response()->json([
                'success' => false,
                'error' => 'الطالب غير موجود',
            ], 404);
        }

        if ($student->role !== 'student') {
            return response()->json([
                'success' => false,
                'error' => 'المستخدم المحدد ليس طالباً',
            ], 400);
        }

        // Check existing link
        $existingLink = TeacherStudentLink::where('teacher_id', $teacher->id)
            ->where('student_id', $student->id)
            ->first();

        if ($existingLink) {
            if ($existingLink->status === 'approved') {
                return response()->json([
                    'success' => false,
                    'error' => 'هذا الطالب مرتبط بالفعل',
                ], 400);
            }

            if ($existingLink->status === 'pending') {
                return response()->json([
                    'success' => false,
                    'error' => 'طلب الربط قيد الانتظار',
                ], 400);
            }

            $existingLink->update([
                'status' => 'pending',
                'initiated_by' => 'teacher',
            ]);

            return response()->json([
                'success' => true,
                'message' => 'تم إرسال طلب الربط بنجاح',
                'student' => $this->formatUser($student),
            ]);
        }

        // Create new link
        TeacherStudentLink::create([
            'id' => \Illuminate\Support\Str::uuid(),
            'teacher_id' => $teacher->id,
            'student_id' => $student->id,
            'status' => 'pending',
            'initiated_by' => 'teacher',
        ]);

        return response()->json([
            'success' => true,
            'message' => 'تم إرسال طلب الربط بنجاح',
            'student' => $this->formatUser($student),
        ]);
    }

    /**
     * Approve link request
     */
    public function approveLink(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'link_id' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => 'يرجى تحديد طلب الربط',
            ], 422);
        }

        $user = $request->user();

        $link = TeacherStudentLink::find($request->link_id);

        if (!$link) {
            return response()->json([
                'success' => false,
                'error' => 'طلب الربط غير موجود',
            ], 404);
        }

        // Check authorization
        $isTeacher = $link->teacher_id === $user->id;
        $isStudent = $link->student_id === $user->id;

        if (!$isTeacher && !$isStudent) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        if ($link->status !== 'pending') {
            return response()->json([
                'success' => false,
                'error' => 'هذا الطلب ليس قيد الانتظار',
            ], 400);
        }

        $link->update(['status' => 'approved']);

        return response()->json([
            'success' => true,
            'message' => 'تم الموافقة على طلب الربط',
        ]);
    }

    /**
     * Reject link request
     */
    public function rejectLink(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'link_id' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => 'يرجى تحديد طلب الربط',
            ], 422);
        }

        $user = $request->user();

        $link = TeacherStudentLink::find($request->link_id);

        if (!$link) {
            return response()->json([
                'success' => false,
                'error' => 'طلب الربط غير موجود',
            ], 404);
        }

        // Only teacher can reject
        if ($link->teacher_id !== $user->id) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $link->update(['status' => 'rejected']);

        return response()->json([
            'success' => true,
            'message' => 'تم رفض طلب الربط',
        ]);
    }

    /**
     * Unlink student from teacher
     */
    public function unlink(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'student_id' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => 'يرجى تحديد الطالب',
            ], 422);
        }

        $teacher = $request->user();

        if ($teacher->role !== 'teacher') {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $link = TeacherStudentLink::where('teacher_id', $teacher->id)
            ->where('student_id', $request->student_id)
            ->first();

        if (!$link) {
            return response()->json([
                'success' => false,
                'error' => 'الطالب غير مرتبط',
            ], 404);
        }

        $link->delete();

        return response()->json([
            'success' => true,
            'message' => 'تم إلغاء الربط بنجاح',
        ]);
    }

    /**
     * Cancel link request (for students)
     */
    public function cancelLinkRequest(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'teacher_id' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => 'يرجى تحديد المعلم',
            ], 422);
        }

        $student = $request->user();

        $link = TeacherStudentLink::where('teacher_id', $request->teacher_id)
            ->where('student_id', $student->id)
            ->first();

        if (!$link) {
            return response()->json([
                'success' => false,
                'error' => 'طلب الربط غير موجود',
            ], 404);
        }

        $link->delete();

        return response()->json([
            'success' => true,
            'message' => 'تم إلغاء طلب الربط',
        ]);
    }

    /**
     * Get pending link requests
     */
    public function getPendingRequests(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->role === 'teacher') {
            $links = TeacherStudentLink::with('student:id,name,email,avatar_url,gender')
                ->where('teacher_id', $user->id)
                ->where('status', 'pending')
                ->get();

            return response()->json([
                'success' => true,
                'requests' => $links->map(function ($link) {
                    return array_merge($this->formatUser($link->student), [
                        'link_id' => $link->id,
                        'initiated_by' => $link->initiated_by,
                        'created_at' => $link->created_at->toIso8601String(),
                    ]);
                }),
            ]);
        }

        // For students
        $links = TeacherStudentLink::with('teacher:id,name,email,avatar_url,teacher_code,gender')
            ->where('student_id', $user->id)
            ->where('status', 'pending')
            ->get();

        return response()->json([
            'success' => true,
            'requests' => $links->map(function ($link) {
                return array_merge($this->formatUser($link->teacher), [
                    'link_id' => $link->id,
                    'initiated_by' => $link->initiated_by,
                    'created_at' => $link->created_at->toIso8601String(),
                ]);
            }),
        ]);
    }

    /**
     * Format user data
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
            'created_at' => $user->created_at->toIso8601String(),
        ];
    }
}