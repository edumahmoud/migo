<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Conversation extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'type',
        'subject_id',
        'title',
        'avatar_url',
    ];

    // Relationships
    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function participants(): HasMany
    {
        return $this->hasMany(ConversationParticipant::class);
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'conversation_participants')
            ->withPivot('last_read_at', 'unread_count', 'joined_at');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class)->orderBy('created_at', 'asc');
    }

    public function lastMessage(): \Illuminate\Database\Eloquent\Relations\HasOne
    {
        return $this->hasOne(Message::class)->latestOfMany();
    }

    // Helper methods
    public function isGroup(): bool
    {
        return $this->type === 'group';
    }

    public function isIndividual(): bool
    {
        return $this->type === 'individual';
    }

    public function getOtherParticipant(User $user): ?User
    {
        if ($this->isGroup()) {
            return null;
        }

        return $this->users()->where('users.id', '!=', $user->id)->first();
    }

    public function getUnreadCountFor(User $user): int
    {
        $participant = $this->participants()->where('user_id', $user->id)->first();
        return $participant?->unread_count ?? 0;
    }
}

class Message extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'conversation_id',
        'sender_id',
        'content',
        'file_url',
        'file_type',
        'is_deleted',
        'is_edited',
        'edited_at',
    ];

    protected $casts = [
        'is_deleted' => 'boolean',
        'is_edited' => 'boolean',
        'edited_at' => 'datetime',
    ];

    // Relationships
    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sender_id');
    }

    // Helper methods
    public function isEdited(): bool
    {
        return $this->is_edited;
    }

    public function isDeleted(): bool
    {
        return $this->is_deleted;
    }

    public function hasFile(): bool
    {
        return !empty($this->file_url);
    }
}

class ConversationParticipant extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'conversation_id',
        'user_id',
        'last_read_at',
        'unread_count',
    ];

    protected $casts = [
        'last_read_at' => 'datetime',
    ];

    // Relationships
    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

class Notification extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'type',
        'title',
        'body',
        'data',
        'read',
        'read_at',
    ];

    protected $casts = [
        'data' => 'array',
        'read' => 'boolean',
        'read_at' => 'datetime',
    ];

    // Relationships
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    // Helper methods
    public function markAsRead(): void
    {
        $this->update([
            'read' => true,
            'read_at' => now(),
        ]);
    }

    public function isRead(): bool
    {
        return $this->read;
    }
}

class Assignment extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'subject_id',
        'teacher_id',
        'title',
        'description',
        'due_date',
        'max_score',
        'allow_file_submission',
        'show_grade',
    ];

    protected $casts = [
        'due_date' => 'date',
        'allow_file_submission' => 'boolean',
        'show_grade' => 'boolean',
    ];

    // Relationships
    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function teacher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'teacher_id');
    }

    public function submissions(): HasMany
    {
        return $this->hasMany(Submission::class);
    }

    // Helper methods
    public function isPastDue(): bool
    {
        return $this->due_date && $this->due_date->lt(now());
    }

    public function submissionCount(): int
    {
        return $this->submissions()->count();
    }
}

class Submission extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'assignment_id',
        'student_id',
        'content',
        'file_id',
        'score',
        'feedback',
        'status',
        'submitted_at',
        'graded_at',
    ];

    protected $casts = [
        'submitted_at' => 'datetime',
        'graded_at' => 'datetime',
    ];

    // Relationships
    public function assignment(): BelongsTo
    {
        return $this->belongsTo(Assignment::class);
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_id');
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(UserFile::class, 'file_id');
    }

    // Helper methods
    public function isGraded(): bool
    {
        return $this->status === 'graded' || $this->status === 'returned';
    }

    public function percentage(): ?float
    {
        if (!$this->score || !$this->assignment) {
            return null;
        }
        return round(($this->score / $this->assignment->max_score) * 100, 2);
    }
}

class UserFile extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'file_name',
        'file_type',
        'file_size',
        'file_url',
        'storage_path',
        'assignment_id',
        'folder_id',
        'visibility',
    ];

    // Relationships
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function assignment(): BelongsTo
    {
        return $this->belongsTo(Assignment::class);
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(UserFolder::class, 'folder_id');
    }

    public function sharedWith(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'file_shares', 'file_id', 'shared_with')
            ->withPivot('permission', 'created_at');
    }

    // Helper methods
    public function isPublic(): bool
    {
        return $this->visibility === 'public';
    }

    public function formattedSize(): string
    {
        $bytes = $this->file_size;
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        
        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }
        
        return round($bytes, 2) . ' ' . $units[$i];
    }
}

