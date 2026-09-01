<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Subject extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'teacher_id',
        'name',
        'description',
        'color',
        'join_code',
        'level',
        'sub_level',
        'category_id',
        'thumbnail_url',
        'is_paused',
    ];

    protected $casts = [
        'is_paused' => 'boolean',
    ];

    // Generate join code on creation
    protected static function booted(): void
    {
        static::creating(function (Subject $subject) {
            if (empty($subject->join_code)) {
                $subject->join_code = strtoupper(substr(md5(uniqid()), 0, 6));
                
                while (Subject::where('join_code', $subject->join_code)->exists()) {
                    $subject->join_code = strtoupper(substr(md5(uniqid()), 0, 6));
                }
            }
        });
    }

    // Relationships
    public function teacher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'teacher_id');
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function teachers(): HasMany
    {
        return $this->hasMany(SubjectTeacher::class);
    }

    public function owner(): BelongsTo
    {
        return $this->teachers()->where('role', 'owner');
    }

    public function coTeachers(): HasMany
    {
        return $this->teachers()->where('role', 'co_teacher');
    }

    public function students(): HasMany
    {
        return $this->hasMany(SubjectStudent::class);
    }

    public function approvedStudents(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'subject_students')
            ->withPivot('status', 'created_at')
            ->wherePivot('status', 'approved');
    }

    public function pendingStudents(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'subject_students')
            ->withPivot('status', 'created_at')
            ->wherePivot('status', 'pending');
    }

    public function lectures(): HasMany
    {
        return $this->hasMany(Lecture::class);
    }

    public function lessons(): HasMany
    {
        return $this->hasMany(Lesson::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(Assignment::class);
    }

    public function subjectFiles(): HasMany
    {
        return $this->hasMany(SubjectFile::class);
    }

    public function videos(): HasMany
    {
        return $this->hasMany(SubjectVideo::class);
    }

    public function polls(): HasMany
    {
        return $this->hasMany(Poll::class);
    }

    public function teams(): HasMany
    {
        return $this->hasMany(Team::class);
    }

    public function conversations(): HasMany
    {
        return $this->hasMany(Conversation::class);
    }

    // Helper methods
    public function isTeacher(User $user): bool
    {
        return $this->teacher_id === $user->id || 
               $this->teachers()->where('teacher_id', $user->id)->exists();
    }

    public function isOwner(User $user): bool
    {
        return $this->teacher_id === $user->id;
    }

    public function hasStudent(User $user): bool
    {
        return $this->students()
            ->where('student_id', $user->id)
            ->where('status', 'approved')
            ->exists();
    }

    public function studentCount(): int
    {
        return $this->students()->where('status', 'approved')->count();
    }

    public function teacherCount(): int
    {
        return $this->teachers()->count();
    }
}