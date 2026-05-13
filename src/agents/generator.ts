/**
 * Generator Agent — 认领任务 → 写代码 → CodeExecutor
 * 
 * 流程:
 *   1. 从 TaskDAG 认领一个 ready 任务
 *   2. 执行前搜索记忆（上次怎么失败的？）
 *   3. 生成代码
 *   4. CodeExecutor 提取代码→写盘→运行→收集证据
 *   5. 执行后写入记忆（这次成功/失败了？）
 */

import { TaskDAG, type Task } from '../core/task-dag.js';
import { agentLoop, agentCall } from '../core/agent-loop.js';
import { THREE_RED_LINES, OWNER_FOUR_QUESTIONS } from '../constraints/pua.js';
import { AgentMemory } from '../core/memory.js';
import type { AgentEngine } from '../utils/agent-executor.js';

// ============ System Prompt ============

const GENERATOR_PROMPT = `你是全栈开发者。你从 TaskDAG 认领任务，实现代码，直到 CodeExecutor 验证通过。

## 规则
1. 只实现当前任务——不碰其他文件
2. 每个函数包含错误处理
3. 核心逻辑写单元测试
4. 完成后输出 TASK_COMPLETE

## Tech Stack
使用项目中已有的技术栈。如果没有，默认 TypeScript + Vitest。

## 输出格式
\`\`\`typescript:src/file.ts
// code
\`\`\`

${THREE_RED_LINES}
${OWNER_FOUR_QUESTIONS}`;

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
      .map(r => `- ${r.entry.content}`).join('\n');
    console.log(`  📝 记忆: ${pastFailures.length} 条相关记录`);
  }

  // 3. 执行 Agent Loop（最多 10 次重试）
  let finalOutput = '';
  let evidence = '';

  for (let attempt = 1; attempt <= 10; attempt++) {
    const prompt = `# Task #${task.id}: ${task.subject}
${task.description}

## 验收标准
${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}
${memoryContext}
${attempt > 1 ? `\n## 🔧 上次问题（第${attempt-1}次失败）\n${evidence}` : ''}

请实现并输出代码。`;

    const result = await agentLoop(prompt, {
      engine,
      systemPrompt: GENERATOR_PROMPT,
      maxIterations: 30,
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

      if (execEvidence.test?.success || execEvidence.build?.success || execEvidence.typeCheck?.success) {
        console.log(`  ✅ [Generator] 代码验证通过`);
        return {
          success: true,
          output: finalOutput,
          evidence,
          filesCreated: execEvidence.filesExtracted.map((f: {filepath: string}) => f.filepath),
        };
      }

      console.log(`  ❌ [Generator] 代码验证失败，第${attempt}次重试`);
    } catch (err) {
      evidence = `CodeExecutor 错误: ${err}`;
    }
  }

  // 5. 记录失败到记忆
  memory.put({
    namespace: 'global',
    type: 'anti_pattern',
    content: `Generator Task #${task.id} "${task.subject}" failed after 10 attempts. Last error: ${evidence.slice(0, 200)}`,
    metadata: { taskId: task.id, taskSubject: task.subject },
    score: 0.9,
  });

  return { success: false, output: finalOutput, evidence, filesCreated: [] };
}