class UserFolder extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'name',
        'parent_folder_id',
        'visibility',
    ];

    // Relationships
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(UserFolder::class, 'parent_folder_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(UserFolder::class, 'parent_folder_id');
    }

    public function files(): HasMany
    {
        return $this->hasMany(UserFile::class, 'folder_id');
    }
}

class SubjectFile extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'subject_id',
        'uploaded_by',
        'file_name',
        'file_type',
        'file_size',
        'file_url',
        'description',
        'category',
        'visibility',
        'user_file_id',
    ];

    // Relationships
    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    public function sourceFile(): BelongsTo
    {
        return $this->belongsTo(UserFile::class, 'user_file_id');
    }
}

class Announcement extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'title',
        'content',
        'image_url',
        'priority',
        'is_active',
        'starts_at',
        'ends_at',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'starts_at' => 'datetime',
        'ends_at' => 'datetime',
    ];

    // Relationships
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    // Helper methods
    public function isCurrentlyActive(): bool
    {
        if (!$this->is_active) {
            return false;
        }

        $now = now();
        if ($this->starts_at && $now->lt($this->starts_at)) {
            return false;
        }
        if ($this->ends_at && $now->gt($this->ends_at)) {
            return false;
        }

        return true;
    }
}

class Report extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'report_number',
        'reporter_id',
        'target_type',
        'target_id',
        'reason',
        'description',
        'status',
        'assigned_to',
        'reopen_count',
        'attachments',
    ];

    protected $casts = [
        'attachments' => 'array',
    ];

    // Relationships
    public function reporter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reporter_id');
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }

    public function responses(): HasMany
    {
        return $this->hasMany(ReportResponse::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(ReportMessage::class);
    }

    // Helper methods
    public function isPending(): bool
    {
        return $this->status === 'pending';
    }

    public function isResolved(): bool
    {
        return $this->status === 'resolved';
    }

    public static function generateReportNumber(): string
    {
        $prefix = 'RPT';
        $date = now()->format('Ymd');
        $random = strtoupper(substr(md5(uniqid()), 0, 4));
        return "{$prefix}-{$date}-{$random}";
    }
}

class ReportResponse extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'report_id',
        'responder_id',
        'action',
        'content',
        'forwarded_to',
    ];

    // Relationships
    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class);
    }

    public function responder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'responder_id');
    }

    public function forwardedToUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'forwarded_to');
    }
}

class ReportMessage extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'report_id',
        'sender_id',
        'recipient_type',
        'recipient_id',
        'content',
        'message_type',
        'attachments',
    ];

    protected $casts = [
        'attachments' => 'array',
    ];

    // Relationships
    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class);
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sender_id');
    }

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recipient_id');
    }
}

class BannedUser extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'email',
        'reason',
        'banned_at',
        'ban_until',
        'is_permanent',
        'banned_by',
    ];

    protected $casts = [
        'banned_at' => 'datetime',
        'ban_until' => 'datetime',
        'is_permanent' => 'boolean',
    ];

    // Relationships
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function banner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'banned_by');
    }

    // Helper methods
    public function isActive(): bool
    {
        if ($this->is_permanent) {
            return true;
        }

        return $this->ban_until && $this->ban_until->gt(now());
    }

    public static function isEmailBanned(string $email): bool
    {
        return self::where('email', strtolower($email))
            ->where(function ($query) {
                $query->where('is_permanent', true)
                    ->orWhere('ban_until', '>', now());
            })
            ->exists();
    }
}

class PushSubscription extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'endpoint',
        'keys_p256dh',
        'keys_auth',
    ];

    // Relationships
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

