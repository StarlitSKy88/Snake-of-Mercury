/**
 * Codex CLI 执行器
 * 
 * 支持 Codex CLI 作为 Agent 执行引擎，与 Claude Agent SDK 并行。
 * 
 * 接口设计遵循 Managed Agents 的 "brain decoupled from hands" 原则：
 * - execute(prompt, options) → string
 * - 引擎可独立替换，不影响上层 Harness 逻辑
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

// ============= 类型 =============

export interface CodexExecutorConfig {
  /** Codex CLI 可执行文件路径（默认: codex） */
  binary?: string;
  /** 工作目录 */
  workdir?: string;
  /** 超时时间 (ms)，默认 5 分钟 */
  timeout?: number;
  /** 模型覆盖 */
  model?: string;
  /** 是否允许审批 (默认跳过) */
  approval?: 'default' | 'yolo';
  /** 最大输出 token 数 */
  maxOutputTokens?: number;
  /** 沙箱模式 */
  sandboxMode?: 'workspace-write' | 'danger-full-access';
}

export interface CodexExecutionResult {
  success: boolean;
  output: string;
  exitCode: number | null;
  error?: string;
  /** 执行耗时 (ms) */
  duration: number;
}

// ============= 默认配置 =============

const DEFAULT_CONFIG: Required<CodexExecutorConfig> = {
  binary: 'codex',
  workdir: process.cwd(),
  timeout: 300000, // 5 分钟
  model: '',
  approval: 'default',
  maxOutputTokens: 32000,
  sandboxMode: 'workspace-write',
};

// ============= 核心函数 =============

/**
 * 执行 Codex CLI 命令
 * 
 * Codex CLI 接口: codex exec -p "prompt" [options]
 * 返回结构化结果，包括是否成功、输出内容、退出码和耗时
 */
export async function execCodex(
  prompt: string,
  config: CodexExecutorConfig = {}
): Promise<CodexExecutionResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();

  // 检查 Codex CLI 是否可用
  if (!await isCodexAvailable(cfg.binary)) {
    return {
      success: false,
      output: '',
      exitCode: null,
      error: `Codex CLI not found: ${cfg.binary}. Install with: curl -fsSL https://codex.openai.com/install.sh | bash`,
      duration: Date.now() - startTime,
    };
  }

  return new Promise((resolve) => {
    // 构建命令参数
    const args = buildCodexArgs(prompt, cfg);

    const proc = spawn(cfg.binary, args, {
      cwd: cfg.workdir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(cfg.model ? { CODEX_MODEL: cfg.model } : {}),
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      // 如果输出过大，截断
      if (stdout.length > (cfg.maxOutputTokens || 32000) * 4) {
        proc.kill();
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      // 给 5 秒优雅关闭
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);

      resolve({
        success: false,
        output: stdout,
        exitCode: null,
        error: `Codex execution timed out after ${cfg.timeout}ms`,
        duration: Date.now() - startTime,
      });
    }, cfg.timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;

      if (code === 0) {
        resolve({
          success: true,
          output: stdout.trim(),
          exitCode: code,
          duration,
        });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          exitCode: code,
          error: stderr.trim() || `Codex exited with code ${code}`,
          duration,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: stdout,
        exitCode: null,
        error: `Failed to spawn Codex: ${err.message}`,
        duration: Date.now() - startTime,
      });
    });
  });
}

/**
 * 带重试的 Codex 执行
 * 
 * 模仿 sdk-executor.ts 的 robustSDKCall 模式：
 * - 指数退避
 * - 最多 3 次重试
 * - 空输出自动重试
 */
export async function robustCodexCall(
  prompt: string,
  config: CodexExecutorConfig = {},
  maxRetries: number = 3
): Promise<CodexExecutionResult> {
  let lastResult: CodexExecutionResult | null = null;
  const baseBackoff = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await execCodex(prompt, config);

    if (result.success && result.output.length > 50) {
      return result;
    }

    // 空输出或过短输出 → 重试
    if (result.output.length < 50 && attempt < maxRetries) {
      console.log(`[Codex] 输出过短 (${result.output.length} 字符)，重试 ${attempt}/${maxRetries}...`);
      const backoff = Math.min(baseBackoff * Math.pow(2, attempt - 1), 30000);
      await sleep(backoff + Math.random() * 1000);
      continue;
    }

    // 失败 → 重试
    if (!result.success && attempt < maxRetries) {
      console.log(`[Codex] 执行失败: ${result.error}，重试 ${attempt}/${maxRetries}...`);
      const backoff = Math.min(baseBackoff * Math.pow(2, attempt - 1), 30000);
      await sleep(backoff + Math.random() * 1000);
      continue;
    }

    lastResult = result;
    return result;
  }

  return lastResult!;
}

/**
 * 检查 Codex CLI 是否可用
 */
async function isCodexAvailable(binary: string): Promise<boolean> {
  // 如果是绝对路径，直接检查文件是否存在
  if (binary.includes('/')) {
    return existsSync(binary);
  }

  // 尝试执行 version 命令
  try {
    const result = await quickSpawn(binary, ['--version'], 5000);
    return result.success;
  } catch {
    return false;
  }
}

/**
 * 快速执行命令（用于检测）
 */
function quickSpawn(
  cmd: string,
  args: string[],
  timeout: number
): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ success: false });
    }, timeout);
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0 });
    });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve({ success: false });
    });
  });
}

/**
 * 构建 Codex CLI 参数
 */
function buildCodexArgs(
  prompt: string,
  config: Required<CodexExecutorConfig>
): string[] {
  const args: string[] = ['exec', '-p', prompt];

  // 审批模式
  if (config.approval === 'yolo') {
    // Codex 默认会在需要时请求审批，yolo 模式跳过
    // 当前通过环境变量控制，此处为预留参数
  }

  return args;
}

/**
 * 睡眠工具
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============= Agent 封装 =============

/**
 * Codex Agent - 高级封装
 * 
 * 提供与 Claude Agent SDK 类似的编程接口：
 * - query(prompt) → 执行 Codex
 * - 内置输出验证
 * - 自动重试
 */
export class CodexAgent {
  private config: Required<CodexExecutorConfig>;
  private role: string;

  constructor(role: string, config: CodexExecutorConfig = {}) {
    this.role = role;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 执行查询
   */
  async query(prompt: string): Promise<CodexExecutionResult> {
    const fullPrompt = this.buildRolePrompt(prompt);
    return robustCodexCall(fullPrompt, this.config);
  }

  /**
   * 执行带验证的查询
   */
  async queryWithValidation(
    prompt: string,
    validator: (output: string) => { valid: boolean; reason?: string }
  ): Promise<CodexExecutionResult> {
    const result = await this.query(prompt);
    if (result.success) {
      const validation = validator(result.output);
      result.success = validation.valid;
      if (!validation.valid) {
        result.error = validation.reason || 'Validation failed';
      }
    }
    return result;
  }

  /**
   * 构建角色提示
   */
  private buildRolePrompt(userPrompt: string): string {
    return `You are: ${this.role}

${userPrompt}

IMPORTANT: Output ONLY the result. Do not include conversational text.
Use tools (read, write, bash) as needed to complete the task.`;
  }
}

// ============= 导出 =============

export { DEFAULT_CONFIG as CODEX_DEFAULT_CONFIG };
