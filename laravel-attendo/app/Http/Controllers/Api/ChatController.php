<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Events\NewMessageEvent;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class ChatController extends Controller
{
    /**
     * Get user's conversations
     */
    public function conversations(Request $request): JsonResponse
    {
        $user = $request->user();

        $conversations = Conversation::whereHas('participants', fn($q) => $q->where('user_id', $user->id))
            ->with(['participants.user:id,name,avatar_url', 'subject:id,name,color', 'lastMessage'])
            ->orderBy('updated_at', 'desc')
            ->get()
            ->map(fn($c) => $this->formatConversation($c, $user));

        return response()->json([
            'success' => true,
            'conversations' => $conversations,
        ]);
    }

    /**
     * Create a new conversation
     */
    public function create(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'type' => ['required', 'in:individual,group'],
            'participant_ids' => ['required', 'array', 'min:1'],
            'title' => ['nullable', 'string', 'max:255'],
            'subject_id' => ['nullable', 'string', 'exists:subjects,id'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $user = $request->user();
        $participantIds = $request->participant_ids;

        // Ensure current user is included
        if (!in_array($user->id, $participantIds)) {
            $participantIds[] = $user->id;
        }

        // For individual chats, check if conversation already exists
        if ($request->type === 'individual' && count($participantIds) === 2) {
            $existing = $this->findExistingIndividualConversation($participantIds);
            if ($existing) {
                return response()->json([
                    'success' => true,
                    'conversation' => $this->formatConversation($existing, $user),
                    'existing' => true,
                ]);
            }
        }

        // Create conversation
        $conversation = Conversation::create([
            'id' => Str::uuid(),
            'type' => $request->type,
            'subject_id' => $request->subject_id,
            'title' => $request->title,
        ]);

        // Add participants
        foreach ($participantIds as $participantId) {
            ConversationParticipant::create([
                'id' => Str::uuid(),
                'conversation_id' => $conversation->id,
                'user_id' => $participantId,
                'unread_count' => $participantId === $user->id ? 0 : 1,
            ]);
        }

        return response()->json([
            'success' => true,
            'conversation' => $this->formatConversation($conversation->fresh()->load(['participants.user', 'subject']), $user),
        ], 201);
    }

    /**
     * Get conversation details
     */
    public function show(string $id): JsonResponse
    {
        $conversation = Conversation::with(['participants.user:id,name,avatar_url', 'subject'])
            ->find($id);

        if (!$conversation) {
            return response()->json([
                'success' => false,
                'error' => 'المحادثة غير موجودة',
            ], 404);
        }

        $user = request()->user();

        // Check if user is participant
        if (!$conversation->participants()->where('user_id', $user->id)->exists()) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        return response()->json([
            'success' => true,
            'conversation' => $this->formatConversation($conversation, $user),
        ]);
    }

    /**
     * Get conversation messages
     */
    public function messages(Request $request, string $id): JsonResponse
    {
        $conversation = Conversation::find($id);

        if (!$conversation) {
            return response()->json([
                'success' => false,
                'error' => 'المحادثة غير موجودة',
            ], 404);
        }

        $user = request()->user();

        // Check if user is participant
        if (!$conversation->participants()->where('user_id', $user->id)->exists()) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $limit = min($request->get('limit', 50), 100);
        $before = $request->get('before');

        $query = Message::where('conversation_id', $id)
            ->where('is_deleted', false)
            ->with('sender:id,name,avatar_url')
            ->orderBy('created_at', 'desc');

        if ($before) {
            $query->where('created_at', '<', $before);
        }

        $messages = $query->limit($limit)->get()->reverse()->values();

        return response()->json([
            'success' => true,
            'messages' => $messages->map(fn($m) => $this->formatMessage($m)),
        ]);
    }

    /**
     * Send a message
     */
    public function sendMessage(Request $request, string $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'content' => ['required', 'string', 'max:10000'],
            'file_url' => ['nullable', 'string', 'url'],
            'file_type' => ['nullable', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => $validator->errors()->first(),
            ], 422);
        }

        $conversation = Conversation::find($id);

        if (!$conversation) {
            return response()->json([
                'success' => false,
                'error' => 'المحادثة غير موجودة',
            ], 404);
        }

        $user = request()->user();

        // Check if user is participant
        $participant = $conversation->participants()->where('user_id', $user->id)->first();
        if (!$participant) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        // Create message
        $message = Message::create([
            'id' => Str::uuid(),
            'conversation_id' => $id,
            'sender_id' => $user->id,
            'content' => $request->content,
            'file_url' => $request->file_url,
            'file_type' => $request->file_type,
        ]);

        // Update conversation timestamp
        $conversation->touch();

        // Update unread counts for other participants
        $conversation->participants()
            ->where('user_id', '!=', $user->id)
            ->increment('unread_count');

        // Reset current user's unread count
        $participant->update(['unread_count' => 0, 'last_read_at' => now()]);

        // Broadcast event
        broadcast(new NewMessageEvent($message, $conversation))->toOthers();

        return response()->json([
            'success' => true,
            'message' => $this->formatMessage($message->load('sender')),
        ], 201);
    }

    /**
     * Mark conversation as read
     */
    public function markRead(Request $request, string $id): JsonResponse
    {
        $conversation = Conversation::find($id);

        if (!$conversation) {
            return response()->json([
                'success' => false,
                'error' => 'المحادثة غير موجودة',
            ], 404);
        }

        $user = request()->user();

        $participant = $conversation->participants()->where('user_id', $user->id)->first();
        if (!$participant) {
            return response()->json([
                'success' => false,
                'error' => 'غير مصرح',
            ], 403);
        }

        $participant->update([
            'unread_count' => 0,
            'last_read_at' => now(),
        ]);

        return response()->json([
            'success' => true,
        ]);
    }

    /**
     * Find existing individual conversation
     */
    private function findExistingIndividualConversation(array $participantIds): ?Conversation
    {
        if (count($participantIds) !== 2) {
            return null;
        }

        return Conversation::where('type', 'individual')
            ->whereHas('participants', fn($q) => $q->whereIn('user_id', $participantIds))
            ->with('participants')
            ->get()
            ->first(fn($c) => $c->participants()->count() === 2);
    }

    /**
     * Format conversation for response
     */
    private function formatConversation(Conversation $conversation, $user): array
    {
        $data = [
            'id' => $conversation->id,
            'type' => $conversation->type,
            'title' => $conversation->title,
            'avatar_url' => $conversation->avatar_url,
            'created_at' => $conversation->created_at->toIso8601String(),
            'updated_at' => $conversation->updated_at->toIso8601String(),
        ];

        // Get other participant for individual chats
        if ($conversation->type === 'individual' && $conversation->relationLoaded('participants')) {
            $otherParticipant = $conversation->participants
                ->first(fn($p) => $p->user_id !== $user->id);
            
            if ($otherParticipant && $otherParticipant->relationLoaded('user')) {
                $data['other_participant'] = [
                    'id' => $otherParticipant->user->id,
                    'name' => $otherParticipant->user->name,
                    'avatar_url' => $otherParticipant->user->avatar_url,
                ];
            }

            $data['unread_count'] = $otherParticipant?->unread_count ?? 0;
        } else {
            $userParticipant = $conversation->participants?->first(fn($p) => $p->user_id === $user->id);
            $data['unread_count'] = $userParticipant?->unread_count ?? 0;
        }

        // Subject
        if ($conversation->relationLoaded('subject') && $conversation->subject) {
            $data['subject'] = [
                'id' => $conversation->subject->id,
                'name' => $conversation->subject->name,
                'color' => $conversation->subject->color,
            ];
        }

        // Participants
        if ($conversation->relationLoaded('participants')) {
            $data['participants'] = $conversation->participants->map(fn($p) => [
                'id' => $p->user->id,
                'name' => $p->user->name,
                'avatar_url' => $p->user->avatar_url,
            ])->toArray();
        }

        // Last message
        if ($conversation->relationLoaded('lastMessage') && $conversation->lastMessage) {
            $data['last_message'] = [
                'id' => $conversation->lastMessage->id,
                'content' => $conversation->lastMessage->content,
                'sender_id' => $conversation->lastMessage->sender_id,
                'created_at' => $conversation->lastMessage->created_at->toIso8601String(),
            ];
        }

        return $data;
    }

    /**
     * Format message for response
     */
    private function formatMessage(Message $message): array
    {
        return [
            'id' => $message->id,
            'content' => $message->content,
            'file_url' => $message->file_url,
            'file_type' => $message->file_type,
            'is_edited' => $message->is_edited,
            'is_deleted' => $message->is_deleted,
            'edited_at' => $message->edited_at?->toIso8601String(),
            'created_at' => $message->created_at->toIso8601String(),
            'sender' => $message->relationLoaded('sender') && $message->sender ? [
                'id' => $message->sender->id,
                'name' => $message->sender->name,
                'avatar_url' => $message->sender->avatar_url,
            ] : null,
        ];
    }
}