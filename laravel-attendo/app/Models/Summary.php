<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Summary extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'title',
        'original_content',
        'summary_content',
        'subject_id',
        'source_file_type',
        'source_file_url',
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

    public function quizzes(): HasMany
    {
        return $this->hasMany(Quiz::class);
    }

    // Helper methods
    public function compressionRatio(): float
    {
        $originalLength = strlen($this->original_content);
        if ($originalLength === 0) {
            return 0;
        }
        return round((1 - (strlen($this->summary_content) / $originalLength)) * 100, 2);
    }
}