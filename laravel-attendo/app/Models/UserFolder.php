<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class UserFolder extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'name',
        'parent_folder_id',
        'visibility',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(UserFolder::class, 'parent_folder_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(UserFolder::class, 'parent_folder_id');
    }

    public function files(): HasMany
    {
        return $this->hasMany(UserFile::class, 'folder_id');
    }
}