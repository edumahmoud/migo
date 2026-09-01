<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Poll extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'subject_id',
        'user_id',
        'title',
        'description',
        'type',
        'is_anonymous',
        'hide_results',
        'status',
        'closes_at',
    ];

    protected $casts = [
        'is_anonymous' => 'boolean',
        'hide_results' => 'boolean',
        'closes_at' => 'datetime',
    ];

    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function options(): HasMany
    {
        return $this->hasMany(PollOption::class)->orderBy('sort_order');
    }

    public function responses(): HasMany
    {
        return $this->hasMany(PollResponse::class);
    }

    public function isClosed(): bool
    {
        if ($this->status === 'closed') return true;
        return $this->closes_at && $this->closes_at->lt(now());
    }

    public function totalResponses(): int
    {
        return $this->responses()->count();
    }

    public function hasUserResponded(User $user): bool
    {
        return $this->responses()->where('user_id', $user->id)->exists();
    }
}