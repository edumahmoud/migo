<?php

namespace Database\Seeders;

use App\Models\User;
use App\Models\Category;
use App\Models\InstitutionSetting;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // Create institution settings
        InstitutionSetting::create([
            'id' => 'default',
            'institution_name' => 'Attendo',
            'tagline' => 'منصة تعليمية ذكية',
            'primary_color' => '#0284c7',
            'secondary_color' => '#0d9488',
            'allow_registration' => true,
            'require_email_verification' => false,
        ]);

        // Create default categories
        $categories = [
            ['name_ar' => 'رياضيات', 'name_en' => 'Mathematics', 'color' => '#ef4444'],
            ['name_ar' => 'علوم', 'name_en' => 'Science', 'color' => '#22c55e'],
            ['name_ar' => 'لغة عربية', 'name_en' => 'Arabic Language', 'color' => '#3b82f6'],
            ['name_ar' => 'لغة إنجليزية', 'name_en' => 'English', 'color' => '#8b5cf6'],
            ['name_ar' => 'دراسات اجتماعية', 'name_en' => 'Social Studies', 'color' => '#f59e0b'],
            ['name_ar' => 'تاريخ', 'name_en' => 'History', 'color' => '#ec4899'],
            ['name_ar' => 'فيزياء', 'name_en' => 'Physics', 'color' => '#06b6d4'],
            ['name_ar' => 'كيمياء', 'name_en' => 'Chemistry', 'color' => '#84cc16'],
            ['name_ar' => 'أحياء', 'name_en' => 'Biology', 'color' => '#14b8a6'],
            ['name_ar' => 'حاسب آلي', 'name_en' => 'Computer Science', 'color' => '#6366f1'],
        ];

        foreach ($categories as $cat) {
            Category::create(array_merge($cat, ['id' => Str::uuid(), 'teacher_id' => null]));
        }

        // Create demo superadmin
        User::create([
            'id' => Str::uuid(),
            'email' => 'admin@attendo.com',
            'name' => 'مدير النظام',
            'role' => 'superadmin',
            'password' => Hash::make('password123'),
        ]);

        // Create demo teacher
        User::create([
            'id' => Str::uuid(),
            'email' => 'teacher@attendo.com',
            'name' => 'أحمد المعلم',
            'role' => 'teacher',
            'teacher_code' => 'TEACH01',
            'password' => Hash::make('password123'),
        ]);

        // Create demo student
        User::create([
            'id' => Str::uuid(),
            'email' => 'student@attendo.com',
            'name' => 'محمد الطالب',
            'role' => 'student',
            'password' => Hash::make('password123'),
        ]);

        $this->command->info('Database seeded successfully!');
        $this->command->info('Demo accounts:');
        $this->command->info('  Admin: admin@attendo.com / password123');
        $this->command->info('  Teacher: teacher@attendo.com / password123');
        $this->command->info('  Student: student@attendo.com / password123');
    }
}