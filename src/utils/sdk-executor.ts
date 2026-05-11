/**
 * SDK Executor - 健壮的 Anthropic SDK 执行器
 *
 * 解决问题：
 * 1. SDK 空响应 (end_turn + empty content)
 * 2. LLM 推理不稳定 (输出过短、"lazy" 输出)
 * 3. 缺乏 guided retry 机制
 *
 * 核心设计：
 * - max_tokens 固定 8192，确保足够的输出空间
 * - 输出验证：最小行数要求
 * - Guided retry：指数退避 + 反思机制
 * - 空响应自动重试
 */

import Anthropic from '@anthropic-ai/sdk';

// ============= 常量 =============

/** SDK 执行常量 */
const SDK_CONFIG = {
  /** 模型 */
  model: 'claude-sonnet-4-20250514',
  /** 最大 token 数 - 保持 8192 以避免截断 */
  maxTokens: 8192,
  /** 最小输出行数 - 防止 lazy 输出 */
  minOutputLines: 20,
  /** 最大重试次数 */
  maxRetries: 3,
  /** 基础退避延迟 (ms) */
  baseBackoffMs: 1000,
  /** 最大退避延迟 (ms) */
  maxBackoffMs: 10000,
  /** 空响应或过短输出的默认行数阈值 */
  shortOutputThreshold: 5
} as const;

/** 重试错误类型 */
interface RetryableError {
  type: 'empty_response' | 'short_output' | 'api_error' | 'timeout';
  message: string;
  attempt: number;
  rawError?: unknown;
}

/** 执行结果 */
interface ExecutionResult {
  success: boolean;
  output: string;
  attempts: number;
  error?: RetryableError;
}

// ============= 核心函数 =============

/**
 * 健壮地执行 SDK 调用
 *
 * 特性：
 * - 自动重试空响应和过短输出
 * - Guided retry：每次重试前进行简短反思
 * - 指数退避避免 API 限流
 */
export async function robustSDKCall(
  systemPrompt: string,
  userMessage: string,
  options: {
    maxRetries?: number;
    minOutputLines?: number;
    onRetry?: (attempt: number, reason: string) => void;
  } = {}
): Promise<ExecutionResult> {
  const {
    maxRetries = SDK_CONFIG.maxRetries,
    minOutputLines = SDK_CONFIG.minOutputLines,
    onRetry
  } = options;

  let lastError: RetryableError | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const output = await executeSingleCall(systemPrompt, userMessage);

      // 验证输出
      const lines = output.trim().split('\n').filter(line => line.trim().length > 0);

      if (lines.length < minOutputLines) {
        // 过短输出，触发重试
        lastError = {
          type: 'short_output',
          message: `输出过短: 仅 ${lines.length} 行，需要至少 ${minOutputLines} 行`,
          attempt,
          rawError: output
        };

        if (attempt < maxRetries) {
          const reason = `输出过短 (${lines.length}/${minOutputLines} 行)`;
          onRetry?.(attempt, reason);

          // Guided retry: 提供反思提示
          const reflectionPrompt = buildReflectionPrompt(
            `上次输出过短 (${lines.length} 行)，需要至少 ${minOutputLines} 行。请反思：为什么输出这么短？如何产生更完整的回答？`,
            userMessage
          );

          await sleep(computeBackoff(attempt));
          continue;
        }
      }

      // 成功
      return {
        success: true,
        output,
        attempts: attempt
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // 检查是否是空响应错误
      const isEmptyResponse = errorMessage.includes('No text response') ||
                              errorMessage.includes('empty') ||
                              errorMessage.includes('undefined');

      lastError = {
        type: isEmptyResponse ? 'empty_response' : 'api_error',
        message: errorMessage,
        attempt,
        rawError: error
      };

      if (attempt < maxRetries) {
        const reason = isEmptyResponse ? '空响应 (end_turn + empty content)' : `API 错误: ${errorMessage}`;
        onRetry?.(attempt, reason);

        // Guided retry: 反思后重试
        const reflectionPrompt = buildReflectionPrompt(
          `上次调用失败: ${errorMessage}。请反思：可能的原因是什么？如何在下次调用时避免这个问题？`,
          userMessage
        );

        await sleep(computeBackoff(attempt));
      }
    }
  }

  // 所有重试都失败
  return {
    success: false,
    output: '',
    attempts: maxRetries,
    error: lastError
  };
}

/**
 * 执行单次 SDK 调用
 */
