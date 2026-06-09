<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SubjectVideo extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'subject_id',
        'uploaded_by',
        'title',
        'description',
        'video_url',
        'video_type',
        'video_size',
        'thumbnail_url',
        'duration',
        'view_count',
        'comments_enabled',
    ];

    protected $casts = [
        'comments_enabled' => 'boolean',
        'video_size' => 'integer',
        'duration' => 'integer',
        'view_count' => 'integer',
    ];

    public function subject(): BelongsTo
    {
        return $this->belongsTo(Subject::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    public function comments(): HasMany
    {
        return $this->hasMany(VideoComment::class);
    }

    public function formattedDuration(): string
    {
        if (!$this->duration) return '0:00';
        $minutes = floor($this->duration / 60);
        $seconds = $this->duration % 60;
        return sprintf('%d:%02d', $minutes, $seconds);
    }
}