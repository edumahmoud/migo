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
        Schema::create('polls', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('subject_id')->nullable();
            $table->uuid('user_id');
            $table->string('title');
            $table->text('description')->nullable();
            $table->enum('type', ['single_choice', 'multiple_choice', 'text', 'rating', 'scale'])->default('single_choice');
            $table->boolean('is_anonymous')->default(false);
            $table->boolean('hide_results')->default(false);
            $table->enum('status', ['draft', 'active', 'closed'])->default('draft');
            $table->timestamp('closes_at')->nullable();
            $table->timestamps();

            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->index('subject_id');
            $table->index('user_id');
            $table->index('status');
        });

        Schema::create('poll_options', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('poll_id');
            $table->string('option_text');
            $table->integer('sort_order')->default(0);
            $table->timestamps();

            $table->foreign('poll_id')->references('id')->on('polls')->onDelete('cascade');
            $table->index('poll_id');
        });

        Schema::create('poll_responses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('poll_id');
            $table->uuid('option_id')->nullable();
            $table->uuid('user_id');
            $table->string('response_text')->nullable();
            $table->integer('rating_value')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('poll_id')->references('id')->on('polls')->onDelete('cascade');
            $table->foreign('option_id')->references('id')->on('poll_options')->onDelete('set null');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->unique(['poll_id', 'user_id']);
            $table->index('poll_id');
            $table->index('option_id');
        });

        Schema::create('todos', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('title');
            $table->text('description')->nullable();
            $table->boolean('is_completed')->default(false);
            $table->date('due_date')->nullable();
            $table->enum('priority', ['low', 'medium', 'high', 'urgent'])->default('medium');
            $table->uuid('subject_id')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('set null');
            $table->index('user_id');
            $table->index('is_completed');
        });

        Schema::create('sticky_notes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('title')->nullable();
            $table->text('content');
            $table->string('color')->default('#fef08a');
            $table->float('position_x')->default(0);
            $table->float('position_y')->default(0);
            $table->integer('width')->default(200);
            $table->integer('height')->default(150);
            $table->boolean('is_pinned')->default(false);
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->index('user_id');
        });

        Schema::create('subject_videos', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('subject_id');
            $table->uuid('uploaded_by');
            $table->string('title');
            $table->text('description')->nullable();
            $table->string('video_url');
            $table->string('video_type')->default('upload');
            $table->bigInteger('video_size')->default(0);
            $table->string('thumbnail_url')->nullable();
            $table->integer('duration')->nullable();
            $table->integer('view_count')->default(0);
            $table->boolean('comments_enabled')->default(true);
            $table->timestamps();

            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('cascade');
            $table->foreign('uploaded_by')->references('id')->on('users')->onDelete('cascade');
            $table->index('subject_id');
            $table->index('uploaded_by');
        });

        Schema::create('video_comments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('video_id');
            $table->uuid('user_id');
            $table->text('content');
            $table->boolean('is_flagged')->default(false);
            $table->timestamp('flagged_at')->nullable();
            $table->uuid('flagged_by')->nullable();
            $table->timestamps();

            $table->foreign('video_id')->references('id')->on('subject_videos')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('flagged_by')->references('id')->on('users')->onDelete('set null');
            $table->index('video_id');
            $table->index('is_flagged');
        });

        Schema::create('teams', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('subject_id');
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('color')->default('#10b981');
            $table->integer('level')->default(1);
            $table->timestamps();

            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('cascade');
            $table->index('subject_id');
        });

        Schema::create('team_members', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('team_id');
            $table->uuid('user_id');
            $table->enum('role', ['leader', 'member'])->default('member');
            $table->timestamp('joined_at')->useCurrent();

            $table->foreign('team_id')->references('id')->on('teams')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->unique(['team_id', 'user_id']);
            $table->index('team_id');
            $table->index('user_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('team_members');
        Schema::dropIfExists('teams');
        Schema::dropIfExists('video_comments');
        Schema::dropIfExists('subject_videos');
        Schema::dropIfExists('sticky_notes');
        Schema::dropIfExists('todos');
        Schema::dropIfExists('poll_responses');
        Schema::dropIfExists('poll_options');
        Schema::dropIfExists('polls');
    }
};