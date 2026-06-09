<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StickyNote extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'title',
        'content',
        'color',
        'position_x',
        'position_y',
        'width',
        'height',
        'is_pinned',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}