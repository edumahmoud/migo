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
        Schema::create('subject_teachers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('subject_id');
            $table->uuid('teacher_id');
            $table->enum('role', ['owner', 'co_teacher'])->default('co_teacher');
            $table->uuid('added_by');
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('cascade');
            $table->foreign('teacher_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('added_by')->references('id')->on('users')->onDelete('cascade');
            
            $table->unique(['subject_id', 'teacher_id']);
            $table->index('subject_id');
            $table->index('teacher_id');
            $table->index('role');
        });

        Schema::create('subject_students', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('subject_id');
            $table->uuid('student_id');
            $table->enum('status', ['pending', 'approved', 'rejected'])->default('approved');
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('cascade');
            $table->foreign('student_id')->references('id')->on('users')->onDelete('cascade');
            
            $table->unique(['subject_id', 'student_id']);
            $table->index('subject_id');
            $table->index('student_id');
            $table->index(['subject_id', 'status']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('subject_students');
        Schema::dropIfExists('subject_teachers');
    }
};