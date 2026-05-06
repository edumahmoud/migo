import { NextResponse } from 'next/server';

// Quick health check — must complete fast
export const maxDuration = 15;
export const runtime = 'nodejs';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * GET /api/gemini/health
 *
 * Quick health check for the AI service (Groq + Gemini).
 * Tests both providers and reports their status.
 * Returns immediately (under 10s) with diagnostic information.
 */
export async function GET() {
  const groqApiKey = process.env.GROQ_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const groqModel = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile';
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  const providers: Record<string, { status: string; configured: boolean; model?: string; error?: string }> = {};

  // ─── Check Groq (Primary) ───
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

  // ─── Check Gemini (Fallback) ───
  if (!geminiApiKey) {
    providers.gemini = { status: 'not_configured', configured: false, error: 'GEMINI_API_KEY is not set' };
  } else {
    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const modelsToTry = [geminiModel, 'gemini-1.5-flash'];
      let lastError: string | null = null;
      let workingModel: string | null = null;

      for (const modelName of modelsToTry) {
        try {
          const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { maxOutputTokens: 10, temperature: 0 },
          });

          const resultPromise = model.generateContent('Say OK');
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), 10000)
          );

          const result = await Promise.race([resultPromise, timeoutPromise]);
          const text = result.response.text();

          if (text && text.trim().length > 0) {
            workingModel = modelName;
            break;
          }
        } catch (modelErr) {
          const msg = modelErr instanceof Error ? modelErr.message : String(modelErr);
          lastError = msg;
          continue;
        }
      }

      if (workingModel) {
        providers.gemini = { status: 'ok', configured: true, model: workingModel };
      } else {
        providers.gemini = { status: 'error', configured: true, model: geminiModel, error: lastError || 'All models failed' };
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      providers.gemini = { status: 'error', configured: true, model: geminiModel, error: errMsg };
    }
  }

  // Overall status
  const groqOk = providers.groq.status === 'ok';
  const geminiOk = providers.gemini.status === 'ok';
  const anyOk = groqOk || geminiOk;

  return NextResponse.json({
    status: anyOk ? 'ok' : 'error',
    primary: 'groq',
    fallback: 'gemini',
    providers,
    summary: groqOk && geminiOk
      ? 'Both providers healthy'
      : groqOk
        ? 'Groq OK, Gemini unavailable (fallback disabled)'
        : geminiOk
          ? 'Groq unavailable, using Gemini fallback'
          : 'No AI providers available',
  }, { status: anyOk ? 200 : 503 });
}
