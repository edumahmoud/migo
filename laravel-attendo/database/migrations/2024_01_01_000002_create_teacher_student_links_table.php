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
        Schema::create('teacher_student_links', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('teacher_id');
            $table->uuid('student_id');
            $table->enum('status', ['pending', 'approved', 'rejected'])->default('approved');
            $table->enum('initiated_by', ['teacher', 'student'])->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('teacher_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('student_id')->references('id')->on('users')->onDelete('cascade');
            
            $table->unique(['teacher_id', 'student_id']);
            $table->index('teacher_id');
            $table->index('student_id');
            $table->index(['teacher_id', 'status']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('teacher_student_links');
    }
};