<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AttendanceSession extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'lecture_id',
        'teacher_id',
        'subject_id',
        'status',
        'started_at',
        'ended_at',
        'teacher_latitude',
        'teacher_longitude',
    ];

    protected $casts = [
        'started_at' => 'datetime',
        'ended_at' => 'datetime',
        'teacher_latitude' => 'decimal:8',
        'teacher_longitude' => 'decimal:8',
    ];

    // Relationships
    public function lecture(): BelongsTo
    {
        return $this->belongsTo(Lecture::class);
    }

    public function teacher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'teacher_id');
    }

    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function records(): HasMany
    {
        return $this->hasMany(AttendanceRecord::class, 'session_id');
    }

    // Helper methods
    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    public function hasEnded(): bool
    {
        return $this->status === 'ended';
    }

    public function studentCount(): int
    {
        return $this->records()->count();
    }

    public function presentCount(): int
    {
        return $this->records()->where('attendance_status', 'present')->count();
    }

    public function lateCount(): int
    {
        return $this->records()->where('attendance_status', 'late')->count();
    }

    public function absentCount(): int
    {
        return $this->records()->where('attendance_status', 'absent')->count();
    }
}