<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Notification;
use App\Models\PushSubscription;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class NotificationController extends Controller
{
    /**
     * Get user's notifications
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $notifications = Notification::where('user_id', $user->id)
            ->orderBy('created_at', 'desc')
            ->limit($request->get('limit', 50))
            ->get();

        $unreadCount = Notification::where('user_id', $user->id)
            ->where('read', false)
            ->count();

        return response()->json([
            'success' => true,
            'notifications' => $notifications,
            'unread_count' => $unreadCount,
        ]);
    }

    /**
     * Mark notification as read
     */
    public function markRead(string $id): JsonResponse
    {
        $notification = Notification::find($id);

        if (!$notification) {
            return response()->json([
                'success' => false,
                'error' => 'الإشعار غير موجود',
            ], 404);
        }

        $user = request()->user();

        if ($notification->user_id !== $user->id) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $notification->markAsRead();

        return response()->json([
            'success' => true,
        ]);
    }

    /**
     * Mark all notifications as read
     */
    public function markAllRead(): JsonResponse
    {
        $user = request()->user();

        Notification::where('user_id', $user->id)
            ->where('read', false)
            ->update(['read' => true, 'read_at' => now()]);

        return response()->json([
            'success' => true,
        ]);
    }

    /**
     * Subscribe to push notifications
     */
    public function subscribe(Request $request): JsonResponse
    {
        $request->validate([
            'endpoint' => ['required', 'string', 'url'],
            'keys_p256dh' => ['nullable', 'string'],
            'keys_auth' => ['nullable', 'string'],
        ]);

        $user = request()->user();

        // Check if subscription already exists
        $existing = PushSubscription::where('user_id', $user->id)
            ->where('endpoint', $request->endpoint)
            ->first();

        if ($existing) {
            return response()->json([
                'success' => true,
                'message' => 'Already subscribed',
            ]);
        }

        PushSubscription::create([
            'id' => \Illuminate\Support\Str::uuid(),
            'user_id' => $user->id,
            'endpoint' => $request->endpoint,
            'keys_p256dh' => $request->keys_p256dh,
            'keys_auth' => $request->keys_auth,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Subscribed successfully',
        ], 201);
    }

    /**
     * Unsubscribe from push notifications
     */
    public function unsubscribe(Request $request): JsonResponse
    {
        $request->validate([
            'endpoint' => ['required', 'string'],
        ]);

        $user = request()->user();

        PushSubscription::where('user_id', $user->id)
            ->where('endpoint', $request->endpoint)
            ->delete();

        return response()->json([
            'success' => true,
            'message' => 'Unsubscribed successfully',
        ]);
    }
}