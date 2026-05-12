/**
 * Agent Executor — 纯 API 驱动的 Agent 执行层
 * 
 * 不依赖任何外部 CLI。所有引擎通过 HTTP/SDK 直连模型 API。
 * 
 * 支持的引擎:
 * - minimax:  MiniMax M2.7 (默认)
 * - claude:   Anthropic SDK
 * - openai:   任何 OpenAI 兼容 API (DeepSeek/Grok/Gemini/etc)
 */

import { robustSDKCall } from './sdk-executor.js';
import { robustMiniMaxCall, type MiniMaxConfig } from './minimax-executor.js';
import { executeOllama, discoverModels, type OllamaConfig } from './ollama-executor.js';

// ============= 类型 =============

export type AgentEngine = 'minimax' | 'claude' | 'openai' | 'ollama' | 'auto';

export interface AgentExecutorConfig {
  engine: AgentEngine;
  model?: string;
  workdir?: string;
  timeout?: number;
}

export interface AgentExecutionResult {
  success: boolean;
  output: string;
  engine: AgentEngine;
  error?: string;
  duration: number;
}

// ============= 统一入口 =============

export async function executeAgent(
  systemPrompt: string,
  userMessage: string,
  config: AgentExecutorConfig
): Promise<AgentExecutionResult> {
  const startTime = Date.now();

  switch (config.engine) {
    case 'claude':
      return executeClaudeSDK(systemPrompt, userMessage, config);
    case 'minimax':
      return executeMiniMaxRoute(systemPrompt, userMessage, config);
    case 'openai':
      return executeOpenAICompat(systemPrompt, userMessage, config);
    case 'ollama':
      return executeOllamaRoute(systemPrompt, userMessage, config);
    case 'auto':
      return executeAutoRoute(systemPrompt, userMessage, config);
    default:
      return {
        success: false, output: '', engine: config.engine,
        error: `Unknown engine: ${config.engine}`,
        duration: Date.now() - startTime,
      };
  }
}

// ============= Claude (Anthropic SDK) =============

async function executeClaudeSDK(
  systemPrompt: string, userMessage: string, config: AgentExecutorConfig
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  try {
    const result = await robustSDKCall(systemPrompt, userMessage, { maxRetries: 2 });
    return {
      success: result.success, output: result.output, engine: 'claude',
      error: result.error?.message, duration: Date.now() - startTime,
    };
  } catch (e) {
    return {
      success: false, output: '', engine: 'claude',
      error: e instanceof Error ? e.message : String(e),
      duration: Date.now() - startTime,
    };
  }
}

// ============= MiniMax (HTTP 直连) =============

async function executeMiniMaxRoute(
  systemPrompt: string, userMessage: string, config: AgentExecutorConfig
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  const result = await robustMiniMaxCall(systemPrompt, userMessage, {
    model: config.model,
    timeout: config.timeout,
  });

  return {
    success: result.success, output: result.output, engine: 'minimax',
    error: result.error, duration: result.duration || Date.now() - startTime,
  };
}

// ============= OpenAI 兼容 API (通用 HTTP) =============

async function executeOpenAICompat(
  systemPrompt: string, userMessage: string, config: AgentExecutorConfig
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = config.model || process.env.OPENAI_MODEL || 'gpt-4o';

  if (!apiKey) {
    return {
      success: false, output: '', engine: 'openai',
      error: 'OPENAI_API_KEY not set',
      duration: Date.now() - startTime,
    };
  }

  const controller = new AbortController();
  const timeout = config.timeout || 300000;
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
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 32000,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return {
        success: false, output: '', engine: 'openai',
        error: `HTTP ${response.status}: ${errText.slice(0, 200)}`,
        duration: Date.now() - startTime,
      };
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content || '';

    return {
      success: true, output: content.trim(), engine: 'openai',
      duration: Date.now() - startTime,
    };

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      success: false, output: '', engine: 'openai',
      error: msg.includes('abort') ? `OpenAI timeout after ${timeout}ms` : msg,
      duration: Date.now() - startTime,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============= 引擎检测 =============

export async function detectAvailableEngines(): Promise<AgentEngine[]> {
  const available: AgentEngine[] = [];

  if (process.env.MINIMAX_API_KEY) available.push('minimax');
  if (process.env.ANTHROPIC_API_KEY) available.push('claude');
  if (process.env.OPENAI_API_KEY) available.push('openai');
  
  // 检测 Ollama
  try {
    const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    if (r.ok) available.push('ollama');
  } catch { /* not running */ }

  // 自动模式始终可用（会fallback）
  available.push('auto');

  return available.length > 0 ? available : ['minimax']; // 默认 fallback
}

// ============= Shell 命令执行 (非 AI，纯工具) =============

// ============= Ollama 路由 =============

async function executeOllamaRoute(
  systemPrompt: string, userMessage: string, config: AgentExecutorConfig
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  const result = await executeOllama(systemPrompt, userMessage, {
    model: config.model, timeout: config.timeout,
  });

  return {
    success: result.success, output: result.output, engine: 'ollama',
    error: result.error, duration: result.duration || Date.now() - startTime,
  };
}

// ============= Auto 路由 (自动选择最佳可用模型) =============

async function executeAutoRoute(
  systemPrompt: string, userMessage: string, config: AgentExecutorConfig
): Promise<AgentExecutionResult> {
  const startTime = Date.now();

  // 发现可用模型，按优先级尝试
  const models = await discoverModels();
  
  // 优先级: minimax > ollama > openai > claude
  const priority = ['minimax', 'ollama', 'openai', 'claude'];

  for (const engine of priority) {
    const available = models.some(m => m.provider === engine || engine === 'ollama' && m.provider === 'ollama');
    if (!available) continue;

    try {
      const result = await executeAgent(systemPrompt, userMessage, { ...config, engine: engine as AgentEngine });
      if (result.success && result.output.length > 50) {
        return { ...result, engine: 'auto' as AgentEngine, duration: Date.now() - startTime };
      }
    } catch { /* try next */ }
  }

  return {
    success: false, output: '', engine: 'auto',
    error: 'No available model found. Set MINIMAX_API_KEY or start Ollama.',
    duration: Date.now() - startTime,
  };
}

// ============= Shell 命令 =============

import { spawn } from 'child_process';

export function execCommand(
  cmd: string, args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: options.cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ success: false, stdout, stderr: 'Timeout' });
    }, options.timeout || 60000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, stdout, stderr: err.message });
    });
  });
}
