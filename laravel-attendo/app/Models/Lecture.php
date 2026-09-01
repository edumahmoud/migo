<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

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

    public function hasActiveAttendance(): bool
    {
        return $this->attendanceSessions()->where('status', 'active')->exists();
    }
}