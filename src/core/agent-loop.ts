/**
 * Agent Loop — 系统唯一引擎
 * 
 * v5: 
 *   - DoneSequence 多事件完成检测
 *   - 假成功模式检测
 *   - 内容相似度循环检测
 *   - P1-4: critical_system_reminder 每轮注入
 * 
 * while true:
 *   LLM(system + reminder, messages, tools) → response
 *   if doneSequence.match(log): break
 *   for each tool: execute → append result
 */

import { executeAgent, type AgentEngine } from '../utils/agent-executor.js';
import {
  DoneSequenceMatcher,
  CODING_TASK_DONE,
  DEPLOY_TASK_DONE,
  ANALYSIS_TASK_DONE,
  isFalseSuccess,
  type DoneSequence,
  type EventLogEntry,
} from './done-sequence.js';

// ============ 类型 ============

export interface AgentLoopConfig {
  engine: AgentEngine;
  systemPrompt: string;
  maxIterations?: number;
  maxIterationsHard?: number;
  timeout?: number;
  heartbeatTimeout?: number;
  taskLabel?: string;
  taskType?: 'coding' | 'deploy' | 'analysis';
  extraDoneSequences?: DoneSequence[];
  /** P1-4: 每轮注入的核心提醒（借鉴 OpenHarness critical_system_reminder） */
  criticalSystemReminder?: string;
  loopDetection?: {
    cycleLen: number;
    similarityThreshold: number;
    waitCycles: number;
  };
}

export interface AgentLoopResult {
  success: boolean;
  output: string;
  iterations: number;
  error?: string;
  heartbeats?: number;
  doneSequenceName?: string;
  falseSuccessDetected?: boolean;
}

// ============ 循环检测 ============

interface ContentSnapshot { iteration: number; hash: string; }

class LoopDetector {
  private history: ContentSnapshot[] = [];
  private cycleLen: number;
  private threshold: number;
  private waitCycles: number;

  constructor(cycleLen = 10, threshold = 0.7, waitCycles = 5) {
    this.cycleLen = cycleLen;
    this.threshold = threshold;
    this.waitCycles = waitCycles;
  }

  record(iteration: number, output: string): void {
    const hash = this._simpleHash(output.slice(-2000));
    this.history.push({ iteration, hash });
    if (this.history.length > this.cycleLen * 2) this.history.shift();
  }

  detect(): boolean {
    if (this.history.length < this.cycleLen * 2) return false;
    const recent = this.history.slice(-this.cycleLen);
    const previous = this.history.slice(-this.cycleLen * 2, -this.cycleLen);
    const recentUnique = new Set(recent.map(s => s.hash));
    const previousUnique = new Set(previous.map(s => s.hash));
    let overlap = 0;
    for (const h of recentUnique) if (previousUnique.has(h)) overlap++;
    const dominance = recentUnique.size === 0 ? 0 : overlap / recentUnique.size;
    return dominance >= this.threshold;
  }

  reset(): void { this.history = []; }

  private _simpleHash(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) { hash = ((hash << 5) - hash) + s.charCodeAt(i); hash |= 0; }
    return String(hash);
  }
}

// ============ 辅助 ============

function getDoneSequences(taskType?: string, extra?: DoneSequence[]): DoneSequence[] {
  const sequences: DoneSequence[] = [];
  switch (taskType) {
    case 'coding': sequences.push(CODING_TASK_DONE); break;
    case 'deploy': sequences.push(DEPLOY_TASK_DONE); break;
    case 'analysis': sequences.push(ANALYSIS_TASK_DONE); break;
    default: sequences.push(CODING_TASK_DONE, DEPLOY_TASK_DONE, ANALYSIS_TASK_DONE);
  }
  if (extra) sequences.push(...extra);
  return sequences;
}

// ============ 核心 ============

