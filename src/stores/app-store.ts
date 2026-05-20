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
  
  // Previous student section (saved before viewing a summary, restored on back)
  previousStudentSection: StudentSection | null;
  clearPreviousStudentSection: () => void;
  
  // Course page navigation
  selectedSubjectId: string | null;
  setSelectedSubjectId: (id: string | null) => void;
  
  courseTab: CourseTab;
  setCourseTab: (tab: CourseTab) => void;
  
  selectedStudentId: string | null;
  setSelectedStudentId: (id: string | null) => void;
  
  // Video player — persisted so refresh doesn't lose the open video
  selectedVideoId: string | null;
  setSelectedVideoId: (id: string | null) => void;

  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  
  // Chat unread count (global, used by sidebar badge)
  chatUnreadCount: number;
  setChatUnreadCount: (count: number) => void;
  
  // Reports unread count (global, used by sidebar badge)
  reportsUnreadCount: number;
  setReportsUnreadCount: (count: number) => void;
  
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
  previousStudentSection: null as StudentSection | null,
  selectedSubjectId: null as string | null,
  courseTab: 'overview' as CourseTab,
  selectedStudentId: null as string | null,
  selectedVideoId: null as string | null,
  sidebarOpen: false,
  chatUnreadCount: 0,
  reportsUnreadCount: 0,
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
      setViewingSummaryId: (id) => set((state) => {
        if (id) {
          // Navigating TO a summary: save current student section so we can restore it on back
          // Also set studentSection to 'summaries' so the sidebar & header show the correct active section
          return {
            viewingSummaryId: id,
            previousStudentSection: state.studentSection,
            studentSection: 'summaries' as StudentSection,
            // Don't change currentPage — the student dashboard handles summary rendering internally
            // so the sidebar and header stay visible on mobile
          };
        } else {
          // Navigating AWAY from summary: restore the previous student section
          const restoredSection = state.previousStudentSection || 'summaries';
          return {
            viewingSummaryId: null,
            previousStudentSection: null,
            studentSection: restoredSection,
            // If currentPage was 'summary' (e.g. from persisted state), redirect back to dashboard
            currentPage: state.currentPage === 'summary' ? 'student-dashboard' : state.currentPage,
          };
        }
      }),
      clearPreviousStudentSection: () => set({ previousStudentSection: null }),
      setSelectedSubjectId: (id) => set({ selectedSubjectId: id }),
      setCourseTab: (tab) => set({ courseTab: tab }),
      setSelectedStudentId: (id) => set({ selectedStudentId: id }),
      setSelectedVideoId: (id) => set({ selectedVideoId: id }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setChatUnreadCount: (count) => set({ chatUnreadCount: count }),
      setReportsUnreadCount: (count) => set({ reportsUnreadCount: count }),
      
      reset: () => set(initialState),
    }),
    {
      name: 'attendo-app-store',
      partialize: (state) => ({
        studentSection: state.studentSection,
        teacherSection: state.teacherSection,
        adminSection: state.adminSection,
        currentPage: state.currentPage,
        selectedSubjectId: state.selectedSubjectId,
        courseTab: state.courseTab,
        selectedVideoId: state.selectedVideoId,
        // Critical: persist viewingSummaryId so summaries survive page refresh
        // Without this, refreshing while viewing a summary loses the ID and the user
        // lands on an orphaned 'summary' currentPage with no summary to show.
        viewingSummaryId: state.viewingSummaryId,
        viewingQuizId: state.viewingQuizId,
        // Persist previousStudentSection so back navigation works after refresh
        previousStudentSection: state.previousStudentSection,
      }),
    }
  )
);
