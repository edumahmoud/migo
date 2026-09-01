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
        Schema::create('summaries', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('title');
            $table->text('original_content');
            $table->text('summary_content');
            $table->uuid('subject_id')->nullable();
            $table->string('source_file_type')->nullable(); // pdf, docx, pptx, txt
            $table->string('source_file_url')->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('set null');
            $table->index('user_id');
            $table->index('subject_id');
        });

        Schema::create('quizzes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('title');
            $table->integer('duration')->nullable();
            $table->string('scheduled_date')->nullable();
            $table->string('scheduled_time')->nullable();
            $table->uuid('summary_id')->nullable();
            $table->json('questions')->default('[]');
            $table->boolean('show_results')->default(true);
            $table->boolean('show_review')->default(false);
            $table->boolean('allow_retake')->default(false);
            $table->boolean('shuffle_questions')->default(false);
            $table->boolean('is_finished')->default(false);
            $table->uuid('subject_id')->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('set null');
            $table->index('user_id');
            $table->index('subject_id');
        });

        Schema::create('scores', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('student_id');
            $table->uuid('teacher_id');
            $table->uuid('quiz_id');
            $table->string('quiz_title');
            $table->integer('score')->default(0);
            $table->integer('total')->default(0);
            $table->json('user_answers')->default('[]');
            $table->timestamp('completed_at')->useCurrent();

            $table->foreign('student_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('teacher_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('quiz_id')->references('id')->on('quizzes')->onDelete('cascade');
            $table->index('student_id');
            $table->index('teacher_id');
            $table->index('quiz_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('scores');
        Schema::dropIfExists('quizzes');
        Schema::dropIfExists('summaries');
    }
};