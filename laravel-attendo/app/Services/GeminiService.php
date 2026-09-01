<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class GeminiService
{
    private array $apiKeys = [];
    private int $currentKeyIndex = 0;
    private array $keyHealth = [];
    private const HEALTH_DECAY_ON_FAILURE = 30;
    private const HEALTH_RECOVERY_ON_SUCCESS = 10;
    private const KEY_COOLDOWN_MS = 120000;
    private const KEY_INVALID_COOLDOWN_MS = 600000;
    private const MAX_CONSECUTIVE_FAILURES = 5;
    private const AI_CALL_TIMEOUT_MS = 60000;
    private const MAX_CONTENT_LENGTH = 100000;
    private const PRIMARY_MODEL = 'gemini-2.0-flash';
    private const HEAVY_MODEL = 'gemini-2.0-pro';

    public function __construct()
    {
        $this->loadApiKeys();
    }

    private function loadApiKeys(): void
    {
        for ($i = 1; $i <= 9; $i++) {
            $key = env("GOOGLE_API_KEY_{$i}");
            if ($key && strlen($key) > 0) {
                $this->apiKeys[] = [
                    'key' => $key,
                    'index' => count($this->apiKeys),
                    'health' => 100,
                    'cooldown_until' => 0,
                    'consecutive_failures' => 0,
                    'total_requests' => 0,
                    'total_failures' => 0,
                    'last_used_at' => 0,
                    'last_failed_at' => 0,
                ];
            }
        }

        if (empty($this->apiKeys)) {
            Log::warning('[Gemini] No GOOGLE_API_KEY_* environment variables set');
        } else {
            Log::info('[Gemini] Key pool initialized: ' . count($this->apiKeys) . ' key(s) available');
        }
    }

    private function getNextHealthyKey(): ?array
    {
        if (empty($this->apiKeys)) {
            return null;
        }

        $now = now()->timestamp * 1000;
        $startIndex = $this->currentKeyIndex;

        for ($i = 0; $i < count($this->apiKeys); $i++) {
            $idx = ($startIndex + $i) % count($this->apiKeys);
            $keyState = &$this->apiKeys[$idx];

            if ($keyState['cooldown_until'] > $now) {
                continue;
            }

            if ($keyState['health'] <= 0) {
                continue;
            }

            $this->currentKeyIndex = ($idx + 1) % count($this->apiKeys);
            $keyState['last_used_at'] = $now;
            $keyState['total_requests']++;
            return $keyState;
        }

        foreach ($this->apiKeys as &$keyState) {
            if ($keyState['cooldown_until'] <= $now && $keyState['health'] > 0) {
                $this->currentKeyIndex = ($keyState['index'] + 1) % count($this->apiKeys);
                $keyState['last_used_at'] = $now;
                $keyState['total_requests']++;
                return $keyState;
            }
        }

        return null;
    }

    private function markKeyFailed(array &$keyState, string $errorCode): void
    {
        $keyState['consecutive_failures']++;
        $keyState['total_failures']++;
        $keyState['last_failed_at'] = now()->timestamp * 1000;
        $keyState['health'] = max(0, $keyState['health'] - self::HEALTH_DECAY_ON_FAILURE);

        $now = now()->timestamp * 1000;

        if ($errorCode === 'AUTH_ERROR') {
            $keyState['cooldown_until'] = $now + self::KEY_INVALID_COOLDOWN_MS;
            $keyState['health'] = 0;
        } elseif ($errorCode === 'RATE_LIMIT') {
            $keyState['cooldown_until'] = $now + self::KEY_COOLDOWN_MS;
        } else {
            $keyState['cooldown_until'] = $now + (self::KEY_COOLDOWN_MS / 2);
        }

        if ($keyState['consecutive_failures'] >= self::MAX_CONSECUTIVE_FAILURES) {
            $keyState['health'] = 0;
            $keyState['cooldown_until'] = $now + self::KEY_INVALID_COOLDOWN_MS;
        }
    }

    private function markKeySuccess(array &$keyState): void
    {
        $keyState['consecutive_failures'] = 0;
        $keyState['health'] = min(100, $keyState['health'] + self::HEALTH_RECOVERY_ON_SUCCESS);
        $keyState['cooldown_until'] = 0;
    }

    private function truncateContent(string $content, int $maxLength = self::MAX_CONTENT_LENGTH): string
    {
        if (strlen($content) <= $maxLength) {
            return $content;
        }

        $truncated = substr($content, 0, $maxLength);
        $lastParagraph = strrpos($truncated, "\n\n");

        if ($lastParagraph > $maxLength * 0.7) {
            return substr($truncated, 0, $lastParagraph) . "\n\n[... تم تقليص المحتوى ...]";
        }

        $lastSentence = max(
            strrpos($truncated, '.'),
            strrpos($truncated, '。'),
            strrpos($truncated, '؟'),
            strrpos($truncated, '?')
        );

        if ($lastSentence > $maxLength * 0.7) {
            return substr($truncated, 0, $lastSentence + 1) . "\n\n[... تم تقليص المحتوى ...]";
        }

        return $truncated . "\n\n[... تم تقليص المحتوى ...]";
    }

    private function classifyError(\Throwable $error): string
    {
        $message = strtolower($error->getMessage());

        if (str_contains($message, '429') || str_contains($message, 'rate') || 
            str_contains($message, 'quota') || str_contains($message, 'resource_exhausted')) {
            return 'RATE_LIMIT';
        }

        if (str_contains($message, '403') || str_contains($message, 'api key') || 
            str_contains($message, 'invalid') || str_contains($message, 'auth')) {
            return 'AUTH_ERROR';
        }

        if (str_contains($message, 'timeout') || str_contains($message, 'timed out')) {
            return 'TIMEOUT';
        }

        if (str_contains($message, '500') || str_contains($message, 'internal')) {
            return 'SERVER_ERROR';
        }

        return 'UNKNOWN';
    }

    public function generateSummary(string $content, ?string $context = null): string
    {
        if (empty($this->apiKeys)) {
            throw new \Exception('خدمة الذكاء الاصطناعي غير مفعلة حالياً');
        }

        $systemPrompt = "أنت مساعد ذكي متخصص في تلخيص النصوص التعليمية. مهمتك هي إنشاء ملخص واضح ومفصل للنص المقدم.";

        if ($context) {
            $systemPrompt .= "\n\nسياق إضافي: {$context}";
        }

        $userPrompt = "يرجى تلخيص النص التالي بشكل واضح ومفصل مع الحفاظ على النقاط الرئيسية:\n\n" . $this->truncateContent($content);

        return $this->makeRequest($systemPrompt, $userPrompt, ['temperature' => 0.4, 'maxTokens' => 8192]);
    }

    public function refineTranscribedText(string $text): string
    {
        if (empty($this->apiKeys)) {
            throw new \Exception('خدمة الذكاء الاصطناعي غير مفعلة حالياً');
        }

        $systemPrompt = "أنت مساعد ذكي متخصص في تحسين النصوص المكتوبة. مهمتك هي تصحيح الأخطاء وتحسين وضوح النص مع الحفاظ على المعنى الأصلي.";

        $userPrompt = "يرجى تحسين النص التالي وتصحيح الأخطاء:\n\n" . $text;

        return $this->makeRequest($systemPrompt, $userPrompt, ['temperature' => 0.3, 'maxTokens' => 8192]);
    }

    public function generateQuiz(string $topic, int $questionCount = 5, ?string $difficulty = null): array
    {
        if (empty($this->apiKeys)) {
            throw new \Exception('خدمة الذكاء الاصطناعي غير مفعلة حالياً');
        }

        $difficultyText = $difficulty ? "مستوى الصعوبة: {$difficulty}" : "مستويات متنوعة";

        $systemPrompt = "أنت مساعد ذكي متخصص في إنشاء الأسئلة التعليمية. مهمتك هي إنشاء أسئلة متنوعة من نوع الاختيار من متعدد (MCQ).";

        $userPrompt = "يرجى إنشاء {$questionCount} سؤال من نوع الاختيار من متعدد حول: {$topic}\n";
        $userPrompt .= "{$difficultyText}\n\n";
        $userPrompt .= "أجب بصيغة JSON فقط بهذا الشكل:\n";
        $userPrompt .= '{
    "questions": [
        {
            "type": "mcq",
            "question": "نص السؤال",
            "options": ["الخيار أ", "الخيار ب", "الخيار ج", "الخيار د"],
            "correctAnswer": "الخيار أ"
        }
    ]
}';

        $response = $this->makeRequest($systemPrompt, $userPrompt, [
            'temperature' => 0.6,
            'maxTokens' => 8192,
            'jsonMode' => true,
        ]);

        $data = json_decode($response, true);
        
        if (isset($data['questions']) && is_array($data['questions'])) {
            return $data['questions'];
        }

        return [];
    }

    public function evaluateAnswer(string $question, string $correctAnswer, string $userAnswer): bool
    {
        if (empty($this->apiKeys)) {
            throw new \Exception('خدمة الذكاء الاصطناعي غير مفعلة حالياً');
        }

        $systemPrompt = "أنت مساعد ذكي متخصص في تقييم الإجابات. مهمتك هي تحديد ما إذا كانت إجابة الطالب صحيحة أم لا.";

        $userPrompt = "هل إجابة الطالب التالية صحيحة؟\n\n";
        $userPrompt .= "السؤال: {$question}\n";
        $userPrompt .= "الإجابة الصحيحة: {$correctAnswer}\n";
        $userPrompt .= "إجابة الطالب: {$userAnswer}\n\n";
        $userPrompt .= "أجب بـ 'true' إذا كانت صحيحة أو 'false' إذا كانت خاطئة.";

        $response = $this->makeRequest($systemPrompt, $userPrompt, ['temperature' => 0.2, 'maxTokens' => 50]);

        return strtolower(trim($response)) === 'true';
    }

    public function explainWrongAnswer(string $question, string $correctAnswer, string $userAnswer): string
    {
        if (empty($this->apiKeys)) {
            throw new \Exception('خدمة الذكاء الاصطناعي غير مفعلة حالياً');
        }

        $systemPrompt = "أنت مساعد ذكي متخصص في التعليم. مهمتك هي شرح سبب خطأ الإجابة و提供正确的答案解释.";

        $userPrompt = "يرجى توضيح سبب خطأ الإجابة التالية:\n\n";
        $userPrompt .= "السؤال: {$question}\n";
        $userPrompt .= "الإجابة الصحيحة: {$correctAnswer}\n";
        $userPrompt .= "إجابة الطالب: {$userAnswer}\n\n";
        $userPrompt .= "اشرح بلطف وتوضيح ما هو الخطأ في إجابة الطالب.";

        return $this->makeRequest($systemPrompt, $userPrompt, ['temperature' => 0.5, 'maxTokens' => 4096]);
    }

    public function chat(string $systemPrompt, string $userMessage, array $options = []): string
    {
        if (empty($this->apiKeys)) {
            throw new \Exception('خدمة الذكاء الاصطناعي غير مفعلة حالياً');
        }

        return $this->makeRequest($systemPrompt, $userMessage, $options);
    }

    private function makeRequest(string $systemPrompt, string $userPrompt, array $options = []): string
    {
        $maxAttempts = 3;
        $lastError = null;

        for ($attempt = 0; $attempt < $maxAttempts; $attempt++) {
            $keyState = $this->getNextHealthyKey();

            if (!$keyState) {
                throw new \Exception('تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة لاحقاً');
            }

            try {
                $model = $options['useHeavyModel'] ?? false ? self::HEAVY_MODEL : self::PRIMARY_MODEL;
                $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key={$keyState['key']}";

                $generationConfig = [
                    'temperature' => $options['temperature'] ?? 0.4,
                    'maxOutputTokens' => $options['maxTokens'] ?? 8192,
                ];

                if ($options['jsonMode'] ?? false) {
                    $generationConfig['responseMimeType'] = 'application/json';
                }

                $payload = [
                    'contents' => [
                        [
                            'parts' => [
                                ['text' => $systemPrompt],
                                ['text' => $userPrompt],
                            ],
                        ],
                    ],
                    'generationConfig' => $generationConfig,
                ];

                $response = Http::timeout(60)
                    ->withHeaders(['Content-Type' => 'application/json'])
                    ->post($url, $payload);

                if (!$response->successful()) {
                    $errorCode = $this->classifyError(new \Exception($response->body()));
                    $this->markKeyFailed($keyState, $errorCode);
                    $lastError = new \Exception('HTTP ' . $response->status() . ': ' . $response->body());
                    continue;
                }

                $data = $response->json();
                $text = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';

                if (empty(trim($text))) {
                    throw new \Exception('لم يتمكن الذكاء الاصطناعي من إنشاء رد');
                }

                $this->markKeySuccess($keyState);
                return $text;

            } catch (\Throwable $e) {
                $errorCode = $this->classifyError($e);
                $this->markKeyFailed($keyState, $errorCode);
                $lastError = $e;
                
                if ($errorCode === 'AUTH_ERROR') {
                    throw $e;
                }
                
                continue;
            }
        }

        throw $lastError ?? new \Exception('فشل الاتصال بالذكاء الاصطناعي بعد عدة محاولات');
    }

    public function checkHealth(): array
    {
        $activeKeys = 0;
        $totalKeys = count($this->apiKeys);

        foreach ($this->apiKeys as $key) {
            if ($key['health'] > 0 && $key['cooldown_until'] <= now()->timestamp * 1000) {
                $activeKeys++;
            }
        }

        if ($totalKeys === 0) {
            return [
                'status' => 'not_configured',
                'provider' => 'gemini',
                'error' => 'No GOOGLE_API_KEY_* environment variables set',
                'activeKeys' => 0,
                'totalKeys' => 0,
            ];
        }

        if ($activeKeys === 0) {
            return [
                'status' => 'degraded',
                'provider' => 'gemini',
                'model' => self::PRIMARY_MODEL,
                'error' => 'All keys in cooldown',
                'activeKeys' => 0,
                'totalKeys' => $totalKeys,
            ];
        }

        return [
            'status' => 'ok',
            'provider' => 'gemini',
            'model' => self::PRIMARY_MODEL,
            'activeKeys' => $activeKeys,
            'totalKeys' => $totalKeys,
        ];
    }

    public function getStats(): array
    {
        $totalRequests = 0;
        $totalFailures = 0;

        foreach ($this->apiKeys as $key) {
            $totalRequests += $key['total_requests'];
            $totalFailures += $key['total_failures'];
        }

        return [
            'total_keys' => count($this->apiKeys),
            'total_requests' => $totalRequests,
            'total_failures' => $totalFailures,
            'failure_rate' => $totalRequests > 0 ? round(($totalFailures / $totalRequests) * 100, 2) : 0,
        ];
    }
}