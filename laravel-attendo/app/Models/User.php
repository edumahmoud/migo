<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable, HasUuids;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'id',
        'email',
        'name',
        'username',
        'role',
        'teacher_code',
        'avatar_url',
        'gender',
        'title_id',
        'fcm_token',
        'email_verified_at',
        'password',
        'remember_token',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var array<int, string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'email_verified_at' => 'datetime',
        'password' => 'hashed',
    ];

    /**
     * Get the identifier that will be stored in the subject claim of the JWT.
     */
    public function getJWTIdentifier(): mixed
    {
        return $this->getKey();
    }

    /**
     * Return a key value array, containing any custom claims to be added to the JWT token.
     */
    public function getJWTCustomClaims(): array
    {
        return [
            'role' => $this->role,
            'email' => $this->email,
        ];
    }

    // Relationships

    public function summaries(): HasMany
    {
        return $this->hasMany(Summary::class);
    }

    public function quizzes(): HasMany
    {
        return $this->hasMany(Quiz::class);
    }

    public function subjects(): HasMany
    {
        return $this->hasMany(Subject::class, 'teacher_id');
    }

    public function notifications(): HasMany
    {
        return $this->hasMany(Notification::class);
    }

    public function unreadNotifications(): HasMany
    {
        return $this->notifications()->where('read', false);
    }

    // Teacher-Student relationships
    public function teacherLinks(): HasMany
    {
        return $this->hasMany(TeacherStudentLink::class, 'teacher_id');
    }

    public function studentLinks(): HasMany
    {
        return $this->hasMany(TeacherStudentLink::class, 'student_id');
    }

    public function students(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'teacher_student_links', 'teacher_id', 'student_id')
            ->withPivot('status', 'initiated_by', 'created_at')
            ->wherePivot('status', 'approved');
    }

    public function teachers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'teacher_student_links', 'student_id', 'teacher_id')
            ->withPivot('status', 'initiated_by', 'created_at')
            ->wherePivot('status', 'approved');
    }

    public function pendingStudents(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'teacher_student_links', 'teacher_id', 'student_id')
            ->withPivot('status', 'initiated_by', 'created_at')
            ->wherePivot('status', 'pending');
    }

    // Subject relationships
    public function subjectTeachers(): HasMany
    {
        return $this->hasMany(SubjectTeacher::class, 'teacher_id');
    }

    public function subjectStudents(): HasMany
    {
        return $this->hasMany(SubjectStudent::class, 'student_id');
    }

    public function enrolledSubjects(): BelongsToMany
    {
        return $this->belongsToMany(Subject::class, 'subject_students')
            ->withPivot('status', 'created_at')
            ->wherePivot('status', 'approved');
    }

    public function teachingSubjects(): BelongsToMany
    {
        return $this->belongsToMany(Subject::class, 'subject_teachers')
            ->withPivot('role', 'added_by', 'created_at');
    }

    // Attendance relationships
    public function attendanceSessions(): HasMany
    {
        return $this->hasMany(AttendanceSession::class, 'teacher_id');
    }

    public function attendanceRecords(): HasMany
    {
        return $this->hasMany(AttendanceRecord::class, 'student_id');
    }

    // Assignment relationships
    public function assignments(): HasMany
    {
        return $this->hasMany(Assignment::class, 'teacher_id');
    }

    public function submissions(): HasMany
    {
        return $this->hasMany(Submission::class, 'student_id');
    }

    // Chat relationships
    public function conversationParticipations(): HasMany
    {
        return $this->hasMany(ConversationParticipant::class);
    }

    public function conversations(): BelongsToMany
    {
        return $this->belongsToMany(Conversation::class, 'conversation_participants')
            ->withPivot('last_read_at', 'unread_count', 'joined_at');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class, 'sender_id');
    }

    // Reports
    public function reportedIssues(): HasMany
    {
        return $this->hasMany(Report::class, 'reporter_id');
    }

    public function assignedReports(): HasMany
    {
        return $this->hasMany(Report::class, 'assigned_to');
    }

    // Push subscriptions
    public function pushSubscriptions(): HasMany
    {
        return $this->hasMany(PushSubscription::class);
    }

    // Ban record
    public function banRecord(): HasOne
    {
        return $this->hasOne(BannedUser::class);
    }

    // Question banks
    public function questionBanks(): HasMany
    {
        return $this->hasMany(QuestionBank::class);
    }

    // Todos, polls, sticky notes
    public function todos(): HasMany
    {
        return $this->hasMany(Todo::class);
    }

    public function polls(): HasMany
    {
        return $this->hasMany(Poll::class);
    }

    public function stickyNotes(): HasMany
    {
        return $this->hasMany(StickyNote::class);
    }

    // Roles check helpers
    public function isStudent(): bool
    {
        return $this->role === 'student';
    }

    public function isTeacher(): bool
    {
        return $this->role === 'teacher';
    }

    public function isAdmin(): bool
    {
        return in_array($this->role, ['admin', 'superadmin']);
    }

    public function isSuperAdmin(): bool
    {
        return $this->role === 'superadmin';
    }

    // Generate teacher code on creation
    protected static function booted(): void
    {
        static::creating(function (User $user) {
            if ($user->role === 'teacher' && empty($user->teacher_code)) {
                $user->teacher_code = strtoupper(substr(md5(uniqid()), 0, 6));
                
                // Ensure uniqueness
                while (User::where('teacher_code', $user->teacher_code)->exists()) {
                    $user->teacher_code = strtoupper(substr(md5(uniqid()), 0, 6));
                }
            }
        });
    }
}