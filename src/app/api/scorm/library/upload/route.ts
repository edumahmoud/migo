import { NextRequest } from 'next/server';
import { handleScormUpload } from '@/lib/scorm-upload-route';
export const maxDuration = 120;
export const runtime = 'nodejs';
export async function POST(request: NextRequest) { return handleScormUpload(request, true); }
