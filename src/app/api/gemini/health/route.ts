import { NextResponse } from 'next/server';

// Quick health check — must complete fast
export const maxDuration = 15;
export const runtime = 'nodejs';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * GET /api/gemini/health
 *
 * Quick health check for the Gemini API connection.
 * Sends a tiny prompt to verify the API key works and the model is available.
 * Returns immediately (under 10s) with diagnostic information.
 */
export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  const configuredModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  // Check if API key is configured
  if (!apiKey) {
    return NextResponse.json({
      status: 'error',
      configured: false,
      error: 'GEMINI_API_KEY is not set',
      model: configuredModel,
    }, { status: 503 });
  }

  // Try a minimal API call to verify the key works
  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // Try the configured model first, then fall back to gemini-1.5-flash
    const modelsToTry = [configuredModel, 'gemini-1.5-flash'];
    let lastError: string | null = null;
    let workingModel: string | null = null;

    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            maxOutputTokens: 10,
            temperature: 0,
          },
        });

        // 10-second timeout for health check
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
        console.warn('[Health] Model', modelName, 'failed:', msg);
        continue; // Try next model
      }
    }

    if (workingModel) {
      return NextResponse.json({
        status: 'ok',
        configured: true,
        model: workingModel,
        configuredModel,
        note: workingModel !== configuredModel
          ? `Configured model "${configuredModel}" failed, using fallback "${workingModel}"`
          : undefined,
      });
    }

    // All models failed
    return NextResponse.json({
      status: 'error',
      configured: true,
      model: configuredModel,
      error: lastError || 'All models failed',
      hint: 'Check if your API key is valid and has access to the Gemini API',
    }, { status: 503 });

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      status: 'error',
      configured: true,
      model: configuredModel,
      error: errMsg,
    }, { status: 503 });
  }
}
