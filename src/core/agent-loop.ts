/**
 * Agent Loop — 系统唯一引擎
 * 
 * v5: 
 *   - DoneSequence 多事件完成检测 (替代字符串匹配)
 *   - 假成功模式检测
 *   - 内容相似度循环检测 (替代纯心跳)
 * 
 * while true:
 *   LLM(system, messages, tools) → response
 *   if doneSequence.match(log): break
 *   for each tool: execute → append result
 * 
 * 整个项目的所有 Agent 都跑在同一个循环上。
 * 区别只在 system prompt 和 tools 不同。
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

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface AgentLoopConfig {
  engine: AgentEngine;
  systemPrompt: string;
  maxIterations?: number;
  maxIterationsHard?: number;   // v5: 硬上限(默认100)，超过即使 doneSequence 不匹配也终止
  timeout?: number;
  heartbeatTimeout?: number;
  taskLabel?: string;
  /** 任务类型，决定使用哪个 DoneSequence */
  taskType?: 'coding' | 'deploy' | 'analysis';
  /** 额外的自定义 DoneSequence */
  extraDoneSequences?: DoneSequence[];
  /** 循环检测配置 */
  loopDetection?: {
    cycleLen: number;          // 每 N 轮检测一次 (默认 10)
    similarityThreshold: number; // 相似度阈值 (默认 0.7)
    waitCycles: number;        // 前 N 轮不检测 (默认 5)
  };
}

export interface AgentLoopResult {
  success: boolean;
  output: string;
  iterations: number;
  error?: string;
  heartbeats?: number;
  doneSequenceName?: string;   // v5: 匹配到的序列名称
  falseSuccessDetected?: boolean; // v5: 是否检测到假成功
}

// ============ 循环检测 ============

interface ContentSnapshot {
  iteration: number;
  hash: string;
}

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
    if (this.history.length > this.cycleLen * 2) {
      this.history.shift();
    }
  }

  /**
   * 检测循环: 比较最近 cycleLen 轮与前一个 cycleLen 轮的相似度
   * 借鉴 Langroid inf_loop_dominance_factor
   */
  detect(): boolean {
    if (this.history.length < this.cycleLen * 2) return false;
    
    // 只检测最后 waitCycles 之后的结果
    const recent = this.history.slice(-this.cycleLen);
    const previous = this.history.slice(-this.cycleLen * 2, -this.cycleLen);

    // 如果 recent 的 hash 种类被 previous 的 hash 种类主导
    // (即没有产生实质性新内容)
    const recentUnique = new Set(recent.map(s => s.hash));
    const previousUnique = new Set(previous.map(s => s.hash));
    
    // 计算 overlap: 最近的 hash 有多少出现在前一段
    let overlap = 0;
    for (const h of recentUnique) {
      if (previousUnique.has(h)) overlap++;
    }

    // dominance: overlap / recentUnique.size
    const dominance = recentUnique.size === 0 ? 0 : overlap / recentUnique.size;
    return dominance >= this.threshold;
  }

  reset(): void {
    this.history = [];
  }

  private _simpleHash(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash |= 0;
    }
    return String(hash);
  }
}

// ============ 获取 DoneSequence ============

