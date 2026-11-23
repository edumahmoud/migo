/** RFC 6266/8187: HTTP headers are ByteStrings, never raw Unicode. */
export function attachmentDisposition(filename: string): string {
  const safe = filename.replace(/[\r\n\u0000-\u001f\u007f]/g, '_');
  const fallback = safe.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'download.zip';
  const encoded = encodeURIComponent(safe.toWellFormed()).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
