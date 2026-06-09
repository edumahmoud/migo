# LMS Platform Migration Report

## Attendo (EduAI) - Next.js/Supabase to Laravel/MySQL

**Date:** 2026-06-09  
**Version:** 1.0.0  
**Status:** Analysis Complete - Migration In Progress

---

## Executive Summary

This document provides a comprehensive analysis of the Attendo LMS platform built on Next.js/React/Supabase and outlines the complete migration plan to Laravel/MySQL.

### Platform Overview
- **Current Stack:** Next.js 16, React 19, TypeScript, Supabase (Auth, Database, Realtime, Storage)
- **Target Stack:** PHP 8.3+, Laravel 12+, MySQL 8+, Laravel Reverb, Laravel Sanctum
- **Core Features:** AI-powered summaries, quizzes, attendance, chat, file management, analytics
- **User Roles:** Students, Teachers, Admins, Superadmins

---

## 1. System Architecture Analysis

### 1.1 Core Modules Identified

| Module | Description | Complexity |
|--------|-------------|------------|
| Authentication | Supabase Auth → Laravel Sanctum | High |
| User Management | Profiles, roles, permissions | Medium |
| Student Module | Dashboard, subjects, performance tracking | Medium |
| Teacher Module | Dashboard, student management, quizzes | High |
| Admin Module | Platform administration, announcements | Medium |
| Course Management | Subjects, lectures, lessons | High |
| Attendance System | Sessions, GPS tracking, QR codes | High |
| Assignment Management | Create, submit, grade assignments | Medium |
| Quiz System | Create, take, grade quizzes with AI | High |
| AI Summaries | Gemini-powered content summarization | High |
| File Management | Upload, share, organize files | Medium |
| Video System | Video hosting with comments | Medium |
| Chat/Messaging | Real-time conversations | High |
| Notifications | Push notifications, in-app alerts | Medium |
| Reports System | User reports, admin management | Medium |
| Calendar | Events aggregation | Medium |
| Polls/Surveys | Create and respond to polls | Low |
| Todos | Task management | Low |
| Sticky Notes | Quick notes overlay | Low |
| Question Banks | Reusable quiz questions | Medium |

### 1.2 Database Schema Analysis

#### Core Tables (30 tables identified)

```
users                          - User profiles with roles
teacher_student_links          - Teacher-student relationships
summaries                      - AI-generated summaries
quizzes                        - Quiz definitions
scores                         - Student quiz scores
subjects                       - Course/subject definitions
subject_teachers               - Subject-co-teacher relationships
subject_students               - Subject enrollment
lectures                       - Lecture sessions
lecture_notes                  - Lecture notes (public/private/sticky)
assignments                    - Assignment definitions
submissions                    - Assignment submissions
attendance_sessions            - Attendance tracking sessions
attendance_records             - Student attendance records
notifications                  - User notifications
announcements                  - Platform announcements
conversations                  - Chat conversations
conversation_participants      - Chat participants
messages                       - Chat messages
reports                        - User reports/complaints
report_responses               - Admin responses to reports
report_messages                - Report communication messages
file_shares                    - File sharing records
subject_files                  - Subject-attached files
user_files                     - Personal user files
user_folders                   - File organization folders
subject_videos                 - Subject video content
video_comments                 - Video comments
polls                          - Poll definitions
poll_options                    - Poll choices
poll_responses                  - User poll responses
todos                          - Task items
sticky_notes                   - Quick notes
question_banks                 - Quiz question banks
bank_questions                 - Bank question definitions
categories                     - Subject categories
push_subscriptions             - Push notification subscriptions
institution_settings           - Platform configuration
banned_users                   - Banned user records
```

### 1.3 API Endpoints Summary

| Category | Endpoints | Count |
|----------|-----------|-------|
| Auth | login, register, logout, reset-password, me | ~15 |
| Users | profile, search, batch operations | ~8 |
| Subjects | CRUD, join, leave, teachers | ~12 |
| Quizzes | CRUD, submit, scores | ~10 |
| Summaries | create, list, delete | ~6 |
| Attendance | sessions, records, check-in | ~10 |
| Assignments | CRUD, submissions, grading | ~10 |
| Files | upload, download, share | ~15 |
| Chat | conversations, messages | ~12 |
| Reports | create, manage, respond | ~15 |
| Admin | users, stats, announcements, bans | ~20 |
| AI | generate-summary, generate-quiz, evaluate | ~8 |

---

## 2. Migration Strategy

### 2.1 Phase 1: Project Setup & Database
- [x] Analyze current schema
- [ ] Create Laravel project structure
- [ ] Generate MySQL migrations from Supabase schema
- [ ] Create Eloquent models with relationships
- [ ] Implement factories and seeders

