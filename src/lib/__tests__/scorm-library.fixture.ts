import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { NextRequest } from 'next/server';
let role: string | null = 'teacher'; let filters: string[] = []; let failSubjects = false;
mock.module('@/lib/auth-helpers', () => ({ authenticateRequest: async () => ({ success: true, user: { id: 'teacher' } }), getUserRole: async () => role, authErrorResponse: () => Response.json({}, { status: 401 }) }));
mock.module('@/lib/supabase-server', () => ({ supabaseServer: { from: (table: string) => {
 const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, or: (f: string) => { filters.push(f); return q; }, then: (resolve: any) => resolve({ data: table === 'subjects' ? [{ id: 'owned' }] : table === 'subject_teachers' ? [{ subject_id: 'co' }] : table === 'scorm_package_subjects' ? [{ package_id: 'linked', subject: { id: 'co', name: 'Co' } }] : table === 'users' ? [{ id: 'teacher', name: 'Teacher' }] : [{ id: 'package', uploaded_by: 'teacher', subject_id: 'owned', subject: { id: 'owned', name: 'Primary' } }], error: failSubjects && table === 'subjects' ? { message: 'failed' } : null }) }; return q;
} } }));
const { GET } = await import('../../app/api/scorm/library/route');
beforeEach(() => { role = 'teacher'; filters = []; failSubjects = false; });
describe('SCORM library visibility', () => {
 it('includes shared, own, co-taught, uploaded and linked packages, not unrestricted course rows', async () => {
  const r = await GET(new NextRequest('http://localhost/api/scorm/library')); expect(r.status).toBe(200);
  expect(filters).toEqual(['subject_id.is.null,uploaded_by.eq.teacher,subject_id.in.(owned,co),id.in.(linked)']);
  const data = await r.json(); expect(data.data[0].linked_subject_ids).toContain('owned');
 });
 it('lets admins list all packages', async () => { role = 'admin'; expect((await GET(new NextRequest('http://localhost/api/scorm/library'))).status).toBe(200); expect(filters).toEqual([]); });
 it('rejects students and unknown roles', async () => { for (const r of ['student', 'unknown', null]) { role = r; expect((await GET(new NextRequest('http://localhost/api/scorm/library'))).status).toBe(403); } });
 it('fails closed when teacher scope lookup fails', async () => { failSubjects = true; expect((await GET(new NextRequest('http://localhost/api/scorm/library'))).status).toBe(500); expect(filters).toEqual([]); });
});