function getDoneSequences(taskType?: string, extra?: DoneSequence[]): DoneSequence[] {
  const sequences: DoneSequence[] = [];
  
  switch (taskType) {
    case 'coding':
      sequences.push(CODING_TASK_DONE);
      break;
    case 'deploy':
      sequences.push(DEPLOY_TASK_DONE);
      break;
    case 'analysis':
      sequences.push(ANALYSIS_TASK_DONE);
      break;
    default:
      // 默认: 检测所有
      sequences.push(CODING_TASK_DONE, DEPLOY_TASK_DONE, ANALYSIS_TASK_DONE);
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

  // v5: 初始化 DoneSequence 匹配器
  const matcher = new DoneSequenceMatcher();
  const doneSequences = getDoneSequences(config.taskType, config.extraDoneSequences);

  // v5: 初始化循环检测器
  const loopDetector = new LoopDetector(
    config.loopDetection?.cycleLen ?? 10,
    config.loopDetection?.similarityThreshold ?? 0.7,
    config.loopDetection?.waitCycles ?? 5
  );

  for (let i = 0; i < effectiveMax; i++) {
    iterations++;

    // v4: 心跳检测
    const elapsed = Date.now() - lastProgressTime;
    if (elapsed > heartbeatMs) {
      heartbeatCount++;
      const label = config.taskLabel || 'unknown';
      console.log(`💓 [心跳 #${heartbeatCount}] ${label}: ${Math.round(elapsed / 1000)}s 无进展`);
      lastProgressTime = Date.now();
    }

    const result = await executeAgent(
      config.systemPrompt,
      task + (output ? `\n\n---\n上一轮输出:\n${output.slice(-2000)}` : ''),
      {
        engine: config.engine,
        timeout: config.timeout || 300000,
      }
    );

    if (!result.success) {
      return {
        success: false, output, iterations,
        error: result.error, heartbeats: heartbeatCount,
      };
    }

    output = result.output;
    lastProgressTime = Date.now();

    // v5: 循环检测
    loopDetector.record(i, output);
    if (loopDetector.detect()) {
      console.log(`🔁 [循环检测] 第 ${iterations} 轮检测到内容循环，终止`);
      return {
        success: false, output, iterations,
        error: 'INFINITE_LOOP: 检测到内容循环，最近几轮输出高度相似',
        heartbeats: heartbeatCount,
      };
    }

    // v5: 记录事件到 DoneSequence 日志
    const hasCodeExecutor = /CodeExecutor|验证.*通过|测试.*通过|✅.*(测试|验证|build)/i.test(output);
    const hasToolCall = /ToolCall|execute|bash|npm (test|run)/i.test(output);
    
    if (hasToolCall) {
      matcher.record({
        eventType: 'tool_call',
        content: output,
        sender: config.taskLabel || 'agent',
        timestamp: Date.now(),
      });
    }
    
    if (hasCodeExecutor) {
      matcher.record({
        eventType: 'executor_pass',
        content: output,
        sender: 'code-executor',
        timestamp: Date.now(),
      });
    }

    matcher.record({
      eventType: 'llm_response',
      content: output,
      sender: config.taskLabel || 'agent',
      timestamp: Date.now(),
    });

    // v5: DoneSequence 检测
    const { matched, name } = matcher.matchAny(doneSequences);
    if (matched) {
      // 额外检查: 确认不是假成功
      const falseSuccess = isFalseSuccess(output);
      if (falseSuccess.found) {
        console.log(`⚠️ [假成功检测] 输出含 "${falseSuccess.pattern}"，忽略 DoneSequence 匹配`);
        // 继续循环，不终止
        continue;
      }

      console.log(`✅ [DoneSequence] 匹配: ${name}`);
      return {
        success: true, output, iterations,
        heartbeats: heartbeatCount,
        doneSequenceName: name,
      };
    }

    // v5: 如果 i 到了 maxIterations 但 doneSequence 未匹配
    // 检查是否有假成功模式
    if (i >= maxIterations - 1) {
      const falseSuccess = isFalseSuccess(output);
      if (falseSuccess.found) {
        console.log(`🚨 [假成功] 达到最大迭代但未通过 DoneSequence，输出含 "${falseSuccess.pattern}"`);
        return {
          success: false, output, iterations,
          error: `FALSE_SUCCESS: 输出含 "${falseSuccess.pattern}" 但 DoneSequence 未匹配`,
          heartbeats: heartbeatCount,
          falseSuccessDetected: true,
        };
      }
    }
  }

  // 达到硬上限
  return {
    success: false, output, iterations,
    error: `MAX_ITERATIONS: 达到硬上限 ${hardLimit} 轮，DoneSequence 未完全匹配`,
    heartbeats: heartbeatCount,
  };
}

/**
 * 简化版：单次 Agent 调用（不做循环）
 * 用于 Planner / Phase0 等一次性分析任务
 */
export async function agentCall(
  systemPrompt: string,
  userMessage: string,
  engine: AgentEngine = 'minimax'
): Promise<string> {
  const result = await executeAgent(systemPrompt, userMessage, {
    engine,
    timeout: 300000,
  });

  if (!result.success) {
    throw new Error(`Agent call failed: ${result.error}`);
  }

  return result.output;
}
