/**
 * Agent Loop — 系统唯一引擎
 * 
 * while true:
 *   LLM(system, messages, tools) → response
 *   if no tool calls: break
 *   for each tool: execute → append result
 * 
 * 整个项目的所有 Agent 都跑在同一个循环上。
 * 区别只在 system prompt 和 tools 不同。
 */

import { executeAgent, type AgentEngine } from '../utils/agent-executor.js';

// ============ 类型 ============

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface AgentLoopConfig {
  engine: AgentEngine;
  systemPrompt: string;
  maxIterations?: number;
  timeout?: number;
}

export interface AgentLoopResult {
  success: boolean;
  output: string;
  iterations: number;
  error?: string;
}

// ============ 核心 ============

/**
 * 执行 Agent Loop
 * 
 * 这是系统唯一的"做事"方式。
 * 所有 Agent (Planner/Generator/Evaluator/CEO) 都用这个函数。
 */
export async function agentLoop(
  task: string,
  config: AgentLoopConfig
): Promise<AgentLoopResult> {
  const maxIterations = config.maxIterations || 50;
  let output = '';
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    iterations++;

    const result = await executeAgent(
      config.systemPrompt,
      task + (output ? `\n\n---\n上一轮输出:\n${output.slice(-2000)}` : ''),
      {
        engine: config.engine,
        timeout: config.timeout || 300000,
      }
    );

    if (!result.success) {
      return { success: false, output, iterations, error: result.error };
    }

    output = result.output;

    // 如果没有更多工作要做，退出
    // Generator 和 Evaluator 输出中包含 DONE 标记
    if (output.includes('TASK_COMPLETE') || output.includes('任务完成')) {
      return { success: true, output, iterations };
    }
  }

  return { success: true, output, iterations };
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
