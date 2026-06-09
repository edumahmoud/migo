<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Subject;
use App\Models\SubjectTeacher;
use App\Models\SubjectStudent;
use App\Models\User;
use App\Models\Category;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class SubjectController extends Controller
{
    /**
     * List subjects for current user
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->role === 'teacher') {
            // Get subjects where user is owner or co-teacher
            $subjects = Subject::where('teacher_id', $user->id)
                ->orWhereHas('teachers', fn($q) => $q->where('teacher_id', $user->id))
                ->with(['category', 'teachers.teacher:id,name,avatar_url'])
                ->orderBy('created_at', 'desc')
                ->get();
        } else {
            // Get enrolled subjects
            $subjects = Subject::whereHas('students', fn($q) => 
                $q->where('student_id', $user->id)->where('status', 'approved')
            )->with(['category', 'teacher:id,name,avatar_url'])
            ->orderBy('created_at', 'desc')
            ->get();
        }

        return response()->json([
            'success' => true,
            'subjects' => $subjects->map(fn($s) => $this->formatSubject($s, $user)),
        ]);
    }

    /**
     * Create a new subject
     */
    public function store(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'color' => ['nullable', 'string', 'max:20'],
            'level' => ['nullable', 'string', 'max:255'],
            'sub_level' => ['nullable', 'string', 'max:255'],
            'category_id' => ['nullable', 'string', 'exists:categories,id'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $user = $request->user();

        if (!in_array($user->role, ['teacher', 'admin', 'superadmin'])) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح بإنشاء مواد',
            ], 403);
        }

        $subject = Subject::create([
            'id' => Str::uuid(),
            'teacher_id' => $user->id,
            'name' => $request->name,
            'description' => $request->description,
            'color' => $request->color ?? '#10b981',
            'level' => $request->level,
            'sub_level' => $request->sub_level,
            'category_id' => $request->category_id,
        ]);

        // Create owner entry in subject_teachers
        SubjectTeacher::create([
            'id' => Str::uuid(),
            'subject_id' => $subject->id,
            'teacher_id' => $user->id,
            'role' => 'owner',
            'added_by' => $user->id,
        ]);

        return response()->json([
            'success' => true,
            'subject' => $this->formatSubject($subject->fresh()->load(['category', 'teachers.teacher']), $user),
        ], 201);
    }

    /**
     * Get subject details
     */
    public function show(string $id): JsonResponse
    {
        $subject = Subject::with(['category', 'teacher:id,name,avatar_url', 'teachers.teacher:id,name,avatar_url'])
            ->find($id);

        if (!$subject) {
            return response()->json([
                'success' => false,
                'error' => 'المادة غير موجودة',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'subject' => $this->formatSubject($subject, request()->user()),
        ]);
    }

    /**
     * Update subject
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name' => ['sometimes', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'color' => ['nullable', 'string', 'max:20'],
            'level' => ['nullable', 'string', 'max:255'],
            'sub_level' => ['nullable', 'string', 'max:255'],
            'category_id' => ['nullable', 'string', 'exists:categories,id'],
            'thumbnail_url' => ['nullable', 'string', 'url'],
            'is_paused' => ['nullable', 'boolean'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $subject = Subject::find($id);

        if (!$subject) {
            return response()->json([
                'success' => false,
                'error' => 'المادة غير موجودة',
            ], 404);
        }

        $user = $request->user();

        // Check if user is owner or co-teacher
        if (!$subject->isTeacher($user)) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $subject->update($request->only([
            'name', 'description', 'color', 'level', 'sub_level', 
            'category_id', 'thumbnail_url', 'is_paused'
        ]));

        return response()->json([
            'success' => true,
            'subject' => $this->formatSubject($subject->fresh()->load(['category', 'teachers.teacher']), $user),
        ]);
    }

    /**
     * Delete subject
     */
    public function destroy(string $id): JsonResponse
    {
        $subject = Subject::find($id);

        if (!$subject) {
            return response()->json([
                'success' => false,
                'error' => 'المادة غير موجودة',
            ], 404);
        }

        $user = request()->user();

        // Only owner or superadmin can delete
        if (!$subject->isOwner($user) && !$user->isSuperAdmin()) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $subject->delete();

        return response()->json([
            'success' => true,
            'message' => 'تم حذف المادة بنجاح',
        ]);
    }

    /**
     * Join subject with code
     */
    public function join(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'join_code' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => 'يرجى إدخال كود المادة',
            ], 422);
        }

        $subject = Subject::where('join_code', strtoupper($request->join_code))->first();

        if (!$subject) {
            return response()->json([
                'success' => false,
                'error' => 'كود المادة غير صحيح',
            ], 404);
        }

        $user = $request->user();

        // Check if already enrolled
        $existing = SubjectStudent::where('subject_id', $subject->id)
            ->where('student_id', $user->id)
            ->first();

        if ($existing) {
            if ($existing->status === 'approved') {
                return response()->json([
                    'success' => false,
                    'error' => 'أنت مسجل بالفعل في هذه المادة',
                ], 400);
            }

            if ($existing->status === 'pending') {
                return response()->json([
                    'success' => false,
                    'error' => 'طلب الانضمام قيد الانتظار',
                ], 400);
            }

            $existing->update(['status' => 'pending']);
            return response()->json([
                'success' => true,
                'message' => 'تم إرسال طلب الانضمام بنجاح',
                'subject' => $this->formatSubject($subject, $user),
            ]);
        }

        // Create enrollment
        SubjectStudent::create([
            'id' => Str::uuid(),
            'subject_id' => $subject->id,
            'student_id' => $user->id,
            'status' => 'pending',
        ]);

        return response()->json([
            'success' => true,
            'message' => 'تم إرسال طلب الانضمام بنجاح، انتظر موافقة المعلم',
            'subject' => $this->formatSubject($subject, $user),
        ]);
    }

    /**
     * Leave subject
     */
    public function leave(string $id): JsonResponse
    {
        $subject = Subject::find($id);

        if (!$subject) {
            return response()->json([
                'success' => false,
                'error' => 'المادة غير موجودة',
            ], 404);
        }

        $user = $request->user();

        $enrollment = SubjectStudent::where('subject_id', $id)
            ->where('student_id', $user->id)
            ->first();

        if (!$enrollment) {
            return response()->json([
                'success' => false,
                'error' => 'أنت غير مسجل في هذه المادة',
            ], 404);
        }

        $enrollment->delete();

        return response()->json([
            'success' => true,
            'message' => 'تم مغادرة المادة بنجاح',
        ]);
    }

    /**
     * Get subject students
     */
    public function students(string $id): JsonResponse
    {
        $subject = Subject::find($id);

        if (!$subject) {
            return response()->json([
                'success' => false,
                'error' => 'المادة غير موجودة',
            ], 404);
        }

        $user = request()->user();

        // Check access
        if (!$subject->isTeacher($user) && !$subject->hasStudent($user)) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $status = request()->get('status', 'approved');

        $students = SubjectStudent::where('subject_id', $id)
            ->where('status', $status)
            ->with('student:id,name,email,avatar_url,gender,title_id')
            ->get()
            ->map(fn($ss) => $this->formatUser($ss->student) + ['status' => $ss->status]);

        return response()->json([
            'success' => true,
            'students' => $students,
        ]);
    }

    /**
     * Approve/reject student enrollment
     */
    public function manageStudent(Request $request, string $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'student_id' => ['required', 'string'],
            'action' => ['required', 'in:approve,reject'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $subject = Subject::find($id);

        if (!$subject) {
            return response()->json([
                'success' => false,
                'error' => 'المادة غير موجودة',
            ], 404);
        }

        $user = request()->user();

        if (!$subject->isTeacher($user)) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $enrollment = SubjectStudent::where('subject_id', $id)
            ->where('student_id', $request->student_id)
            ->first();

        if (!$enrollment) {
            return response()->json([
                'success' => false,
                'error' => 'الطالب غير مسجل',
            ], 404);
        }

        $enrollment->update([
            'status' => $request->action === 'approve' ? 'approved' : 'rejected',
        ]);

        return response()->json([
            'success' => true,
            'message' => $request->action === 'approve' 
                ? 'تم قبول الطالب بنجاح' 
                : 'تم رفض الطالب بنجاح',
        ]);
    }

    /**
     * Add co-teacher to subject
     */
    public function addTeacher(Request $request, string $id): JsonResponse
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

        $subject = Subject::find($id);

        if (!$subject) {
            return response()->json([
                'success' => false,
                'error' => 'المادة غير موجودة',
            ], 404);
        }

        $user = request()->user();

        // Only owner can add co-teachers
        if (!$subject->isOwner($user)) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $teacher = User::find($request->teacher_id);

        if (!$teacher || $teacher->role !== 'teacher') {
            return response()->json([
                'success' => false,
                'error' => 'المعلم غير موجود',
            ], 404);
        }

        // Check if already added
        $existing = SubjectTeacher::where('subject_id', $id)
            ->where('teacher_id', $teacher->id)
            ->first();

        if ($existing) {
            return response()->json([
                'success' => false,
                'error' => 'هذا المعلم مضاف بالفعل',
            ], 400);
        }

        SubjectTeacher::create([
            'id' => Str::uuid(),
            'subject_id' => $id,
            'teacher_id' => $teacher->id,
            'role' => 'co_teacher',
            'added_by' => $user->id,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'تم إضافة المعلم بنجاح',
            'teacher' => $this->formatUser($teacher),
        ]);
    }

    /**
     * Remove co-teacher from subject
     */
    public function removeTeacher(Request $request, string $id): JsonResponse
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

        $subject = Subject::find($id);

        if (!$subject) {
            return response()->json([
                'success' => false,
                'error' => 'المادة غير موجودة',
            ], 404);
        }

        $user = request()->user();

        // Only owner can remove co-teachers
        if (!$subject->isOwner($user)) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $subjectTeacher = SubjectTeacher::where('subject_id', $id)
            ->where('teacher_id', $request->teacher_id)
            ->first();

        if (!$subjectTeacher) {
            return response()->json([
                'success' => false,
                'error' => 'المعلم غير مضاف لهذه المادة',
            ], 404);
        }

        // Cannot remove owner
        if ($subjectTeacher->role === 'owner') {
            return response()->json([
                'success' => false,
                'error' => 'لا يمكن إزالة صاحب المادة',
            ], 400);
        }

        $subjectTeacher->delete();

        return response()->json([
            'success' => true,
            'message' => 'تم إزالة المعلم بنجاح',
        ]);
    }

    /**
     * List categories
     */
    public function categories(): JsonResponse
    {
        $categories = Category::all();

        return response()->json([
            'success' => true,
            'categories' => $categories,
        ]);
    }

    /**
     * Format subject for response
     */
    private function formatSubject(Subject $subject, ?User $user = null): array
    {
        $data = [
            'id' => $subject->id,
            'name' => $subject->name,
            'description' => $subject->description,
            'color' => $subject->color,
            'join_code' => $subject->join_code,
            'level' => $subject->level,
            'sub_level' => $subject->sub_level,
            'is_paused' => $subject->is_paused,
            'thumbnail_url' => $subject->thumbnail_url,
            'student_count' => $subject->studentCount(),
            'teacher_count' => $subject->teacherCount(),
            'created_at' => $subject->created_at->toIso8601String(),
            'updated_at' => $subject->updated_at->toIso8601String(),
        ];

        if ($subject->relationLoaded('category') && $subject->category) {
            $data['category'] = [
                'id' => $subject->category->id,
                'name_ar' => $subject->category->name_ar,
                'name_en' => $subject->category->name_en,
                'color' => $subject->category->color,
            ];
        }

        if ($subject->relationLoaded('teacher')) {
            $data['owner'] = $subject->teacher ? [
                'id' => $subject->teacher->id,
                'name' => $subject->teacher->name,
                'avatar_url' => $subject->teacher->avatar_url,
            ] : null;
        }

        if ($subject->relationLoaded('teachers')) {
            $data['co_teachers'] = $subject->teachers
                ->where('role', 'co_teacher')
                ->map(fn($st) => [
                    'id' => $st->teacher->id,
                    'name' => $st->teacher->name,
                    'avatar_url' => $st->teacher->avatar_url,
                    'role' => $st->role,
                ])
                ->toArray();
        }

        return $data;
    }

    private function formatUser(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'avatar_url' => $user->avatar_url,
            'gender' => $user->gender,
            'title_id' => $user->title_id,
            'teacher_code' => $user->teacher_code ?? null,
        ];
    }
}