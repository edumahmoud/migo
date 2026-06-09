<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class InstitutionSetting extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'id',
        'institution_name',
        'tagline',
        'logo_url',
        'favicon_url',
        'primary_color',
        'secondary_color',
        'allow_registration',
        'require_email_verification',
        'custom_css',
        'additional_settings',
    ];

    protected $casts = [
        'allow_registration' => 'boolean',
        'require_email_verification' => 'boolean',
        'additional_settings' => 'array',
    ];

    public static function getSettings(): self
    {
        return self::firstOrCreate(
            ['id' => 'default'],
            ['institution_name' => 'Attendo']
        );
    }
}