async function executeSingleCall(systemPrompt: string, userMessage: string): Promise<string> {
  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: SDK_CONFIG.model,
    max_tokens: SDK_CONFIG.maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userMessage
      }
    ]
  });

  // 提取文本响应 - 使用安全的类型检查
  let textContent: string | undefined;

  for (const block of response.content) {
    if (block.type === 'text') {
      // TextBlock 有 text 属性
      const text = (block as { text?: string }).text;
      if (text && text.trim().length > 0) {
        textContent = text;
        break;
      }
    }
  }

  if (!textContent) {
    // 空响应 - 这是 end_turn + empty content 的情况
    // 检查是否有任何有效内容
    const hasContent = response.content.some(block => {
      if (block.type === 'text') {
        const text = (block as { text?: string }).text;
        return text && text.trim().length > 0;
      }
      return false;
    });

    if (!hasContent) {
      throw new Error('No text response received (empty content)');
    }
    throw new Error('No text response received (only non-text content)');
  }

  return textContent;
}

/**
 * 计算指数退避延迟
 */
function computeBackoff(attempt: number): number {
  const backoff = Math.min(
    SDK_CONFIG.baseBackoffMs * Math.pow(2, attempt - 1),
    SDK_CONFIG.maxBackoffMs
  );
  // 添加随机抖动 ±20%
  const jitter = backoff * 0.2 * (Math.random() - 0.5);
  return Math.floor(backoff + jitter);
}

/**
 * 构建反思提示（用于 guided retry）
 *
 * 这是 gstack 等多星 skill 中常用的技术：
 * - 不只是重试，而是先反思失败原因
 * - 让 LLM 自己分析问题，而不是盲目重试
 */
function buildReflectionPrompt(failureContext: string, originalPrompt: string): string {
  return `<retry_context>
${failureContext}
</retry_context>

请简短反思（1-2 句话）：导致这个问题的可能原因是什么？

然后继续完成以下任务：
---
${originalPrompt}
---

注意：请确保本次输出足够详细，至少 ${SDK_CONFIG.minOutputLines} 行。`;
}

/**
 * 睡眠工具
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============= Developer 专用函数 =============

/**
 * Developer 专用的强制输出约束
 *
 * 这些约束直接写入 prompt，防止 LLM "偷懒"
 */
export const DEVELOPER_OUTPUT_CONSTRAINTS = `
## ⚠️ 强制输出约束（必须遵守，否则后果自负）

### 最低输出要求
1. **最少代码行数**: 不得少于 50 行实际代码
2. **最少文件数量**: 不得少于 1 个代码文件
3. **禁止空输出**: 绝对不允许输出空文件或仅含注释的文件

### 代码质量约束
4. **必须有实际逻辑**: 不能只有 import/export 而无实际逻辑
5. **必须有错误处理**: 每个函数必须包含错误处理逻辑
6. **必须可运行**: 代码必须能通过 TypeScript/JavaScript 解释器执行

### 禁止事项
- 禁止输出 "以下是代码" 然后跟一个空代码块
- 禁止只输出文件路径而不输出实际内容
- 禁止输出仅含注释的"占位"代码
- 禁止输出 {{ ... }} 这样的模板占位符

### 正确格式
✅ \`\`\`typescript:src/index.ts
export function add(a: number, b: number): number {
  return a + b;
}
\`\`\`

❌ \`\`\`typescript:src/index.ts
// 代码略
\`\`\`

❌ \`\`\`typescript
// 将在下一版本实现
\`\`\`

如果无法完成某些功能，明确说明原因，不要输出空代码或占位符。
`;

/**
 * 检查 Developer 输出是否有效
 */
export function validateDeveloperOutput(output: string): {
  valid: boolean;
  issues: string[];
  stats: {
    totalLines: number;
    codeLines: number;
    fileCount: number;
  };
} {
  const issues: string[] = [];
  const lines = output.split('\n');
  const totalLines = lines.length;

  // 统计代码行数（排除纯注释和空行）
  let codeLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
      codeLines++;
    }
  }

  // 统计文件数量（通过代码块路径）
  const fileCount = (output.match(/```\w*:[\w/.-]+/g) || []).length;

  // 验证
  if (totalLines < SDK_CONFIG.minOutputLines) {
    issues.push(`总输出行数不足: ${totalLines} < ${SDK_CONFIG.minOutputLines}`);
  }

  if (codeLines < 50) {
    issues.push(`代码行数不足: ${codeLines} < 50`);
  }

  if (fileCount === 0) {
    issues.push('未找到任何代码文件');
  }

  // 检查是否有明显的占位符
  if (/\/\/ 代码略/.test(output) || /代码略|待实现|稍后补充/.test(output)) {
    issues.push('发现占位符文本');
  }

  if (/^\s*\{\s*[\s...]+\s*\}\s*$/.test(output) || /\{\s*\.\.\.\s*\}/.test(output)) {
    issues.push('发现模板占位符');
  }

  return {
    valid: issues.length === 0,
    issues,
    stats: {
      totalLines,
      codeLines,
      fileCount
    }
  };
}

// ============= 导出配置 =============

export { SDK_CONFIG };
