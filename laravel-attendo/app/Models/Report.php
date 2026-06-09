<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Report extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'report_number',
        'reporter_id',
        'target_type',
        'target_id',
        'reason',
        'description',
        'status',
        'assigned_to',
        'reopen_count',
        'attachments',
    ];

    protected $casts = ['attachments' => 'array'];

    public function reporter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reporter_id');
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }

    public function responses(): HasMany
    {
        return $this->hasMany(ReportResponse::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(ReportMessage::class);
    }

    public function isPending(): bool
    {
        return $this->status === 'pending';
    }

    public function isResolved(): bool
    {
        return $this->status === 'resolved';
    }

    public static function generateReportNumber(): string
    {
        return 'RPT-' . now()->format('Ymd') . '-' . strtoupper(substr(md5(uniqid()), 0, 4));
    }
}