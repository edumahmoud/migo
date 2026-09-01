<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

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

    public function isPastDue(): bool
    {
        return $this->due_date && $this->due_date->lt(now());
    }

    public function submissionCount(): int
    {
        return $this->submissions()->count();
    }
}