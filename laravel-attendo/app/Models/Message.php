<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Message extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'conversation_id',
        'sender_id',
        'content',
        'file_url',
        'file_type',
        'is_deleted',
        'is_edited',
        'edited_at',
    ];

    protected $casts = [
        'is_deleted' => 'boolean',
        'is_edited' => 'boolean',
        'edited_at' => 'datetime',
    ];

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sender_id');
    }

    public function isEdited(): bool
    {
        return $this->is_edited;
    }

    public function isDeleted(): bool
    {
        return $this->is_deleted;
    }

    public function hasFile(): bool
    {
        return !empty($this->file_url);
    }
}