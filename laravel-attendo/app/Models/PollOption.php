<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PollOption extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'poll_id',
        'option_text',
        'sort_order',
    ];

    public function poll(): BelongsTo
    {
        return $this->belongsTo(Poll::class);
    }

    public function responses(): HasMany
    {
        return $this->hasMany(PollResponse::class);
    }

    public function responseCount(): int
    {
        return $this->responses()->count();
    }
}