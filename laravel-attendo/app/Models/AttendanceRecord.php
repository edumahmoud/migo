<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AttendanceRecord extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'session_id',
        'student_id',
        'attendance_status',
        'latitude',
        'longitude',
        'checked_in_at',
        'qr_code',
    ];

    protected $casts = [
        'checked_in_at' => 'datetime',
        'latitude' => 'decimal:8',
        'longitude' => 'decimal:8',
    ];

    // Relationships
    public function session(): BelongsTo
    {
        return $this->belongsTo(AttendanceSession::class, 'session_id');
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_id');
    }

    // Helper methods
    public function isPresent(): bool
    {
        return $this->attendance_status === 'present';
    }

    public function isLate(): bool
    {
        return $this->attendance_status === 'late';
    }

    public function isAbsent(): bool
    {
        return $this->attendance_status === 'absent';
    }

    public function isPartial(): bool
    {
        return $this->attendance_status === 'partial';
    }
}