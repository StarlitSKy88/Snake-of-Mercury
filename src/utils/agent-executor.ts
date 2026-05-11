/**
 * Agent Executor - 统一的 Agent 执行抽象层
 * 
 * 设计原则（遵循 Anthropic Managed Agents 架构）：
 * - Brain (Agent) 与 Hands (Executor) 分离
 * - execute(prompt, options) → string 统一接口
 * - 引擎可独立替换，不影响上层 Harness 逻辑
 */

import { spawn } from 'child_process';
import { robustSDKCall } from './sdk-executor.js';
import { execCodex, robustCodexCall, type CodexExecutorConfig } from './codex-executor.js';

// ============= 类型 =============

export type AgentEngine = 'claude' | 'codex';

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

// ============= 统一执行器 =============

/**
 * 执行 Agent 调用（自动选择引擎）
 */
export async function executeAgent(
  systemPrompt: string,
  userMessage: string,
  config: AgentExecutorConfig
): Promise<AgentExecutionResult> {
  const startTime = Date.now();

  switch (config.engine) {
    case 'claude':
      return executeClaude(systemPrompt, userMessage, config);
    case 'codex':
      return executeCodexAgent(systemPrompt, userMessage, config);
    default:
      return {
        success: false,
        output: '',
        engine: config.engine,
        error: `Unknown engine: ${config.engine}`,
        duration: Date.now() - startTime,
      };
  }
}

/**
 * Claude 引擎执行
 */
async function executeClaude(
  systemPrompt: string,
  userMessage: string,
  config: AgentExecutorConfig
): Promise<AgentExecutionResult> {
  const startTime = Date.now();

  // 优先使用 SDK，SDK 不可用时降级到 CLI
  try {
    const result = await robustSDKCall(systemPrompt, userMessage, {
      maxRetries: 2,
    });

    return {
      success: result.success,
      output: result.output,
      engine: 'claude',
      error: result.error?.message,
      duration: Date.now() - startTime,
    };
  } catch {
    // 降级到 CLI
    return executeClaudeCLI(systemPrompt, userMessage, config);
  }
}

/**
 * Claude CLI 降级执行
 */
async function executeClaudeCLI(
  systemPrompt: string,
  userMessage: string,
  config: AgentExecutorConfig
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;

  return new Promise((resolve) => {
    const proc = spawn('claude', ['-p', fullPrompt, '--dangerously-skip-permissions'], {
      cwd: config.workdir || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      resolve({
        success: false, output: stdout, engine: 'claude',
        error: 'Timeout', duration: Date.now() - startTime,
      });
    }, config.timeout || 300000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        success: code === 0,
        output: stdout.trim(),
        engine: 'claude',
        error: code !== 0 ? (stderr || `Exit code ${code}`) : undefined,
        duration: Date.now() - startTime,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false, output: stdout, engine: 'claude',
        error: err.message, duration: Date.now() - startTime,
      });
    });
  });
}

/**
 * Codex 引擎执行
 */
async function executeCodexAgent(
  systemPrompt: string,
  userMessage: string,
  config: AgentExecutorConfig
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  const fullPrompt = `[System]\n${systemPrompt}\n\n[Task]\n${userMessage}`;

  const result = await robustCodexCall(fullPrompt, {
    workdir: config.workdir,
    model: config.model,
    timeout: config.timeout,
    sandboxMode: 'workspace-write',
  });

  return {
    success: result.success,
    output: result.output,
    engine: 'codex',
    error: result.error,
    duration: result.duration || Date.now() - startTime,
  };
}

// ============= 快速命令执行（跨引擎通用） =============

/**
 * 执行 shell 命令（引擎无关）
 */
export function execCommand(
  cmd: string,
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: options.cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

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

// ============= 引擎检测 =============

/**
 * 检测可用的 Agent 引擎
 */
export async function detectAvailableEngines(): Promise<AgentEngine[]> {
  const available: AgentEngine[] = [];

  // 检测 Claude
  try {
    const r = await execCommand('claude', ['--version'], { timeout: 5000 });
    if (r.success) available.push('claude');
  } catch { /* not available */ }

  // 检测 Codex
  try {
    const r = await execCommand('codex', ['--version'], { timeout: 5000 });
    if (r.success) available.push('codex');
  } catch { /* not available */ }

  return available;
}