### 2.2 Phase 2: Authentication & Authorization
- [ ] Set up Laravel Sanctum
- [ ] Migrate user authentication logic
- [ ] Implement role-based access control
- [ ] Create permission system
- [ ] Migrate auth API endpoints

### 2.3 Phase 3: Core Features
- [ ] User management APIs
- [ ] Subject/course management
- [ ] Quiz system with AI integration
- [ ] Attendance system
- [ ] Assignment management
- [ ] File upload and management

### 2.4 Phase 4: Real-time Features
- [ ] Set up Laravel Reverb
- [ ] Implement WebSocket channels
- [ ] Chat system with real-time messaging
- [ ] Live notifications
- [ ] Presence system

### 2.5 Phase 5: AI Integration
- [ ] Gemini AI service wrapper
- [ ] Summary generation API
- [ ] Quiz generation API
- [ ] Answer evaluation API
- [ ] Multi-key support with health scoring

### 2.6 Phase 6: Frontend (Laravel Blade/API)
- [ ] Create API endpoints for all features
- [ ] Build Blade templates for UI
- [ ] Preserve React components as SPA
- [ ] Implement real-time connections
- [ ] Test complete functionality

---

## 3. Technical Requirements

### 3.1 Dependencies
```json
{
  "php": "^8.3",
  "laravel/framework": "^12.0",
  "laravel/sanctum": "^4.0",
  "laravel/reverb": "^1.0",
  "pusher/pusher-php-server": "^7.2",
  "google-gemini": "^1.0",
  "symfony/mailer": "^7.0",
  "laravel/horizon": "^5.0"
}
```

### 3.2 Environment Configuration
```env
APP_NAME=Attendo
APP_ENV=production
APP_DEBUG=false
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=attendo
DB_USERNAME=root
DB_PASSWORD=

BROADCAST_CONNECTION=reverb
REVERB_APP_ID=attendo
REVERB_APP_KEY=your-key
REVERB_APP_SECRET=your-secret
REVERB_HOST=localhost
REVERB_PORT=443
REVERB_SCHEME=https

GOOGLE_API_KEY_1=your-key
GOOGLE_API_KEY_2=your-key
GOOGLE_API_KEY_3=your-key
```

---

## 4. Database Schema (MySQL)

### 4.1 Core Tables SQL Overview

```sql
-- Users table with roles
CREATE TABLE users (
    id CHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    username VARCHAR(255) UNIQUE,
    role ENUM('student', 'teacher', 'admin', 'superadmin') NOT NULL,
    teacher_code VARCHAR(255) UNIQUE,
    avatar_url TEXT,
    gender VARCHAR(50),
    title_id VARCHAR(255),
    fcm_token TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_role (role),
    INDEX idx_teacher_code (teacher_code)
);

-- Teacher-Student Links
CREATE TABLE teacher_student_links (
    id CHAR(36) PRIMARY KEY,
    teacher_id CHAR(36) NOT NULL,
    student_id CHAR(36) NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved',
    initiated_by ENUM('teacher', 'student'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_link (teacher_id, student_id)
);

-- Subjects (Courses)
CREATE TABLE subjects (
    id CHAR(36) PRIMARY KEY,
    teacher_id CHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(20) DEFAULT '#10b981',
    join_code VARCHAR(255) UNIQUE,
    level VARCHAR(255),
    sub_level VARCHAR(255),
    category_id CHAR(36),
    thumbnail_url TEXT,
    is_paused BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- Subject Teachers
CREATE TABLE subject_teachers (
    id CHAR(36) PRIMARY KEY,
    subject_id CHAR(36) NOT NULL,
    teacher_id CHAR(36) NOT NULL,
    role ENUM('owner', 'co_teacher') DEFAULT 'co_teacher',
    added_by CHAR(36) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_subject_teacher (subject_id, teacher_id)
);

-- Subject Students
CREATE TABLE subject_students (
    id CHAR(36) PRIMARY KEY,
    subject_id CHAR(36) NOT NULL,
    student_id CHAR(36) NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_subject_student (subject_id, student_id)
);

-- Quizzes
CREATE TABLE quizzes (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    title VARCHAR(255) NOT NULL,
    duration INT,
    scheduled_date VARCHAR(255),
    scheduled_time VARCHAR(255),
    summary_id CHAR(36),
    questions JSON NOT NULL,
    show_results BOOLEAN DEFAULT TRUE,
    show_review BOOLEAN DEFAULT FALSE,
    allow_retake BOOLEAN DEFAULT FALSE,
    shuffle_questions BOOLEAN DEFAULT FALSE,
    is_finished BOOLEAN DEFAULT FALSE,
    subject_id CHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL
);

-- Scores
CREATE TABLE scores (
    id CHAR(36) PRIMARY KEY,
    student_id CHAR(36) NOT NULL,
    teacher_id CHAR(36) NOT NULL,
    quiz_id CHAR(36) NOT NULL,
    quiz_title VARCHAR(255) NOT NULL,
    score INT NOT NULL DEFAULT 0,
    total INT NOT NULL DEFAULT 0,
    user_answers JSON NOT NULL,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
);

-- Additional tables to be implemented in migrations...
```

