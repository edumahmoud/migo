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
        Schema::create('attendance_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('lecture_id');
            $table->uuid('teacher_id');
            $table->uuid('subject_id');
            $table->enum('status', ['active', 'ended'])->default('active');
            $table->timestamp('started_at')->useCurrent();
            $table->timestamp('ended_at')->nullable();
            $table->decimal('teacher_latitude', 10, 8)->nullable();
            $table->decimal('teacher_longitude', 11, 8)->nullable();
            $table->timestamps();

            $table->foreign('lecture_id')->references('id')->on('lectures')->onDelete('cascade');
            $table->foreign('teacher_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('cascade');
            $table->index('lecture_id');
            $table->index('teacher_id');
            $table->index('status');
        });

        Schema::create('attendance_records', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('session_id');
            $table->uuid('student_id');
            $table->enum('attendance_status', ['present', 'late', 'partial', 'absent'])->default('present');
            $table->decimal('latitude', 10, 8)->nullable();
            $table->decimal('longitude', 11, 8)->nullable();
            $table->timestamp('checked_in_at')->nullable();
            $table->string('qr_code')->nullable();
            $table->timestamps();

            $table->foreign('session_id')->references('id')->on('attendance_sessions')->onDelete('cascade');
            $table->foreign('student_id')->references('id')->on('users')->onDelete('cascade');
            $table->unique(['session_id', 'student_id']);
            $table->index('session_id');
            $table->index('student_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('attendance_records');
        Schema::dropIfExists('attendance_sessions');
    }
};