/**
 * Debate Engine Hub — Phase 0 轻量包装
 *
 * 直接委托给 phase0-debate-engine.ts 执行文件级 5 Agent 辩论。
 * 原 Hub/ProcessAgent/JSON-RPC 链路已移除（依赖 claude CLI，未使用）。
 */

import type {
  DebateResult,
  ProblemDefinition
} from '../types.js';

/**
 * Hub 辩论选项（兼容旧调用签名）
 */
export interface HubDebateOptions {
  useFileFallback?: boolean;
  hubConfig?: {
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    agentTimeout?: number;
    maxAgents?: number;
  };
}

/**
 * 执行辩论（Hub 兼容签名）
 *
 * 直接调用 phase0-debate-engine.ts 的文件级辩论引擎。
 */
export async function executeHubDebate(
  projectDir: string,
  problemDefinition: ProblemDefinition,
  iterationId: number,
  _options?: HubDebateOptions
): Promise<DebateResult> {
  const { executePhase0Debate } = await import('../phase0-debate-engine.js');
  return executePhase0Debate(projectDir, problemDefinition, iterationId);
}
