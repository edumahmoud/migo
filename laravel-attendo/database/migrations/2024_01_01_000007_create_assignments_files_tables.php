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
        Schema::create('assignments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('subject_id');
            $table->uuid('teacher_id');
            $table->string('title');
            $table->text('description')->nullable();
            $table->date('due_date')->nullable();
            $table->integer('max_score')->default(100);
            $table->boolean('allow_file_submission')->default(true);
            $table->boolean('show_grade')->default(true);
            $table->timestamps();

            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('cascade');
            $table->foreign('teacher_id')->references('id')->on('users')->onDelete('cascade');
            $table->index('subject_id');
            $table->index('teacher_id');
            $table->index('due_date');
        });

        Schema::create('submissions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('assignment_id');
            $table->uuid('student_id');
            $table->text('content')->nullable();
            $table->uuid('file_id')->nullable();
            $table->integer('score')->nullable();
            $table->text('feedback')->nullable();
            $table->enum('status', ['submitted', 'graded', 'returned'])->default('submitted');
            $table->timestamp('submitted_at')->useCurrent();
            $table->timestamp('graded_at')->nullable();

            $table->foreign('assignment_id')->references('id')->on('assignments')->onDelete('cascade');
            $table->foreign('student_id')->references('id')->on('users')->onDelete('cascade');
            $table->unique(['assignment_id', 'student_id']);
            $table->index('assignment_id');
            $table->index('student_id');
        });

        Schema::create('user_folders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('name');
            $table->uuid('parent_folder_id')->nullable();
            $table->enum('visibility', ['public', 'private'])->default('private');
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('parent_folder_id')->references('id')->on('user_folders')->onDelete('cascade');
            $table->index('user_id');
        });

        Schema::create('user_files', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('file_name');
            $table->string('file_type');
            $table->bigInteger('file_size');
            $table->string('file_url');
            $table->string('storage_path')->nullable();
            $table->uuid('assignment_id')->nullable();
            $table->uuid('folder_id')->nullable();
            $table->enum('visibility', ['public', 'private'])->default('private');
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('assignment_id')->references('id')->on('assignments')->onDelete('set null');
            $table->foreign('folder_id')->references('id')->on('user_folders')->onDelete('set null');
            $table->index('user_id');
            $table->index('folder_id');
        });

        Schema::create('subject_files', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('subject_id');
            $table->uuid('uploaded_by');
            $table->string('file_name');
            $table->string('file_type');
            $table->bigInteger('file_size');
            $table->string('file_url');
            $table->text('description')->nullable();
            $table->string('category')->nullable();
            $table->enum('visibility', ['public', 'private'])->default('public');
            $table->uuid('user_file_id')->nullable();
            $table->timestamps();

            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('cascade');
            $table->foreign('uploaded_by')->references('id')->on('users')->onDelete('cascade');
            $table->index('subject_id');
            $table->index('uploaded_by');
        });

        Schema::create('file_shares', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('file_id');
            $table->uuid('shared_by');
            $table->uuid('shared_with');
            $table->enum('permission', ['view', 'edit', 'download'])->default('view');
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('file_id')->references('id')->on('user_files')->onDelete('cascade');
            $table->foreign('shared_by')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('shared_with')->references('id')->on('users')->onDelete('cascade');
            $table->index('file_id');
            $table->index('shared_with');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('file_shares');
        Schema::dropIfExists('subject_files');
        Schema::dropIfExists('user_files');
        Schema::dropIfExists('user_folders');
        Schema::dropIfExists('submissions');
        Schema::dropIfExists('assignments');
    }
};