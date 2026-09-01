<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BankQuestion extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'bank_id',
        'type',
        'question',
        'options',
        'correct_answer',
        'pairs',
        'difficulty',
        'category',
    ];

    protected $casts = [
        'options' => 'array',
        'pairs' => 'array',
    ];

    public function bank(): BelongsTo
    {
        return $this->belongsTo(QuestionBank::class, 'bank_id');
    }
}