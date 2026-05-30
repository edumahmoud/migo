import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Strip the file extension from a file name for DISPLAY purposes only.
 * The full name (with extension) must still be used for downloads, previews, and API calls.
 * Examples:
 *   "ملخص الرياضيات.pdf" → "ملخص الرياضيات"
 *   "report.docx" → "report"
 *   "archive.tar.gz" → "archive.tar" (only strips last extension)
 *   ".gitignore" → ".gitignore" (hidden files are preserved)
 *   "README" → "README" (no extension, unchanged)
 */
export function stripFileExtension(fileName: string): string {
  if (!fileName) return fileName;
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex <= 0) return fileName; // no extension or hidden file (dot at index 0)
  return fileName.substring(0, lastDotIndex);
}