class Poll extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'subject_id',
        'user_id',
        'title',
        'description',
        'type',
        'is_anonymous',
        'hide_results',
        'status',
        'closes_at',
    ];

    protected $casts = [
        'is_anonymous' => 'boolean',
        'hide_results' => 'boolean',
        'closes_at' => 'datetime',
    ];

    // Relationships
    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function options(): HasMany
    {
        return $this->hasMany(PollOption::class)->orderBy('sort_order');
    }

    public function responses(): HasMany
    {
        return $this->hasMany(PollResponse::class);
    }

    // Helper methods
    public function isClosed(): bool
    {
        if ($this->status === 'closed') {
            return true;
        }

        return $this->closes_at && $this->closes_at->lt(now());
    }

    public function totalResponses(): int
    {
        return $this->responses()->count();
    }

    public function hasUserResponded(User $user): bool
    {
        return $this->responses()->where('user_id', $user->id)->exists();
    }
}

class PollOption extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'poll_id',
        'option_text',
        'sort_order',
    ];

    // Relationships
    public function poll(): BelongsTo
    {
        return $this->belongsTo(Poll::class);
    }

    public function responses(): HasMany
    {
        return $this->hasMany(PollResponse::class);
    }

    public function responseCount(): int
    {
        return $this->responses()->count();
    }
}

class PollResponse extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'poll_id',
        'option_id',
        'user_id',
        'response_text',
        'rating_value',
    ];

    // Relationships
    public function poll(): BelongsTo
    {
        return $this->belongsTo(Poll::class);
    }

    public function option(): BelongsTo
    {
        return $this->belongsTo(PollOption::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

class Todo extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'title',
        'description',
        'is_completed',
        'due_date',
        'priority',
        'subject_id',
        'completed_at',
    ];

    protected $casts = [
        'is_completed' => 'boolean',
        'due_date' => 'date',
        'completed_at' => 'datetime',
    ];

    // Relationships
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    // Helper methods
    public function isOverdue(): bool
    {
        return $this->due_date && $this->due_date->lt(now()) && !$this->is_completed;
    }
}

class StickyNote extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'title',
        'content',
        'color',
        'position_x',
        'position_y',
        'width',
        'height',
        'is_pinned',
    ];

    // Relationships
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

class SubjectVideo extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'subject_id',
        'uploaded_by',
        'title',
        'description',
        'video_url',
        'video_type',
        'video_size',
        'thumbnail_url',
        'duration',
        'view_count',
        'comments_enabled',
    ];

    protected $casts = [
        'comments_enabled' => 'boolean',
        'video_size' => 'integer',
        'duration' => 'integer',
        'view_count' => 'integer',
    ];

    // Relationships
    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    public function comments(): HasMany
    {
        return $this->hasMany(VideoComment::class);
    }

    // Helper methods
    public function formattedDuration(): string
    {
        if (!$this->duration) {
            return '0:00';
        }

        $minutes = floor($this->duration / 60);
        $seconds = $this->duration % 60;
        return sprintf('%d:%02d', $minutes, $seconds);
    }
}

class VideoComment extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'video_id',
        'user_id',
        'content',
        'is_flagged',
        'flagged_at',
        'flagged_by',
    ];

    protected $casts = [
        'is_flagged' => 'boolean',
        'flagged_at' => 'datetime',
    ];

    // Relationships
    public function video(): BelongsTo
    {
        return $this->belongsTo(SubjectVideo::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function flagger(): BelongsTo
    {
        return $this->belongsTo(User::class, 'flagged_by');
    }
}

class QuestionBank extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'teacher_id',
        'subject_id',
        'name',
        'description',
    ];

    // Relationships
    public function teacher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'teacher_id');
    }

    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function questions(): HasMany
    {
        return $this->hasMany(BankQuestion::class, 'bank_id');
    }

    public function questionCount(): int
    {
        return $this->questions()->count();
    }
}

class BankQuestion extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'bank_id',
        'type',
        'question',
        'options',
        'correct_answer',
        'pairs',
        'difficulty',
        'category',
    ];

    protected $casts = [
        'options' => 'array',
        'pairs' => 'array',
    ];

    // Relationships
    public function bank(): BelongsTo
    {
        return $this->belongsTo(QuestionBank::class, 'bank_id');
    }
}

class Lecture extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'subject_id',
        'title',
        'description',
        'lecture_date',
    ];

    protected $casts = [
        'lecture_date' => 'date',
    ];

    // Relationships
    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function notes(): HasMany
    {
        return $this->hasMany(LectureNote::class);
    }

    public function attendanceSessions(): HasMany
    {
        return $this->hasMany(AttendanceSession::class);
    }

    // Helper methods
    public function hasActiveAttendance(): bool
    {
        return $this->attendanceSessions()->where('status', 'active')->exists();
    }
}

