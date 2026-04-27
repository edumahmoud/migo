// =====================================================
// AttenDo - TypeScript Type Definitions
// =====================================================

export type UserRole = 'student' | 'teacher' | 'admin' | 'superadmin';

export type UserStatus = 'online' | 'away' | 'busy' | 'offline' | 'invisible';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  username?: string;
  role: UserRole;
  teacher_code?: string;
  avatar_url?: string | null;
  title_id?: string | null;
  is_admin?: boolean;
  fcm_token?: string | null;
  gender?: string | null;
  status?: UserStatus;
  created_at: string;
  updated_at: string;
}

export interface TeacherStudentLink {
  id: string;
  teacher_id: string;
  student_id: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface Summary {
  id: string;
  user_id: string;
  title: string;
  original_content: string;
  summary_content: string;
  created_at: string;
}

export interface QuizQuestion {
  type: 'mcq' | 'boolean' | 'completion' | 'matching';
  question: string;
  options?: string[];
  correctAnswer?: string;
  pairs?: { key: string; value: string }[];
}

export interface Quiz {
  id: string;
  user_id: string;
  title: string;
  duration?: number;
  scheduled_date?: string;
  scheduled_time?: string;
  summary_id?: string;
  questions: QuizQuestion[];
  show_results?: boolean;
  allow_retake?: boolean;
  is_finished?: boolean;
  subject_id?: string;
  created_at: string;
}

export interface UserAnswer {
  questionIndex: number;
  type: string;
  answer: string | Record<string, string>;
  isCorrect: boolean;
}

export interface Score {
  id: string;
  student_id: string;
  teacher_id: string;
  quiz_id: string;
  quiz_title: string;
  score: number;
  total: number;
  user_answers: UserAnswer[];
  completed_at: string;
}

// =====================================================
// Subjects & Lectures
// =====================================================

export interface Subject {
  id: string;
  teacher_id: string;
  name: string;
  description?: string;
  color?: string;
  join_code?: string;
  created_at: string;
  updated_at: string;
  // Joined data
  co_teachers?: SubjectTeacher[];
  is_co_teacher?: boolean;
}

export interface SubjectTeacher {
  id: string;
  subject_id: string;
  teacher_id: string;
  role: 'owner' | 'co_teacher';
  added_by: string;
  created_at: string;
  // Joined data
  teacher_name?: string;
  teacher_avatar_url?: string | null;
  teacher_title_id?: string | null;
  teacher_gender?: string | null;
}

export interface SubjectStudent {
  id: string;
  subject_id: string;
  student_id: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface Lecture {
  id: string;
  subject_id: string;
  title: string;
  description?: string;
  lecture_date?: string;
  created_at: string;
  updated_at: string;
}

export interface LectureNote {
  id: string;
  lecture_id: string;
  user_id: string;
  content: string;
  visibility: 'public' | 'private';
  created_at: string;
  updated_at: string;
}

// =====================================================
// Files & Sharing
// =====================================================

export interface UserFile {
  id: string;
  user_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_url: string;
  assignment_id?: string;
  visibility?: 'public' | 'private';
  created_at: string;
  updated_at: string;
}

export interface FileShare {
  id: string;
  file_id: string;
  shared_by: string;
  shared_with: string;
  permission: 'view' | 'edit' | 'download';
  created_at: string;
}

export interface SubjectFile {
  id: string;
  subject_id: string;
  uploaded_by: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_url: string;
  description?: string;
  category?: string;
  visibility?: 'public' | 'private';
  user_file_id?: string | null;
  created_at: string;
}

// =====================================================
// Assignments & Submissions
// =====================================================

export interface Assignment {
  id: string;
  subject_id: string;
  teacher_id: string;
  title: string;
  description?: string;
  due_date?: string;
  max_score: number;
  allow_file_submission: boolean;
  show_grade: boolean;
  created_at: string;
  updated_at: string;
}

export interface Submission {
  id: string;
  assignment_id: string;
  student_id: string;
  content?: string;
  file_id?: string;
  score?: number;
  feedback?: string;
  status: 'submitted' | 'graded' | 'returned';
  submitted_at: string;
  graded_at?: string;
}

// =====================================================
// Attendance
// =====================================================

export interface AttendanceSession {
  id: string;
  lecture_id: string;
  teacher_id: string;
  subject_id: string;
  status: 'active' | 'ended';
  started_at: string;
  ended_at?: string | null;
  teacher_latitude?: number | null;
  teacher_longitude?: number | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRecord {
  id: string;
  session_id: string;
  student_id: string;
  checked_in_at: string;
  student_latitude?: number | null;
  student_longitude?: number | null;
  check_in_method?: 'qr' | 'gps' | 'manual' | null;
  created_at: string;
}

// =====================================================
// Notifications
// =====================================================

export type NotificationType = 'assignment' | 'grade' | 'enrollment' | 'file' | 'file_request' | 'system' | 'attendance' | 'link_request' | 'lecture';

export interface DBNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  link?: string | null;
  created_at: string;
}

// =====================================================
// User Sessions (Security)
// =====================================================

export interface UserSession {
  id: string;
  user_id: string;
  device_fingerprint: string;
  ip_address?: string | null;
  location?: string | null;
  is_active: boolean;
  last_activity: string;
  created_at: string;
}

// =====================================================
// Banned Users
// =====================================================

export interface BannedUser {
  id: string;
  email: string;
  banned_at: string;
  reason?: string;
  user_id?: string | null;
  ban_until?: string | null;
  banned_by?: string | null;
  is_active?: boolean;
  // Joined data (populated in admin dashboard)
  user_name?: string;
  banned_by_name?: string;
}

// =====================================================
// File Requests
// =====================================================

export interface FileRequest {
  id: string;
  file_id: string;
  requester_id: string;
  owner_id: string;
  description?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  updated_at: string;
  // Joined data
  file_name?: string;
  requester_name?: string;
  owner_name?: string;
}

// =====================================================
// Announcements
// =====================================================

export interface Announcement {
  id: string;
  title: string;
  content: string;
  is_active: boolean;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  created_by?: string;
  created_at: string;
  updated_at: string;
}

// App navigation state
export type AppPage = 
  | 'auth' 
  | 'student-dashboard' 
  | 'teacher-dashboard'
  | 'admin-dashboard'
  | 'quiz'
  | 'summary'
  | 'profile';

export type StudentSection = 'dashboard' | 'subjects' | 'summaries' | 'quizzes' | 'files' | 'assignments' | 'attendance' | 'teachers' | 'chat' | 'settings' | 'notifications';
export type TeacherSection = 'dashboard' | 'subjects' | 'students' | 'files' | 'assignments' | 'attendance' | 'analytics' | 'chat' | 'settings' | 'notifications';
export type AdminSection = 'dashboard' | 'users' | 'subjects' | 'reports' | 'announcements' | 'banned' | 'institution' | 'chat' | 'settings';

// API response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface GenerateSummaryResponse {
  summary: string;
}

export interface GenerateQuizResponse {
  questions: QuizQuestion[];
}

export interface EvaluateAnswerResponse {
  isCorrect: boolean;
}

// =====================================================
// Course Page Types
// =====================================================

// Course page tab types
export type CourseTab = 'overview' | 'lectures' | 'notes' | 'files' | 'exams' | 'assignments' | 'chat' | 'students';

// Extended lecture type with attendance info
export interface LectureWithAttendance extends Lecture {
  attendance_session?: AttendanceSession | null;
  attendance_count?: number;
  total_students?: number;
  teacher_name?: string;
  student_checked_in?: boolean;
}

// Attendance record with student profile info
export interface AttendanceRecordWithStudent extends AttendanceRecord {
  student_name?: string;
  student_email?: string;
}

// Lecture note with author info
export interface LectureNoteWithAuthor extends LectureNote {
  author_name?: string;
}

// =====================================================
// Chat Types
// =====================================================

export interface Conversation {
  id: string;
  type: 'group' | 'individual';
  subjectId?: string | null;
  title?: string | null;
  createdAt: string;
  updatedAt: string;
  lastReadAt?: string | null;
  lastMessage?: ChatMessageInfo | null;
  unreadCount: number;
  otherParticipant?: UserProfile | null;
}

export interface ChatMessageInfo {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  is_deleted?: boolean;
  is_edited?: boolean;
  edited_at?: string | null;
  conversationId?: string;
  conversation_id?: string;
  sender?: {
    id: string;
    name: string;
    email: string;
    avatar_url?: string | null;
    title_id?: string | null;
    gender?: string | null;
    role?: string | null;
  } | null;
}

// Student performance data for student profile
export interface StudentPerformance {
  student: UserProfile;
  scores: Score[];
  attendance_records: AttendanceRecord[];
  total_sessions: number;
  attended_sessions: number;
  attendance_percentage: number;
  average_score: number;
  submissions: Submission[];
}
