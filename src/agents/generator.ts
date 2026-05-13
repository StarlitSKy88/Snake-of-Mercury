/**
 * Generator Agent — TDD: RED→GREEN→REFACTOR → CodeExecutor
 * 
 * Google Agent Skills 式 TDD 循环:
 *   1. RED:   先写测试（预期失败）
 *   2. GREEN: 写最小代码使测试通过
 *   3. REFACTOR: 重构优化
 *   4. CodeExecutor 验证 → 收集证据
 * 
 * 重试策略: 最多 5 次（TDD 减少无效重试）
 */

import { TaskDAG, type Task } from '../core/task-dag.js';
import { agentLoop } from '../core/agent-loop.js';
import { THREE_RED_LINES, OWNER_FOUR_QUESTIONS, RATIONALIZATIONS, RED_FLAGS } from '../constraints/pua.js';
import { AgentMemory } from '../core/memory.js';
import type { AgentEngine } from '../utils/agent-executor.js';

// ============ System Prompt ============

const GENERATOR_PROMPT = `你是全栈开发者，遵循 TDD (测试驱动开发)。

## TDD 循环 (必须遵守)
1. RED:   先写测试 → 确认测试失败（证明测试有效）
2. GREEN: 写最小代码使测试通过 → 确认测试通过
3. REFACTOR: 重构优化 → 确认测试仍然通过
4. 输出 TASK_COMPLETE

## 规则
- 每次实现前先搜索记忆（上次怎么失败的？）
- 每个函数包含错误处理
- 测试是唯一裁判 — 通过才算完成
- 不要跳过测试直接写实现代码
- 最多改 ~5 个文件

## Tech Stack
TypeScript + Vitest (测试). HTML + Canvas (前端).

## 输出格式
\`\`\`typescript:src/file.test.ts
// 测试先 (RED)
\`\`\`

\`\`\`typescript:src/file.ts
// 实现后 (GREEN)
\`\`\`

\`\`\`html:index.html
<!-- 前端代码 -->
\`\`\`

${THREE_RED_LINES}
${OWNER_FOUR_QUESTIONS}
${RATIONALIZATIONS}
${RED_FLAGS}`;

// ============ 核心 ============

export interface GeneratorResult {
  success: boolean;
  output: string;
  evidence: string;
  filesCreated: string[];
}

export async function generate(
  task: Task,
  projectDir: string,
  dag: TaskDAG,
  memory: AgentMemory,
  engine: AgentEngine = 'minimax'
): Promise<GeneratorResult> {
  // 1. 认领任务
  dag.update(task.id, { status: 'in_progress', owner: 'generator' });
  console.log(`\n💻 [Generator] Task #${task.id}: ${task.subject}`);

  // 2. 搜索记忆
  const pastFailures = memory.search(
    `Task ${task.subject} failed generator`,
    'global',
    3
  );
  let memoryContext = '';
  if (pastFailures.length > 0) {
    memoryContext = '\n## ⚠️ 历史教训\n' + pastFailures
      .map(r => `- ${r.entry.content.slice(0, 200)}`).join('\n');
    console.log(`  📝 记忆: ${pastFailures.length} 条相关记录`);
  }

  // 3. TDD 循环 (最大 5 次，因为 TDD 减少试错)
  const MAX_ATTEMPTS = 5;
  let finalOutput = '';
  let evidence = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const tddStep = attempt === 1 ? 'RED' : (attempt <= 3 ? 'GREEN/REFACTOR' : '修复');

    const prompt = `# Task #${task.id}: ${task.subject}
${task.description}

## 验收标准（逐一实现）
${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}
${memoryContext}

## TDD 当前阶段: ${tddStep}
${attempt === 1 ? '先写测试 (RED)，确认测试失败。' : ''}
${attempt > 1 ? `\n## 🔧 上次问题（第${attempt - 1}次）\n${evidence}` : ''}

请按 TDD 循环实现。先写测试，再写代码。`;

    const result = await agentLoop(prompt, {
      engine,
      systemPrompt: GENERATOR_PROMPT,
      maxIterations: 20,
    });

    finalOutput = result.output;

    if (!result.success) {
      evidence = `Generator 执行失败（第${attempt}次）: ${result.error}`;
      continue;
    }

    // 4. CodeExecutor: 提取代码 → 写盘 → 运行 → 收集证据
    try {
      const { executeCode, formatEvidenceForEvaluator } = await import('../executors/code-executor.js');
      const execEvidence = await executeCode(finalOutput, projectDir);
      evidence = formatEvidenceForEvaluator(execEvidence);

      // 检查 Generator 输出是否有 Rationalizations
      const rationalizationCheck = checkRationalizations(finalOutput);
      if (rationalizationCheck.found) {
        console.log(`  ⚠️  检测到借口: "${rationalizationCheck.match}" → 自动拒绝`);
        evidence += `\n\n## ⚠️ 反合理化检测\nGenerator 使用了借口: "${rationalizationCheck.match}"\n自动 REJECTED — 请重新实现。`;
        continue;
      }

      if (execEvidence.test?.success || execEvidence.build?.success || execEvidence.typeCheck?.success) {
        console.log(`  ✅ [Generator] TDD 验证通过 (第${attempt}次)`);
        return {
          success: true,
          output: finalOutput,
          evidence,
          filesCreated: execEvidence.filesExtracted.map((f: {filepath: string}) => f.filepath),
        };
      }

      console.log(`  ❌ [Generator] 验证失败，TDD 第${attempt}次重试`);
    } catch (err) {
      evidence = `CodeExecutor 错误: ${err}`;
    }
  }

  // 5. 记录失败到记忆
  memory.put({
    namespace: 'global',
    type: 'anti_pattern',
    content: `Generator Task #${task.id} "${task.subject}" failed after ${MAX_ATTEMPTS} attempts. Last: ${evidence.slice(0, 200)}`,
    metadata: { taskId: task.id, taskSubject: task.subject },
    score: 0.9,
  });

  return { success: false, output: finalOutput, evidence, filesCreated: [] };
}

// ============ 反合理化检测 ============

interface RationalizationResult {
  found: boolean;
  match: string;
}

function checkRationalizations(output: string): RationalizationResult {
  const patterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /稍后补.*测试|测试.*稍后|后面.*加.*测试|等.*再.*测试/i, label: '"稍后补测试"' },
    { pattern: /太简单.*不需要.*测试|简单.*不用.*测试|这.*简单.*测/i, label: '"太简单不需要测试"' },
    { pattern: /手动.*测试.*过|我已经.*测.*过|本地.*跑.*过/i, label: '"手动测试过了"' },
    { pattern: /看起来.*没问题|看起来.*正确|看上去.*对|应该.*没问题|可能.*没问题/i, label: '"看起来没问题"' },
    { pattern: /快速实现(?!.*测试)|快速完成.*功能|先写代码(?!.*测试)|先写业务|后面再优化|先上线再/i, label: '"先快速实现再优化"' },
    { pattern: /这次.*先.*跳过|跳过.*测试|忽略.*测试|暂时.*不.*写/i, label: '"跳过测试"' },
    { pattern: /代码.*自解释|自.*文档|不用.*注释/i, label: '"代码自解释"' },
  ];

  for (const { pattern, label } of patterns) {
    const match = output.match(pattern);
    if (match) {
      return { found: true, match: `${label}: "${match[0]}"` };
    }
  }

  return { found: false, match: '' };
}