class LectureNote extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'lecture_id',
        'user_id',
        'content',
        'visibility',
    ];

    // Relationships
    public function lecture(): BelongsTo
    {
        return $this->belongsTo(Lecture::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

class Lesson extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'subject_id',
        'title',
        'content_json',
        'content_html',
        'status',
        'published_at',
        'published_json',
        'order_index',
        'created_by',
    ];

    protected $casts = [
        'content_json' => 'array',
        'published_json' => 'array',
        'published_at' => 'datetime',
    ];

    // Relationships
    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    // Helper methods
    public function isPublished(): bool
    {
        return $this->status === 'published';
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }
}

class Category extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'teacher_id',
        'name_ar',
        'name_en',
        'color',
    ];

    // Relationships
    public function teacher(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function subjects(): HasMany
    {
        return $this->hasMany(Subject::class);
    }
}

class SubjectTeacher extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'subject_id',
        'teacher_id',
        'role',
        'added_by',
    ];

    // Relationships
    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function teacher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'teacher_id');
    }

    public function adder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'added_by');
    }

    // Helper methods
    public function isOwner(): bool
    {
        return $this->role === 'owner';
    }

    public function isCoTeacher(): bool
    {
        return $this->role === 'co_teacher';
    }
}

class SubjectStudent extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'subject_id',
        'student_id',
        'status',
    ];

    // Relationships
    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_id');
    }

    // Helper methods
    public function isApproved(): bool
    {
        return $this->status === 'approved';
    }

    public function isPending(): bool
    {
        return $this->status === 'pending';
    }
}

class TeacherStudentLink extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'teacher_id',
        'student_id',
        'status',
        'initiated_by',
    ];

    // Relationships
    public function teacher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'teacher_id');
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_id');
    }

    // Helper methods
    public function isApproved(): bool
    {
        return $this->status === 'approved';
    }

    public function isPending(): bool
    {
        return $this->status === 'pending';
    }
}

class Team extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'subject_id',
        'name',
        'description',
        'color',
        'level',
    ];

    // Relationships
    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function members(): HasMany
    {
        return $this->hasMany(TeamMember::class);
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'team_members')
            ->withPivot('role', 'joined_at');
    }
}

class TeamMember extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'team_id',
        'user_id',
        'role',
    ];

    // Relationships
    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isLeader(): bool
    {
        return $this->role === 'leader';
    }
}

class InstitutionSetting extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'institution_name',
        'tagline',
        'logo_url',
        'favicon_url',
        'primary_color',
        'secondary_color',
        'allow_registration',
        'require_email_verification',
        'custom_css',
        'additional_settings',
    ];

    protected $casts = [
        'allow_registration' => 'boolean',
        'require_email_verification' => 'boolean',
        'additional_settings' => 'array',
    ];

    // Singleton pattern for settings
    protected static ?InstitutionSetting $instance = null;

    public static function getSettings(): self
    {
        if (!self::$instance) {
            self::$instance = self::firstOrCreate(
                ['id' => 'default'],
                ['institution_name' => 'Attendo']
            );
        }
        return self::$instance;
    }
}

class PlatformAnnouncement extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'created_by',
        'title',
        'content',
        'image_url',
        'type',
        'priority',
        'is_active',
        'dismissible',
        'starts_at',
        'ends_at',
        'target_roles',
        'metadata',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'dismissible' => 'boolean',
        'starts_at' => 'datetime',
        'ends_at' => 'datetime',
        'target_roles' => 'array',
        'metadata' => 'array',
    ];

    // Relationships
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    // Helper methods
    public function isCurrentlyActive(): bool
    {
        if (!$this->is_active) {
            return false;
        }

        $now = now();
        if ($this->starts_at && $now->lt($this->starts_at)) {
            return false;
        }
        if ($this->ends_at && $now->gt($this->ends_at)) {
            return false;
        }

        return true;
    }

    public function isTargetedToRole(string $role): bool
    {
        if (empty($this->target_roles)) {
            return true; // All roles
        }

        return in_array($role, $this->target_roles);
    }
}