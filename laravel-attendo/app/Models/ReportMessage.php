<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ReportMessage extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'report_id',
        'sender_id',
        'recipient_type',
        'recipient_id',
        'content',
        'message_type',
        'attachments',
    ];

    protected $casts = ['attachments' => 'array'];

    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class);
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sender_id');
    }

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recipient_id');
    }
}