<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->foreignUuid('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });

        Schema::create('personal_access_tokens', function (Blueprint $table) {
            $table->id();
            $table->uuidMorphs('tokenable');
            $table->string('name');
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });

        Schema::create('institution_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('institution_name')->default('Attendo');
            $table->string('tagline')->nullable();
            $table->string('logo_url')->nullable();
            $table->string('favicon_url')->nullable();
            $table->string('primary_color')->default('#0284c7');
            $table->string('secondary_color')->default('#0d9488');
            $table->boolean('allow_registration')->default(true);
            $table->boolean('require_email_verification')->default(false);
            $table->text('custom_css')->nullable();
            $table->json('additional_settings')->nullable();
            $table->timestamps();
        });

        Schema::create('platform_announcements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('created_by');
            $table->string('title');
            $table->longText('content');
            $table->string('image_url')->nullable();
            $table->enum('type', ['info', 'warning', 'success', 'announcement'])->default('announcement');
            $table->enum('priority', ['low', 'medium', 'high'])->default('medium');
            $table->boolean('is_active')->default(true);
            $table->boolean('dismissible')->default(true);
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->json('target_roles')->nullable(); // null = all roles, or ['student', 'teacher']
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->foreign('created_by')->references('id')->on('users')->onDelete('cascade');
            $table->index('is_active');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('platform_announcements');
        Schema::dropIfExists('institution_settings');
        Schema::dropIfExists('personal_access_tokens');
        Schema::dropIfExists('sessions');
    }
};