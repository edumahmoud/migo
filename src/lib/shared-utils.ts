// =====================================================
// Shared Utility Functions
// Extracted from duplicate code across dashboard components
// =====================================================

/**
 * Calculate password strength with label and color
 * Duplicated in register-form.tsx and setup-wizard.tsx
 */
export function getPasswordStrength(password: string): {
  score: number;
  label: string;
  color: string;
} {
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: 'ضعيفة', color: 'bg-red-500' };
  if (score <= 2) return { score, label: 'متوسطة', color: 'bg-yellow-500' };
  if (score <= 3) return { score, label: 'جيدة', color: 'bg-blue-500' };
  return { score, label: 'قوية', color: 'bg-emerald-500' };
}

/**
 * Format a date string for display
 * Duplicated across all 3 dashboard components
 */
export function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

/**
 * Calculate score percentage
 * Duplicated across all 3 dashboard components
 */
export function scorePercentage(score: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((score / total) * 100);
}

/**
 * Get color class based on score percentage
 * Duplicated in admin-dashboard.tsx and teacher-dashboard.tsx
 */
export function pctColorClass(pct: number): string {
  if (pct >= 90) return 'text-emerald-700 bg-emerald-100';
  if (pct >= 75) return 'text-teal-700 bg-teal-100';
  if (pct >= 60) return 'text-amber-700 bg-amber-100';
  return 'text-rose-700 bg-rose-100';
}

/**
 * Get auth headers for API requests
 * Duplicated in student-dashboard.tsx and teacher-dashboard.tsx
 * Must be called asynchronously because it reads the Supabase session
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  // Dynamic import to avoid circular dependencies at module load time
  const { supabase } = await import('@/lib/supabase');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || '';
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
}
