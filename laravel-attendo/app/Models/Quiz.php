<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Quiz extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'title',
        'duration',
        'scheduled_date',
        'scheduled_time',
        'summary_id',
        'questions',
        'show_results',
        'show_review',
        'allow_retake',
        'shuffle_questions',
        'is_finished',
        'subject_id',
    ];

    protected $casts = [
        'questions' => 'array',
        'show_results' => 'boolean',
        'show_review' => 'boolean',
        'allow_retake' => 'boolean',
        'shuffle_questions' => 'boolean',
        'is_finished' => 'boolean',
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

    public function summary(): BelongsTo
    {
        return $this->belongsTo(Summary::class);
    }

    public function scores(): HasMany
    {
        return $this->hasMany(Score::class);
    }

    // Helper methods
    public function totalQuestions(): int
    {
        return count($this->questions ?? []);
    }

    public function isScheduled(): bool
    {
        return !empty($this->scheduled_date) && !empty($this->scheduled_time);
    }

    public function hasStarted(): bool
    {
        if (!$this->isScheduled()) {
            return true;
        }

        $scheduleDateTime = $this->scheduled_date . ' ' . $this->scheduled_time;
        return now()->gte($scheduleDateTime);
    }

    public function hasEnded(): bool
    {
        if (!$this->duration || !$this->hasStarted()) {
            return false;
        }

        // Assuming duration is in minutes
        $endTime = $this->created_at->addMinutes($this->duration);
        return now()->gt($endTime);
    }

    public function getStudentScore(string $studentId): ?Score
    {
        return $this->scores()->where('student_id', $studentId)->first();
    }

    public function averageScore(): float
    {
        $scores = $this->scores;
        if ($scores->isEmpty()) {
            return 0;
        }

        $totalPercentage = $scores->map(function ($score) {
            return $score->total > 0 ? ($score->score / $score->total) * 100 : 0;
        })->sum();

        return round($totalPercentage / $scores->count(), 2);
    }
}