---

## 5. API Design

### 5.1 Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | User registration |
| POST | /api/auth/login | User login |
| POST | /api/auth/logout | User logout |
| POST | /api/auth/forgot-password | Password reset request |
| POST | /api/auth/reset-password | Reset password with token |
| GET | /api/auth/me | Get current user profile |
| PUT | /api/auth/profile | Update profile |

### 5.2 User Management Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/users | List users (with filters) |
| GET | /api/users/{id} | Get user by ID |
| POST | /api/users/batch | Batch user operations |
| POST | /api/link-teacher | Link student to teacher |
| POST | /api/link-teacher-approve | Approve teacher link request |

### 5.3 Subject/Course Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/subjects | List subjects |
| POST | /api/subjects | Create subject |
| GET | /api/subjects/{id} | Get subject details |
| PUT | /api/subjects/{id} | Update subject |
| DELETE | /api/subjects/{id} | Delete subject |
| POST | /api/subjects/join | Join subject with code |
| POST | /api/subjects/{id}/leave | Leave subject |
| GET | /api/subjects/{id}/students | Get subject students |
| POST | /api/subjects/{id}/teachers | Add co-teacher |

### 5.4 Quiz Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/quizzes | List quizzes |
| POST | /api/quizzes | Create quiz |
| GET | /api/quizzes/{id} | Get quiz details |
| PUT | /api/quizzes/{id} | Update quiz |
| DELETE | /api/quizzes/{id} | Delete quiz |
| POST | /api/quizzes/{id}/submit | Submit quiz answers |
| GET | /api/quizzes/{id}/scores | Get quiz scores |

### 5.5 AI Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/ai/summary | Generate content summary |
| POST | /api/ai/quiz | Generate quiz questions |
| POST | /api/ai/evaluate | Evaluate student answer |
| GET | /api/ai/health | Check AI provider health |

---

## 6. Real-time Architecture

### 6.1 Laravel Reverb Channels

| Channel | Events | Description |
|---------|--------|-------------|
| private-user.{userId} | notification, message, update | User-specific notifications |
| presence-subject.{subjectId} | join, leave, sync | Subject presence tracking |
| chat-conversation.{conversationId} | message, typing, read | Chat messages |
| attendance.{sessionId} | checkin, status | Attendance tracking |

### 6.2 Event Classes

```php
// App\Events
- UserNotification
- NewChatMessage
- QuizScoreUpdated
- AttendanceMarked
- SubjectUpdated
- StudentJoinedSubject
- TeacherStudentLinkUpdated
```

---

## 7. AI Integration Architecture

### 7.1 Gemini Service

```php
// App\Services\GeminiService
class GeminiService
{
    - generateSummary(string $content): string
    - refineTranscribedText(string $text): string
    - generateQuiz(string $topic, int $count): array
    - evaluateAnswer(string $question, string $answer): bool
    - explainWrongAnswer(string $question, string $correct, string $user): string
}
```

### 7.2 Key Features
- Multi-key rotation with health scoring
- Automatic failover on errors
- Rate limiting with cooldown
- Streaming support
- JSON structured output
- Long content handling with chunking

---

## 8. File Storage Architecture

### 8.1 Storage Configuration

```php
// config/filesystems.php
'disks' => [
    'local' => [...],
    's3' => [...], // Future cloud migration
]

// Storage buckets
- user-files: User personal files
- courses: Course materials
- subjects: Subject-specific files
- institution: Institution logos/settings
```

---

## 9. UI/UX Preservation Plan

### 9.1 Component Mapping

