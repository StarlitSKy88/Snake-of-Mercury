/**
 * AgentConfig — 统一 Agent 配置模型
 * P1-3: 统一配置, P1-7: 分级 LLM (TradingAgents deep/quick)
 */
import type { AgentEngine } from '../utils/agent-executor.js';

export type ThinkingLevel = 'deep' | 'quick';

export interface TieredLLMConfig {
  deep: AgentEngine;
  quick: AgentEngine;
}

export const DEFAULT_TIERED_LLM: TieredLLMConfig = {
  deep: (process.env.DEEP_THINK_ENGINE || process.env.HARNESS_ENGINE || 'minimax') as AgentEngine,
  quick: (process.env.QUICK_THINK_ENGINE || process.env.HARNESS_ENGINE || 'minimax') as AgentEngine,
};

export type AgentRole = 'planner' | 'generator' | 'evaluator' | 'ceo' | 'devops' | 'marketing' | 'phase0_proposer' | 'phase0_challenger';

export const ROLE_THINKING_LEVEL: Record<AgentRole, ThinkingLevel> = {
  planner: 'deep', evaluator: 'deep', ceo: 'deep',
  phase0_proposer: 'deep', phase0_challenger: 'deep',
  generator: 'quick', devops: 'quick', marketing: 'quick',
};

export interface AgentConfig {
  role: AgentRole;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  maxIterations: number;
  maxIterationsHard: number;
  timeout: number;
  heartbeatTimeout: number;
  criticalSystemReminder?: string;
  loopDetection?: { cycleLen: number; similarityThreshold: number; waitCycles: number };
}

export const PRESETS: Record<string, AgentConfig> = {
  planner: { role: 'planner', thinkingLevel: 'deep', systemPrompt: '', maxIterations: 15, maxIterationsHard: 30, timeout: 300000, heartbeatTimeout: 120000, criticalSystemReminder: '基于证据决策，不要猜测。' },
  generator: { role: 'generator', thinkingLevel: 'quick', systemPrompt: '', maxIterations: 30, maxIterationsHard: 50, timeout: 600000, heartbeatTimeout: 180000, criticalSystemReminder: '遵循TDD。先测试再代码。', loopDetection: { cycleLen: 10, similarityThreshold: 0.7, waitCycles: 5 } },
  evaluator: { role: 'evaluator', thinkingLevel: 'deep', systemPrompt: '', maxIterations: 10, maxIterationsHard: 20, timeout: 300000, heartbeatTimeout: 120000, criticalSystemReminder: '只看CodeExecutor证据。含原始代码→REJECTED。' },
  ceo: { role: 'ceo', thinkingLevel: 'deep', systemPrompt: '', maxIterations: 20, maxIterationsHard: 40, timeout: 600000, heartbeatTimeout: 300000 },
  devops: { role: 'devops', thinkingLevel: 'quick', systemPrompt: '', maxIterations: 20, maxIterationsHard: 30, timeout: 600000, heartbeatTimeout: 180000 },
  marketing: { role: 'marketing', thinkingLevel: 'quick', systemPrompt: '', maxIterations: 20, maxIterationsHard: 30, timeout: 300000, heartbeatTimeout: 180000 },
};

export function resolveEngine(role: AgentRole, tiered: TieredLLMConfig = DEFAULT_TIERED_LLM): AgentEngine {
  const level = ROLE_THINKING_LEVEL[role] || 'quick';
  return tiered[level];
}
