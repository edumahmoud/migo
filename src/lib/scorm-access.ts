// =====================================================
// SCORM authorization (server only)
// One place that decides who may view, play or manage a SCORM package.
// =====================================================

import { supabaseServer } from '@/lib/supabase-server';

export interface ScormPackageRef {
  id: string;
  subject_id: string | null;
  uploaded_by: string;
  status: string;
}

export interface ScormAccess {
  /** May see the package and its resources */
  canView: boolean;
  /** May edit, archive, delete the package and read all students' tracking */
  canManage: boolean;
  isStudent: boolean;
}

const NO_ACCESS: ScormAccess = { canView: false, canManage: false, isStudent: false };

export async function isSubjectTeacher(userId: string, subjectId: string): Promise<boolean> {
  const { data: subject } = await supabaseServer
    .from('subjects')
    .select('teacher_id')
    .eq('id', subjectId)
    .maybeSingle();
  if (subject?.teacher_id === userId) return true;
  const { data: co } = await supabaseServer
    .from('subject_teachers')
    .select('id')
    .eq('subject_id', subjectId)
    .eq('teacher_id', userId)
    .maybeSingle();
  return !!co;
}

export async function isEnrolled(userId: string, subjectId: string): Promise<boolean> {
  const { data } = await supabaseServer
    .from('subject_students')
    .select('id')
    .eq('subject_id', subjectId)
    .eq('student_id', userId)
    .maybeSingle();
  return !!data;
}

async function linkedSubjectIds(packageId: string): Promise<string[]> {
  const { data } = await supabaseServer
    .from('scorm_package_subjects')
    .select('subject_id')
    .eq('package_id', packageId);
  return (data || []).map((r: { subject_id: string }) => r.subject_id);
}

export async function resolveScormAccess(
  userId: string,
  role: string | null,
  pkg: ScormPackageRef,
): Promise<ScormAccess> {
  if (role === 'admin' || role === 'superadmin') {
    return { canView: true, canManage: true, isStudent: false };
  }

  if (role === 'teacher') {
    if (pkg.subject_id) {
      if (pkg.uploaded_by === userId || (await isSubjectTeacher(userId, pkg.subject_id))) {
        return { canView: true, canManage: true, isStudent: false };
      }
    } else {
      // Platform library package: any teacher can view and use it, only admins manage it
      return { canView: true, canManage: false, isStudent: false };
    }
    for (const sid of await linkedSubjectIds(pkg.id)) {
      if (await isSubjectTeacher(userId, sid)) return { canView: true, canManage: false, isStudent: false };
    }
    return NO_ACCESS;
  }

  if (role === 'student') {
    if (pkg.status !== 'active') return NO_ACCESS;
    if (pkg.subject_id && (await isEnrolled(userId, pkg.subject_id))) {
      return { canView: true, canManage: false, isStudent: true };
    }
    for (const sid of await linkedSubjectIds(pkg.id)) {
      if (await isEnrolled(userId, sid)) return { canView: true, canManage: false, isStudent: true };
    }
    return NO_ACCESS;
  }

  return NO_ACCESS;
}

/** Load a package row and resolve access in one call. */
export async function loadPackageWithAccess(
  packageId: string,
  userId: string,
  role: string | null,
  columns: string = 'id, subject_id, uploaded_by, status',
): Promise<{ pkg: (ScormPackageRef & Record<string, unknown>) | null; access: ScormAccess }> {
  const { data } = await supabaseServer
    .from('scorm_packages')
    .select(columns)
    .eq('id', packageId)
    .maybeSingle();
  const pkg = data as unknown as (ScormPackageRef & Record<string, unknown>) | null;
  if (!pkg) return { pkg: null, access: NO_ACCESS };
  return { pkg, access: await resolveScormAccess(userId, role, pkg) };
}

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Student ids a (non-owner) teacher may see tracking for: students enrolled in subjects they teach. */
export async function studentIdsOfTeacher(teacherId: string): Promise<string[]> {
  const { data: owned } = await supabaseServer.from('subjects').select('id').eq('teacher_id', teacherId);
  const { data: co } = await supabaseServer.from('subject_teachers').select('subject_id').eq('teacher_id', teacherId);
  const subjectIds = [
    ...(owned || []).map((s: { id: string }) => s.id),
    ...(co || []).map((s: { subject_id: string }) => s.subject_id),
  ];
  if (subjectIds.length === 0) return [];
  const { data: rows } = await supabaseServer.from('subject_students').select('student_id').in('subject_id', subjectIds);
  return [...new Set((rows || []).map((r: { student_id: string }) => r.student_id))];
}
