<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class UserFile extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'user_id',
        'file_name',
        'file_type',
        'file_size',
        'file_url',
        'storage_path',
        'assignment_id',
        'folder_id',
        'visibility',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function assignment(): BelongsTo
    {
        return $this->belongsTo(Assignment::class);
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(UserFolder::class, 'folder_id');
    }

    public function sharedWith(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'file_shares', 'file_id', 'shared_with')
            ->withPivot('permission', 'created_at');
    }

    public function isPublic(): bool
    {
        return $this->visibility === 'public';
    }

    public function formattedSize(): string
    {
        $bytes = $this->file_size;
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }
        return round($bytes, 2) . ' ' . $units[$i];
    }
}