import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppPage, StudentSection, TeacherSection, AdminSection, CourseTab } from '@/lib/types';

interface AppState {
  // Navigation
  currentPage: AppPage;
  setCurrentPage: (page: AppPage) => void;
  
  // Profile page navigation
  profileUserId: string | null;
  setProfileUserId: (id: string | null) => void;
  openProfile: (userId: string) => void;
  
  // Student navigation
  studentSection: StudentSection;
  setStudentSection: (section: StudentSection) => void;
  
  // Teacher navigation
  teacherSection: TeacherSection;
  setTeacherSection: (section: TeacherSection) => void;
  
  // Admin navigation
  adminSection: AdminSection;
  setAdminSection: (section: AdminSection) => void;
  
  // Quiz/Summary viewing
  viewingQuizId: string | null;
  setViewingQuizId: (id: string | null) => void;
  
  viewingSummaryId: string | null;
  setViewingSummaryId: (id: string | null) => void;
  
  // Course page navigation
  selectedSubjectId: string | null;
  setSelectedSubjectId: (id: string | null) => void;
  
  courseTab: CourseTab;
  setCourseTab: (tab: CourseTab) => void;
  
  selectedStudentId: string | null;
  setSelectedStudentId: (id: string | null) => void;
  
  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  
  // Chat unread count (global, used by sidebar badge)
  chatUnreadCount: number;
  setChatUnreadCount: (count: number) => void;
  
  // Reset
  reset: () => void;
}

const initialState = {
  currentPage: 'auth' as AppPage,
  profileUserId: null as string | null,
  studentSection: 'dashboard' as StudentSection,
  teacherSection: 'dashboard' as TeacherSection,
  adminSection: 'dashboard' as AdminSection,
  viewingQuizId: null as string | null,
  viewingSummaryId: null as string | null,
  selectedSubjectId: null as string | null,
  courseTab: 'overview' as CourseTab,
  selectedStudentId: null as string | null,
  sidebarOpen: false,
  chatUnreadCount: 0,
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...initialState,
      
      setCurrentPage: (page) => set({ currentPage: page }),
      setProfileUserId: (id) => set({ profileUserId: id }),
      openProfile: (userId) => set({ profileUserId: userId, currentPage: 'profile', sidebarOpen: false }),
      setStudentSection: (section) => set({ studentSection: section }),
      setTeacherSection: (section) => set({ teacherSection: section }),
      setAdminSection: (section) => set({ adminSection: section }),
      setViewingQuizId: (id) => set((state) => ({
        viewingQuizId: id,
        currentPage: id ? 'quiz' : (state.currentPage === 'quiz' ? 'student-dashboard' : state.currentPage),
      })),
      setViewingSummaryId: (id) => set((state) => ({
        viewingSummaryId: id,
        currentPage: id ? 'summary' : (state.currentPage === 'summary' ? 'student-dashboard' : state.currentPage),
      })),
      setSelectedSubjectId: (id) => set({ selectedSubjectId: id }),
      setCourseTab: (tab) => set({ courseTab: tab }),
      setSelectedStudentId: (id) => set({ selectedStudentId: id }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setChatUnreadCount: (count) => set({ chatUnreadCount: count }),
      
      reset: () => set(initialState),
    }),
    {
      name: 'attendo-app-store',
      partialize: (state) => ({
        selectedSubjectId: state.selectedSubjectId,
        courseTab: state.courseTab,
      }),
    }
  )
);
