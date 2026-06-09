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
        Schema::create('lectures', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('subject_id');
            $table->string('title');
            $table->text('description')->nullable();
            $table->date('lecture_date')->nullable();
            $table->timestamps();

            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('cascade');
            $table->index('subject_id');
        });

        Schema::create('lecture_notes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('lecture_id');
            $table->uuid('user_id');
            $table->text('content');
            $table->enum('visibility', ['public', 'private', 'sticky'])->default('public');
            $table->timestamps();

            $table->foreign('lecture_id')->references('id')->on('lectures')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->index('lecture_id');
            $table->index('user_id');
            $table->index('visibility');
        });

        Schema::create('lessons', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('subject_id');
            $table->string('title');
            $table->json('content_json')->nullable();
            $table->longText('content_html')->nullable();
            $table->enum('status', ['draft', 'published'])->default('draft');
            $table->timestamp('published_at')->nullable();
            $table->json('published_json')->nullable();
            $table->integer('order_index')->default(0);
            $table->uuid('created_by');
            $table->timestamps();

            $table->foreign('subject_id')->references('id')->on('subjects')->onDelete('cascade');
            $table->foreign('created_by')->references('id')->on('users')->onDelete('cascade');
            $table->index('subject_id');
            $table->index('status');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('lessons');
        Schema::dropIfExists('lecture_notes');
        Schema::dropIfExists('lectures');
    }
};