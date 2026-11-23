import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { existsSync } from 'node:fs';
let role = 'teacher'; let owns = true; let calls = 0; let storeInput: any; let removed: string[] = [];
mock.module('@/lib/auth-helpers', () => ({
  requireTeacher: async () => role === 'student' ? { success: false, status: 403, error: 'teacher only' } : { success: true, user: { id: 'teacher-id' } },
  requireAdmin: async () => role !== 'admin' ? { success: false, status: 403, error: 'admin only' } : { success: true, user: { id: 'admin-id' } },
  authErrorResponse: (a: any) => Response.json({ success: false, error: a.error }, { status: a.status }),
  getUserRole: async () => role,
}));
mock.module('@/lib/scorm-access', () => ({ UUID_REGEX: /^[a-f0-9-]{36}$/i, isSubjectTeacher: async () => owns }));
mock.module('@/lib/scorm-ingest', () => ({
  ScormIngestError: class extends Error { constructor(message: string, public status = 400) { super(message); } },
  inspectScormZip: async (b: Buffer) => { const z = await JSZip.loadAsync(b); if (!z.file('imsmanifest.xml')) throw new Error('bad zip'); return { parsed: { title: 'Golf' } }; },
  storeScormPackage: async (input: any) => { storeInput = input; calls++; return { pkg: { id: 'pkg' }, resources: [], warnings: [] }; },
  createUploadTicket: async () => ({ path: 'uploads/teacher-id/test.zip', token: 'ticket' }),
  isOwnUploadKey: (key: string, id: string) => key?.startsWith(`uploads/${id}/`),
  downloadUpload: async () => { const z = new JSZip(); z.file('imsmanifest.xml','manifest'); return z.generateAsync({ type: 'nodebuffer' }); }, removeUpload: async (key: string) => { removed.push(key); },
}));
const { handleScormUpload } = await import('../scorm-upload-route');
const sid = '00000000-0000-0000-0000-000000000001';
function request(fields: object) { return new NextRequest('http://localhost/api/scorm/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) }); }
beforeEach(() => { role = 'teacher'; owns = true; calls = 0; storeInput = undefined; removed = []; });
describe('SCORM upload routes', () => {
 it('both route entry points are present', () => { expect(existsSync('src/app/api/scorm/upload/route.ts')).toBe(true); expect(existsSync('src/app/api/scorm/library/upload/route.ts')).toBe(true); });
 it('rejects students', async () => { role = 'student'; expect((await handleScormUpload(request({}), false)).status).toBe(403); });
 it('rejects teachers in admin library', async () => { expect((await handleScormUpload(request({}), true)).status).toBe(403); });
 it('rejects invalid subject IDs', async () => { expect((await handleScormUpload(request({ subjectId: 'wrong' }), false)).status).toBe(400); });
 it('rejects cross-course uploads before issuing a ticket', async () => { owns = false; expect((await handleScormUpload(request({ subjectId: sid, action: 'init', size: 40, filename: 'test.zip' }), false)).status).toBe(403); });
 it('returns a signed ticket for the course owner', async () => { expect((await (await handleScormUpload(request({ subjectId: sid, action: 'init', size: 40, filename: 'test.zip' }), false)).json()).success).toBe(true); });
 it('rejects another user upload key', async () => { expect((await handleScormUpload(request({ subjectId: sid, action: 'complete', path: 'uploads/other/x.zip' }), false)).status).toBe(400); });
 it('never adopts a staging key as a committed package key', async () => { const r = await handleScormUpload(request({ subjectId: sid, action: 'complete', path: 'uploads/teacher-id/test.zip' }), false); expect(r.status).toBe(200); expect(storeInput.existingKey).toBeUndefined(); expect(removed).toEqual(['uploads/teacher-id/test.zip']); });
 it('bounds multipart bytes before parsing or storage', async () => { const r = await handleScormUpload(new NextRequest('http://localhost/api/scorm/upload', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test' }, body: new Uint8Array(4 * 1024 * 1024 + 1) }), false); expect(r.status).toBe(413); expect(calls).toBe(0); });
 it('accepts multipart ZIP uploads', async () => { const z = new JSZip(); z.file('imsmanifest.xml','manifest'); const f = new FormData(); f.set('subjectId',sid); f.set('file',new File([await z.generateAsync({type:'uint8array'})],'course.zip')); const r = await handleScormUpload(new NextRequest('http://localhost/api/scorm/upload',{method:'POST',body:f}),false); expect(r.status).toBe(200); expect(calls).toBe(1); });
});
