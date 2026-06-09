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
        Schema::create('conversation_participants', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('conversation_id');
            $table->uuid('user_id');
            $table->timestamp('last_read_at')->nullable();
            $table->integer('unread_count')->default(0);
            $table->timestamp('joined_at')->nullable();
            $table->timestamps();

            $table->foreign('conversation_id')->references('id')->on('conversations')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->unique(['conversation_id', 'user_id']);
        });

        Schema::create('report_responses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('report_id');
            $table->uuid('responder_id');
            $table->string('action')->nullable();
            $table->text('content')->nullable();
            $table->uuid('forwarded_to')->nullable();
            $table->timestamps();

            $table->foreign('report_id')->references('id')->on('reports')->onDelete('cascade');
            $table->foreign('responder_id')->references('id')->on('users')->onDelete('cascade');
        });

        Schema::create('report_messages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('report_id');
            $table->uuid('sender_id');
            $table->string('recipient_type')->nullable();
            $table->uuid('recipient_id')->nullable();
            $table->text('content');
            $table->string('message_type')->default('message');
            $table->json('attachments')->nullable();
            $table->timestamps();

            $table->foreign('report_id')->references('id')->on('reports')->onDelete('cascade');
            $table->foreign('sender_id')->references('id')->on('users')->onDelete('cascade');
        });

        Schema::create('poll_options', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('poll_id');
            $table->text('option_text');
            $table->integer('sort_order')->default(0);
            $table->timestamps();

            $table->foreign('poll_id')->references('id')->on('polls')->onDelete('cascade');
        });

        Schema::create('poll_responses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('poll_id');
            $table->uuid('option_id');
            $table->uuid('user_id');
            $table->text('response_text')->nullable();
            $table->integer('rating_value')->nullable();
            $table->timestamps();

            $table->foreign('poll_id')->references('id')->on('polls')->onDelete('cascade');
            $table->foreign('option_id')->references('id')->on('poll_options')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->unique(['poll_id', 'user_id']);
        });

        Schema::create('team_members', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('team_id');
            $table->uuid('user_id');
            $table->string('role')->default('member');
            $table->timestamps();

            $table->foreign('team_id')->references('id')->on('teams')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->unique(['team_id', 'user_id']);
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
        });

        Schema::create('bank_questions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('bank_id');
            $table->string('type')->default('multiple_choice');
            $table->text('question');
            $table->json('options')->nullable();
            $table->text('correct_answer')->nullable();
            $table->json('pairs')->nullable();
            $table->string('difficulty')->nullable();
            $table->string('category')->nullable();
            $table->timestamps();

            $table->foreign('bank_id')->references('id')->on('question_banks')->onDelete('cascade');
        });

        Schema::create('file_shares', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('file_id');
            $table->uuid('shared_with');
            $table->string('permission')->default('view');
            $table->timestamps();

            $table->foreign('file_id')->references('id')->on('user_files')->onDelete('cascade');
            $table->foreign('shared_with')->references('id')->on('users')->onDelete('cascade');
            $table->unique(['file_id', 'shared_with']);
        });

        Schema::create('sticky_notes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('title')->nullable();
            $table->text('content');
            $table->string('color')->default('#fef08a');
            $table->integer('position_x')->default(0);
            $table->integer('position_y')->default(0);
            $table->integer('width')->default(200);
            $table->integer('height')->default(200);
            $table->boolean('is_pinned')->default(false);
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('conversation_participants');
        Schema::dropIfExists('report_responses');
        Schema::dropIfExists('report_messages');
        Schema::dropIfExists('poll_options');
        Schema::dropIfExists('poll_responses');
        Schema::dropIfExists('team_members');
        Schema::dropIfExists('video_comments');
        Schema::dropIfExists('bank_questions');
        Schema::dropIfExists('file_shares');
        Schema::dropIfExists('sticky_notes');
    }
};