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
        Schema::create('notifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('type'); // lecture, assignment, quiz, link_request, file_request, chat, report, etc.
            $table->string('title');
            $table->text('body')->nullable();
            $table->json('data')->nullable(); // Additional metadata
            $table->boolean('read')->default(false);
            $table->timestamp('read_at')->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->index('user_id');
            $table->index('type');
            $table->index('read');
        });

        Schema::create('announcements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id'); // Creator
            $table->string('title');
            $table->longText('content');
            $table->string('image_url')->nullable();
            $table->enum('priority', ['low', 'medium', 'high'])->default('medium');
            $table->boolean('is_active')->default(true);
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->index('is_active');
        });

        Schema::create('push_subscriptions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('endpoint');
            $table->string('keys_p256dh')->nullable();
            $table->string('keys_auth')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('updated_at')->useCurrent();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->unique(['user_id', 'endpoint']);
            $table->index('user_id');
        });

        Schema::create('banned_users', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('email')->unique();
            $table->text('reason')->nullable();
            $table->timestamp('banned_at')->useCurrent();
            $table->timestamp('ban_until')->nullable();
            $table->boolean('is_permanent')->default(false);
            $table->uuid('banned_by');
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('banned_by')->references('id')->on('users')->onDelete('cascade');
            $table->index('email');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('banned_users');
        Schema::dropIfExists('push_subscriptions');
        Schema::dropIfExists('announcements');
        Schema::dropIfExists('notifications');
    }
};