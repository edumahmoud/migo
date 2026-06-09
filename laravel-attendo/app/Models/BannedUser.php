<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BannedUser extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'email',
        'reason',
        'banned_at',
        'ban_until',
        'is_permanent',
        'banned_by',
    ];

    protected $casts = [
        'banned_at' => 'datetime',
        'ban_until' => 'datetime',
        'is_permanent' => 'boolean',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function banner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'banned_by');
    }

    public function isActive(): bool
    {
        if ($this->is_permanent) return true;
        return $this->ban_until && $this->ban_until->gt(now());
    }

    public static function isEmailBanned(string $email): bool
    {
        return self::where('email', strtolower($email))
            ->where(function ($query) {
                $query->where('is_permanent', true)
                    ->orWhere('ban_until', '>', now());
            })->exists();
    }
}