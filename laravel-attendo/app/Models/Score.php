<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Score extends Model
{
    use HasFactory, HasUuids;

    public $timestamps = false;

    protected $fillable = [
        'id',
        'student_id',
        'teacher_id',
        'quiz_id',
        'quiz_title',
        'score',
        'total',
        'user_answers',
        'completed_at',
    ];

    protected $casts = [
        'user_answers' => 'array',
        'completed_at' => 'datetime',
    ];

    // Relationships
    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_id');
    }

    public function teacher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'teacher_id');
    }

    public function quiz(): BelongsTo
    {
        return $this->belongsTo(Quiz::class);
    }

    // Helper methods
    public function percentage(): float
    {
        if ($this->total === 0) {
            return 0;
        }
        return round(($this->score / $this->total) * 100, 2);
    }

    public function isPassing(): bool
    {
        return $this->percentage() >= 60;
    }

    public function getCorrectAnswersCount(): int
    {
        $answers = $this->user_answers ?? [];
        return collect($answers)->filter(fn($answer) => $answer['isCorrect'] ?? false)->count();
    }

    public function getWrongAnswersCount(): int
    {
        $answers = $this->user_answers ?? [];
        return collect($answers)->filter(fn($answer) => !($answer['isCorrect'] ?? true))->count();
    }
}