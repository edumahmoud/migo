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
        Schema::create('categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('teacher_id');
            $table->string('name_ar');
            $table->string('name_en');
            $table->string('color')->nullable();
            $table->timestamps();
        });

        Schema::create('subjects', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('teacher_id');
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('color', 20)->default('#10b981');
            $table->string('join_code')->unique();
            $table->string('level')->nullable();
            $table->string('sub_level')->nullable();
            $table->uuid('category_id')->nullable();
            $table->string('thumbnail_url')->nullable();
            $table->boolean('is_paused')->default(false);
            $table->timestamps();

            $table->foreign('teacher_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('category_id')->references('id')->on('categories')->onDelete('set null');
            $table->index('teacher_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('subjects');
        Schema::dropIfExists('categories');
    }
};