export async function agentLoop(
  task: string,
  config: AgentLoopConfig
): Promise<AgentLoopResult> {
  const maxIterations = config.maxIterations || 50;
  const hardLimit = config.maxIterationsHard || 100;
  const effectiveMax = Math.min(maxIterations, hardLimit);
  
  let output = '';
  let iterations = 0;
  const heartbeatMs = config.heartbeatTimeout || 180000;
  let lastProgressTime = Date.now();
  let heartbeatCount = 0;

  const matcher = new DoneSequenceMatcher();
  const doneSequences = getDoneSequences(config.taskType, config.extraDoneSequences);
  const loopDetector = new LoopDetector(
    config.loopDetection?.cycleLen ?? 10,
    config.loopDetection?.similarityThreshold ?? 0.7,
    config.loopDetection?.waitCycles ?? 5
  );

  // P1-4: 构建带 reminder 的 system prompt
  const reminder = config.criticalSystemReminder 
    ? `\n\n## ⚠️ 核心提醒（每轮重复）\n${config.criticalSystemReminder}`
    : '';
  const effectiveSystemPrompt = config.systemPrompt + reminder;

  for (let i = 0; i < effectiveMax; i++) {
    iterations++;

    const elapsed = Date.now() - lastProgressTime;
    if (elapsed > heartbeatMs) {
      heartbeatCount++;
      const label = config.taskLabel || 'unknown';
      console.log(`💓 [心跳 #${heartbeatCount}] ${label}: ${Math.round(elapsed / 1000)}s 无进展`);
      lastProgressTime = Date.now();
    }

    const result = await executeAgent(
      effectiveSystemPrompt,
      task + (output ? `\n\n---\n上一轮输出:\n${output.slice(-2000)}` : ''),
      { engine: config.engine, timeout: config.timeout || 300000 }
    );

    if (!result.success) {
      return { success: false, output, iterations, error: result.error, heartbeats: heartbeatCount };
    }

    output = result.output;
    lastProgressTime = Date.now();

    // 循环检测
    loopDetector.record(i, output);
    if (loopDetector.detect()) {
      console.log(`🔁 [循环检测] 第 ${iterations} 轮检测到内容循环，终止`);
      return { success: false, output, iterations, error: 'INFINITE_LOOP', heartbeats: heartbeatCount };
    }

    // DoneSequence 日志
    const hasToolCall = /ToolCall|execute|bash|npm (test|run)/i.test(output);
    const hasCodeExecutor = /CodeExecutor|验证.*通过|测试.*通过|✅.*(测试|验证|build)/i.test(output);
    if (hasToolCall) matcher.record({ eventType: 'tool_call', content: output, sender: config.taskLabel || 'agent', timestamp: Date.now() });
    if (hasCodeExecutor) matcher.record({ eventType: 'executor_pass', content: output, sender: 'code-executor', timestamp: Date.now() });
    matcher.record({ eventType: 'llm_response', content: output, sender: config.taskLabel || 'agent', timestamp: Date.now() });

    // 完成检测
    const { matched, name } = matcher.matchAny(doneSequences);
    if (matched) {
      const falseSuccess = isFalseSuccess(output);
      if (falseSuccess.found) {
        console.log(`⚠️ [假成功检测] 输出含 "${falseSuccess.pattern}"，忽略匹配`);
        continue;
      }
      console.log(`✅ [DoneSequence] 匹配: ${name}`);
      return { success: true, output, iterations, heartbeats: heartbeatCount, doneSequenceName: name };
    }

    if (i >= maxIterations - 1) {
      const falseSuccess = isFalseSuccess(output);
      if (falseSuccess.found) {
        console.log(`🚨 [假成功] 含 "${falseSuccess.pattern}" 但 DoneSequence 未匹配`);
        return { success: false, output, iterations, error: `FALSE_SUCCESS: "${falseSuccess.pattern}"`, heartbeats: heartbeatCount, falseSuccessDetected: true };
      }
    }
  }

  return { success: false, output, iterations, error: `MAX_ITERATIONS: 达到硬上限 ${hardLimit}`, heartbeats: heartbeatCount };
}

export async function agentCall(
  systemPrompt: string,
  userMessage: string,
  engine: AgentEngine = 'minimax'
): Promise<string> {
  const result = await executeAgent(systemPrompt, userMessage, { engine, timeout: 300000 });
  if (!result.success) throw new Error(`Agent call failed: ${result.error}`);
  return result.output;
}