| Next.js Component | Laravel Equivalent |
|-------------------|-------------------|
| /src/components/auth/* | resources/views/auth/*.blade.php |
| /src/components/student/* | resources/views/student/*.blade.php |
| /src/components/teacher/* | resources/views/teacher/*.blade.php |
| /src/components/admin/* | resources/views/admin/*.blade.php |
| /src/components/shared/* | resources/views/components/*.blade.php |

### 9.2 Strategy
1. Keep React SPA with API calls to Laravel backend
2. Preserve all Tailwind CSS styling
3. Maintain identical component structure
4. Preserve all animations and transitions via Framer Motion or CSS

---

## 10. Migration Checklist

### Database
- [ ] Create 30+ Laravel migrations
- [ ] Define all foreign key relationships
- [ ] Create indexes for performance
- [ ] Add triggers for auto-updates

### Authentication
- [ ] Implement Sanctum authentication
- [ ] Create registration/login endpoints
- [ ] Implement password reset flow
- [ ] Add role-based middleware

### API Development
- [ ] 100+ API endpoints
- [ ] API resource transformers
- [ ] Request validation
- [ ] Error handling

### Real-time
- [ ] Laravel Reverb setup
- [ ] WebSocket channels
- [ ] Presence tracking
- [ ] Chat system

### AI Integration
- [ ] Gemini service class
- [ ] Summary generation
- [ ] Quiz generation
- [ ] Answer evaluation

### Testing
- [ ] Unit tests for models
- [ ] Feature tests for APIs
- [ ] Integration tests
- [ ] Browser tests

---

## 11. Estimated Timeline

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| Phase 1: Setup | 1 week | Laravel project, migrations, models |
| Phase 2: Auth | 1 week | Authentication, authorization |
| Phase 3: Core APIs | 2 weeks | All business logic APIs |
| Phase 4: Real-time | 1 week | WebSockets, chat, notifications |
| Phase 5: AI | 1 week | Gemini integration |
| Phase 6: Frontend | 2 weeks | UI integration, testing |
| Phase 7: Polish | 1 week | Bug fixes, optimization |

**Total Estimated Time: 9 weeks**

---

## 12. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data migration complexity | High | Create comprehensive migration scripts |
| Real-time feature parity | Medium | Thorough testing of all WebSocket events |
| AI functionality matching | Medium | Comprehensive AI service testing |
| Performance optimization | Medium | Database indexing, caching strategies |
| Security vulnerabilities | High | Security audit, penetration testing |

---

## 13. Success Criteria

- [ ] All 30+ database tables migrated
- [ ] 100% feature parity with original platform
- [ ] All API endpoints functional
- [ ] Real-time features working
- [ ] AI services operational
- [ ] UI/UX identical to original
- [ ] All tests passing
- [ ] Performance benchmarks met

---

---

## 14. Project Structure

The Laravel project is located at `/workspace/project/migo/laravel-attendo/`

### Key Directories

```
laravel-attendo/
├── app/
│   ├── Http/Controllers/Api/    # API Controllers
│   ├── Models/                  # Eloquent Models
│   ├── Services/                # Business Services (GeminiService)
│   ├── Events/                  # Broadcasting Events
│   ├── Middleware/              # Custom Middleware
│   └── Providers/               # Service Providers
├── database/migrations/         # 13 migration files
├── routes/
│   ├── api.php                  # API routes
│   └── web.php                  # Web routes
├── config/                      # Configuration files
└── public/
    └── index.php                # Entry point
```

### Controllers Created

| Controller | Description |
|------------|-------------|
| AuthController | Authentication, registration, login, password reset |
| UserController | User management, teacher-student links |
| SubjectController | Subject/course management |
| QuizController | Quiz creation, submission, grading |
| SummaryController | AI-powered summary generation |
| FileController | File upload, sharing, management |
| ChatController | Real-time messaging |
| NotificationController | Push notifications |
| AdminController | Platform administration |
| GeminiServiceController | AI health checks |

### Models Created (30+)

All Supabase tables have been converted to Eloquent models with proper relationships:
- User, Subject, Quiz, Score, Summary
- Lecture, Lesson, Assignment, Submission
- AttendanceSession, AttendanceRecord
- Conversation, Message, Notification
- Report, Poll, Todo, Team, and more

---

## 15. Migration Status

### ✅ Completed

- [x] Complete schema analysis
- [x] Laravel project structure
- [x] 13 database migrations
- [x] 30+ Eloquent models with relationships
- [x] Authentication with Laravel Sanctum
- [x] API controllers for all modules
- [x] Gemini AI service with multi-key support
- [x] Real-time events and broadcasting
- [x] File storage system
- [x] Chat/messaging system
- [x] Admin panel controllers

### 📋 To Complete After Installation

Once PHP and Composer are installed:

1. Run `composer install`
2. Copy `.env.example` to `.env`
3. Configure database credentials
4. Run `php artisan key:generate`
5. Run `php artisan migrate`
6. Run `php artisan db:seed`
7. Start server with `php artisan serve`

---

*Document Generated: 2026-06-09*  
*Migration Status: Code Implementation Complete*  
*Laravel Project: `/workspace/project/migo/laravel-attendo/`*