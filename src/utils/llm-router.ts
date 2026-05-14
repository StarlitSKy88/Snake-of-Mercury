/**
 * LLM Router — 多引擎自动 fallback (P3-3)
 * 
 * 主引擎失败 → 自动切换备用引擎重试
 */
import { executeAgent, type AgentEngine } from './agent-executor.js';

export interface LLMRouterConfig {
  primary: AgentEngine;
  fallbacks: AgentEngine[];
  maxRetries?: number;
}

export async function executeWithFallback(
  systemPrompt: string,
  userMessage: string,
  config: LLMRouterConfig,
  timeout = 300000
): Promise<{ success: boolean; output: string; engine: AgentEngine; error?: string }> {
  const engines = [config.primary, ...config.fallbacks];
  const maxRetries = config.maxRetries || engines.length;

  let lastError = '';

  for (let i = 0; i < Math.min(maxRetries, engines.length); i++) {
    const engine = engines[i];
    try {
      const result = await executeAgent(systemPrompt, userMessage, { engine, timeout });
      if (result.success) {
        if (i > 0) console.log(`🔄 [LLM Router] ${config.primary} 失败 → ${engine} 成功`);
        return { success: true, output: result.output, engine };
      }
      lastError = result.error || 'unknown';
    } catch (e: any) {
      lastError = e.message || String(e);
    }
    if (i < engines.length - 1) {
      console.log(`⚠️ [LLM Router] ${engine} 失败 (${lastError}), 切换到 ${engines[i+1]}...`);
    }
  }

  return { success: false, output: '', engine: config.primary, error: `所有引擎失败: ${lastError}` };
}

/** 默认 fallback 链 */
export const DEFAULT_FALLBACKS: AgentEngine[] = ['minimax', 'openai', 'openai'];
