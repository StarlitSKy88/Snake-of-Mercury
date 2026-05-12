/**
 * Ollama + 通用模型执行器
 * 
 * 支持:
 * - Ollama 本地模型 (http://localhost:11434)
 * - 任何 OpenAI 兼容端点 (DeepSeek/Grok/Gemini/...)
 * - 自动模型发现
 */

// ============= 类型 =============

export interface OllamaConfig {
  baseUrl?: string;
  model?: string;
  timeout?: number;
  apiKey?: string;
}

export interface ModelInfo {
  id: string;
  provider: string;
  available: boolean;
  contextWindow?: number;
}

export interface OllamaResult {
  success: boolean;
  output: string;
  model: string;
  error?: string;
  duration: number;
}

// ============= 内置模型注册表 =============

const KNOWN_PROVIDERS: Record<string, { baseUrl: string; apiKeyEnv: string; models: string[] }> = {
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    apiKeyEnv: '',
    models: [], // 自动发现
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  grok: {
    baseUrl: 'https://api.x.ai/v1',
    apiKeyEnv: 'GROK_API_KEY',
    models: ['grok-3'],
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    models: ['gpt-4o', 'gpt-4o-mini'],
  },
};

// ============= 模型发现 =============

export async function discoverModels(): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];

  // 1. 检测 Ollama 本地
  try {
    const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      const data = await r.json() as { models?: Array<{ name: string }> };
      for (const m of data.models || []) {
        models.push({ id: `ollama:${m.name}`, provider: 'ollama', available: true });
      }
    }
  } catch { /* Ollama not running */ }

  // 2. 检查环境变量配置的 providers
  for (const [name, cfg] of Object.entries(KNOWN_PROVIDERS)) {
    if (name === 'ollama') continue; // already checked
    const key = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : null;
    if (key) {
      for (const model of cfg.models) {
        models.push({ id: `${name}:${model}`, provider: name, available: true });
      }
    } else if (name === 'openai' && process.env.OPENAI_API_KEY) {
      for (const model of cfg.models) {
        models.push({ id: model, provider: 'openai', available: true });
      }
    }
  }

  // 3. 手动配置的 OPENAI_BASE_URL
  if (process.env.OPENAI_BASE_URL && process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_MODEL || 'default';
    models.push({ id: model, provider: 'openai-compat', available: true });
  }

  // 4. MiniMax (当前默认)
  if (process.env.MINIMAX_API_KEY) {
    models.push({ id: process.env.MINIMAX_MODEL || 'MiniMax-M2.7', provider: 'minimax', available: true });
  }

  return models;
}

// ============= Ollama 执行 =============

export async function executeOllama(
  systemPrompt: string,
  userMessage: string,
  config: OllamaConfig = {}
): Promise<OllamaResult> {
  const start = Date.now();
  const baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
  const model = config.model || process.env.OLLAMA_MODEL || 'llama3';
  const timeout = config.timeout || 300000;
  const apiKey = config.apiKey || process.env.OLLAMA_API_KEY || '';

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', headers, signal: ctrl.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 32000,
        temperature: 0.7,
      }),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return { success: false, output: '', model,
        error: `Ollama HTTP ${r.status}: ${errText.slice(0, 200)}`,
        duration: Date.now() - start };
    }

    const data = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || '';

    return { success: true, output: content.trim(), model,
      duration: Date.now() - start };

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, output: '', model,
      error: msg.includes('abort') ? `timeout after ${timeout}ms` : msg,
      duration: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}
