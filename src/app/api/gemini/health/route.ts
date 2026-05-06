import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

// Quick health check — must complete fast
export const maxDuration = 15;
export const runtime = 'nodejs';

/**
 * GET /api/gemini/health
 *
 * Quick health check for the AI service (Groq).
 * Tests Groq and reports its status.
 * Returns immediately (under 10s) with diagnostic information.
 */
export async function GET() {
  const groqApiKey = process.env.GROQ_API_KEY;
  const groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  const providers: Record<string, { status: string; configured: boolean; model?: string; error?: string }> = {};

  // ─── Check Groq ───
  if (!groqApiKey) {
    providers.groq = { status: 'not_configured', configured: false, error: 'GROQ_API_KEY is not set' };
  } else {
    try {
      const groq = new Groq({ apiKey: groqApiKey });
      const result = await groq.chat.completions.create({
        model: groqModel,
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 5,
        temperature: 0,
      });

      const text = result.choices[0]?.message?.content || '';
      if (text.trim().length > 0) {
        providers.groq = { status: 'ok', configured: true, model: groqModel };
      } else {
        providers.groq = { status: 'error', configured: true, model: groqModel, error: 'Empty response' };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      providers.groq = { status: 'error', configured: true, model: groqModel, error: msg };
    }
  }

  // Overall status
  const groqOk = providers.groq.status === 'ok';

  return NextResponse.json({
    status: groqOk ? 'ok' : 'error',
    provider: 'groq',
    providers,
    summary: groqOk
      ? 'Groq is healthy'
      : 'Groq is unavailable — AI service is down',
  }, { status: groqOk ? 200 : 503 });
}
