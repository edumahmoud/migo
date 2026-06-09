<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\UserFile;
use App\Models\UserFolder;
use App\Models\SubjectFile;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class FileController extends Controller
{
    /**
     * List user's files
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $folderId = $request->get('folder_id');

        $query = UserFile::where('user_id', $user->id)
            ->when($folderId, fn($q) => $q->where('folder_id', $folderId), fn($q) => $q->whereNull('folder_id'));

        $files = $query->orderBy('created_at', 'desc')->get();

        // Also get folders
        $folders = UserFolder::where('user_id', $user->id)
            ->when($folderId, fn($q) => $q->where('parent_folder_id', $folderId), fn($q) => $q->whereNull('parent_folder_id'))
            ->orderBy('name')
            ->get();

        return response()->json([
            'success' => true,
            'files' => $files->map(fn($f) => $this->formatFile($f)),
            'folders' => $folders->map(fn($f) => $this->formatFolder($f)),
        ]);
    }

    /**
     * Upload a file
     */
    public function upload(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'file' => ['required', 'file', 'max:102400'], // 100MB max
            'folder_id' => ['nullable', 'string', 'exists:user_folders,id'],
            'visibility' => ['nullable', 'in:public,private'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $user = $request->user();
        $file = $request->file('file');

        // Generate storage path
        $userId = $user->id;
        $folderPath = $request->folder_id ? UserFolder::find($request->folder_id)?->storage_path ?? '' : '';
        $path = "user-files/{$userId}/{$folderPath}";

        // Store file
        $storedPath = Storage::put($path, $file);
        $fileName = $file->getClientOriginalName();
        $fileUrl = Storage::url($storedPath);

        // Create database record
        $userFile = UserFile::create([
            'id' => Str::uuid(),
            'user_id' => $user->id,
            'file_name' => $fileName,
            'file_type' => $file->getClientMimeType(),
            'file_size' => $file->getSize(),
            'file_url' => $fileUrl,
            'storage_path' => $storedPath,
            'folder_id' => $request->folder_id,
            'visibility' => $request->visibility ?? 'private',
        ]);

        return response()->json([
            'success' => true,
            'file' => $this->formatFile($userFile),
        ], 201);
    }

    /**
     * Get file details
     */
    public function show(string $id): JsonResponse
    {
        $file = UserFile::find($id);

        if (!$file) {
            return response()->json([
                'success' => false,
                'error' => 'الملف غير موجود',
            ], 404);
        }

        $user = request()->user();

        // Check access
        if ($file->user_id !== $user->id && $file->visibility !== 'public') {
            // Check if shared with user
            $shared = $file->sharedWith()->where('users.id', $user->id)->exists();
            if (!$shared) {
                return response()->json([
                    'success' => false,
                    'error' => 'غير مصرح',
                ], 403);
            }
        }

        return response()->json([
            'success' => true,
            'file' => $this->formatFile($file),
        ]);
    }

    /**
     * Delete file
     */
    public function destroy(string $id): JsonResponse
    {
        $file = UserFile::find($id);

        if (!$file) {
            return response()->json([
                'success' => false,
                'error' => 'الملف غير موجود',
            ], 404);
        }

        $user = request()->user();

        if ($file->user_id !== $user->id) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        // Delete from storage
        if ($file->storage_path) {
            Storage::delete($file->storage_path);
        }

        $file->delete();

        return response()->json([
            'success' => true,
            'message' => 'تم حذف الملف بنجاح',
        ]);
    }

    /**
     * Share file with another user
     */
    public function share(Request $request, string $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'user_id' => ['required', 'string', 'exists:users,id'],
            'permission' => ['nullable', 'in:view,edit,download'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $file = UserFile::find($id);

        if (!$file) {
            return response()->json([
                'success' => false,
                'error' => 'الملف غير موجود',
            ], 404);
        }

        $user = request()->user();

        if ($file->user_id !== $user->id) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        // Share with user
        $file->sharedWith()->attach($request->user_id, [
            'permission' => $request->permission ?? 'view',
            'shared_by' => $user->id,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'تم مشاركة الملف بنجاح',
        ]);
    }

    /**
     * Create folder
     */
    public function createFolder(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name' => ['required', 'string', 'max:255'],
            'parent_folder_id' => ['nullable', 'string', 'exists:user_folders,id'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $user = $request->user();

        $parentPath = '';
        if ($request->parent_folder_id) {
            $parent = UserFolder::find($request->parent_folder_id);
            if ($parent && $parent->user_id !== $user->id) {
                return response()->json([
                    'success' => false,
                    'error' => 'غير مصرح',
                ], 403);
            }
            $parentPath = $parent->storage_path ?? '';
        }

        $folder = UserFolder::create([
            'id' => Str::uuid(),
            'user_id' => $user->id,
            'name' => $request->name,
            'parent_folder_id' => $request->parent_folder_id,
            'storage_path' => $parentPath . Str::slug($request->name) . '/',
            'visibility' => 'private',
        ]);

        return response()->json([
            'success' => true,
            'folder' => $this->formatFolder($folder),
        ], 201);
    }

    /**
     * Format file for response
     */
    private function formatFile(UserFile $file): array
    {
        return [
            'id' => $file->id,
            'file_name' => $file->file_name,
            'file_type' => $file->file_type,
            'file_size' => $file->file_size,
            'formatted_size' => $file->formattedSize(),
            'file_url' => $file->file_url,
            'storage_path' => $file->storage_path,
            'folder_id' => $file->folder_id,
            'visibility' => $file->visibility,
            'created_at' => $file->created_at->toIso8601String(),
            'updated_at' => $file->updated_at->toIso8601String(),
        ];
    }

    /**
     * Format folder for response
     */
    private function formatFolder(UserFolder $folder): array
    {
        return [
            'id' => $folder->id,
            'name' => $folder->name,
            'parent_folder_id' => $folder->parent_folder_id,
            'storage_path' => $folder->storage_path,
            'file_count' => $folder->files()->count(),
            'created_at' => $folder->created_at->toIso8601String(),
        ];
    }
}