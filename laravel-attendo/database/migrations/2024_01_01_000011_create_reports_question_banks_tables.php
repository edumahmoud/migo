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
        Schema::create('reports', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('report_number')->unique();
            $table->uuid('reporter_id');
            $table->enum('target_type', ['comment', 'message', 'user', 'other'])->default('other');
            $table->uuid('target_id')->nullable();
            $table->text('reason');
            $table->text('description')->nullable();
            $table->enum('status', ['pending', 'in_progress', 'resolved', 'dismissed'])->default('pending');
            $table->uuid('assigned_to')->nullable();
            $table->integer('reopen_count')->default(0);
            $table->json('attachments')->nullable();
            $table->timestamps();

            $table->foreign('reporter_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('assigned_to')->references('id')->on('users')->onDelete('set null');
            $table->index('reporter_id');
            $table->index('status');
            $table->index('assigned_to');
        });

        Schema::create('report_responses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('report_id');
            $table->uuid('responder_id');
            $table->enum('action', ['reply', 'forward', 'resolve', 'dismiss', 'reopen', 'block', 'warn', 'message_reporter', 'message_reported', 'return']);
            $table->text('content')->nullable();
            $table->uuid('forwarded_to')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('report_id')->references('id')->on('reports')->onDelete('cascade');
            $table->foreign('responder_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('forwarded_to')->references('id')->on('users')->onDelete('set null');
            $table->index('report_id');
        });

        Schema::create('report_messages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('report_id');
            $table->uuid('sender_id');
            $table->enum('recipient_type', ['reporter', 'reported']);
            $table->uuid('recipient_id');
            $table->text('content');
            $table->enum('message_type', ['info', 'warning', 'auto'])->default('info');
            $table->json('attachments')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('report_id')->references('id')->on('reports')->onDelete('cascade');
            $table->foreign('sender_id')->references('id')->on('users')->onDelete('cascade');
            $table->index('report_id');
            $table->index('recipient_id');
        });

        Schema::create('question_banks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('teacher_id');
            $table->uuid('subject_id');
            $table->string('name');
            $table->text('description')->nullable();
            $table->timestamps();

            $table->foreign('teacher_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('cascade');
            $table->index('teacher_id');
            $table->index('subject_id');
        });

        Schema::create('bank_questions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('bank_id');
            $table->enum('type', ['mcq', 'boolean', 'completion', 'matching']);
            $table->text('question');
            $table->json('options')->nullable();
            $table->string('correct_answer')->nullable();
            $table->json('pairs')->nullable();
            $table->enum('difficulty', ['easy', 'medium', 'hard'])->nullable();
            $table->string('category')->nullable();
            $table->timestamps();

            $table->foreign('bank_id')->references('id')->on('question_banks')->onDelete('cascade');
            $table->index('bank_id');
            $table->index('type');
            $table->index('difficulty');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('bank_questions');
        Schema::dropIfExists('question_banks');
        Schema::dropIfExists('report_messages');
        Schema::dropIfExists('report_responses');
        Schema::dropIfExists('reports');
    }
};