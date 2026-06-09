<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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