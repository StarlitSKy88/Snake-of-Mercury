/**
 * MiniMax M2.7 执行器
 * 直连 MiniMax Chat API，无需 CCX 代理
 * 
 * API: https://api.minimax.chat/v1/chat/completions (OpenAI 兼容)
 * Model: MiniMax-M2.7
 */

// ============= 类型 =============

export interface MiniMaxConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeout?: number;
  maxTokens?: number;
}

export interface MiniMaxResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// ============= 常量 =============

const DEFAULT_BASE_URL = 'https://api.minimax.chat/v1';
const DEFAULT_MODEL = 'MiniMax-M2.7';
const DEFAULT_TIMEOUT = 300000;
const DEFAULT_MAX_TOKENS = 32000;

// ============= 核心 =============

export async function executeMiniMax(
  systemPrompt: string,
  userMessage: string,
  config: MiniMaxConfig = {}
): Promise<MiniMaxResult> {
  const startTime = Date.now();
  const apiKey = config.apiKey || process.env.MINIMAX_API_KEY;
  const model = config.model || process.env.MINIMAX_MODEL || DEFAULT_MODEL;
  const baseUrl = config.baseUrl || process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
  const timeout = config.timeout || DEFAULT_TIMEOUT;
  const maxTokens = config.maxTokens || DEFAULT_MAX_TOKENS;

  if (!apiKey) {
    return {
      success: false, output: '', model,
      error: 'MINIMAX_API_KEY not set', duration: Date.now() - startTime,
    };
  }

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userMessage },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return {
        success: false, output: '', model,
        error: `MiniMax HTTP ${response.status}: ${errText.slice(0, 200)}`,
        duration: Date.now() - startTime,
      };
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const content = data.choices?.[0]?.message?.content || '';
    
    // 清理 think 标签 (MiniMax 可能输出思考过程)
    const cleaned = content.replace(/<think>[\s\S]*?<\/think>\n*/g, '').trim();

    return {
      success: true,
      output: cleaned || content,
      model: data.choices?.[0] ? model : model,
      duration: Date.now() - startTime,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false, output: '', model,
      error: msg.includes('abort') ? `MiniMax timeout after ${timeout}ms` : msg,
      duration: Date.now() - startTime,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带重试的执行
 */
export async function robustMiniMaxCall(
  systemPrompt: string,
  userMessage: string,
  config: MiniMaxConfig = {},
  maxRetries: number = 3
): Promise<MiniMaxResult> {
  let lastResult: MiniMaxResult | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await executeMiniMax(systemPrompt, userMessage, config);

    if (result.success && result.output.length > 50) {
      return result;
    }

    if (result.output.length < 50 && attempt < maxRetries) {
      console.log(`[MiniMax] 输出过短 (${result.output.length}字符)，重试 ${attempt}/${maxRetries}...`);
      await sleep(Math.min(2000 * Math.pow(2, attempt - 1), 30000));
      continue;
    }

    if (!result.success && attempt < maxRetries) {
      console.log(`[MiniMax] 失败: ${result.error}，重试 ${attempt}/${maxRetries}...`);
      await sleep(Math.min(2000 * Math.pow(2, attempt - 1), 30000));
      continue;
    }

    lastResult = result;
    return result;
  }

  return lastResult!;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
