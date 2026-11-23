import { describe, it, expect } from 'bun:test';
import { attachmentDisposition } from '../download-headers';
describe('download disposition', () => {
 it('supports Arabic and ASCII filenames in real HTTP Headers', () => {
   for (const name of ['كيمياء: اولى ثانوى_scorm_1.2.zip', 'Course_scorm_2004.zip', 'emoji🎓.zip']) {
     const value = attachmentDisposition(name);
     expect(() => new Headers({ 'Content-Disposition': value })).not.toThrow();
     expect(decodeURIComponent(value.split("filename*=UTF-8''")[1])).toBe(name);
   }
 });
 it('strips control characters and prevents quote injection', () => {
   const value = attachmentDisposition('bad"\r\nX-Test: hi.zip');
   expect(value).not.toContain('\r'); expect(value).not.toContain('\n');
   expect(value).toContain('filename="bad___X-Test__hi.zip"');
 });
});
