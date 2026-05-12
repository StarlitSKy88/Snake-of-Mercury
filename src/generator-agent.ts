/**
 * Generator Agent — Anthropic Harness 三角之二
 * 
 * 职责：按 Sprint 逐个实现功能
 * 
 * 设计原则：
 * - 每次只做一个功能（one feature at a time）
 * - 编码前与 Evaluator 谈判 Sprint Contract
 * - 自评后再提交给 Evaluator
 * - Git 版本控制 + 进度文件
 * - 引擎无关（通过 agent-executor 统一调用）
 */

import { executeAgent, execCommand, type AgentEngine } from './utils/agent-executor.js';
import type { SprintContract, ProductSpec } from './types.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============= 类型 =============

export interface GeneratorInput {
  sprint: SprintContract;
  spec: ProductSpec;
  projectDir: string;
  previousIssues?: string[];
  sprintContract?: string;
}

export interface GeneratorOutput {
  success: boolean;
  output: string;
  filesCreated: string[];
  selfEvalScore: number;
}

// ============= 核心 =============

/**
 * 执行 Generator — 实现一个 Sprint
 */
export async function executeGenerator(
  input: GeneratorInput,
  engine: AgentEngine = 'minimax'
): Promise<GeneratorOutput> {
  const sprint = input.sprint;
  console.log(`\n💻 [Generator] Sprint ${sprint.sprintNumber}: ${sprint.objectives[0]}`);

  const prompt = buildGeneratorPrompt(input);

  try {
    const result = await executeAgent(
      PUA_GENERATOR_PROMPT,
      prompt,
      { engine, workdir: input.projectDir, timeout: 600000 }
    );

    if (!result.success) {
      return { success: false, output: result.output || '', filesCreated: [], selfEvalScore: 0 };
    }

    // 记录生成的文件
    const filesCreated = extractFileList(result.output);

    // 自评
    const selfEvalScore = selfEvaluate(result.output);

    // 写入进度文件
    writeProgress(input.projectDir, sprint, result.success, selfEvalScore);

    console.log(`[Generator] ✅ 完成: ${filesCreated.length} 文件, 自评 ${selfEvalScore}/10`);
    return { success: true, output: result.output, filesCreated, selfEvalScore };

  } catch (error) {
    console.error('[Generator] 异常:', error);
    return { success: false, output: String(error), filesCreated: [], selfEvalScore: 0 };
  }
}

// ============= Sprint Contract 谈判 =============

/**
 * Sprint Contract 谈判
 * Generator 提议 "什么算完成"，用户确认
 */
export async function negotiateSprintContract(
  sprint: SprintContract,
  spec: ProductSpec,
  engine: AgentEngine = 'minimax'
): Promise<string> {
  console.log(`\n🤝 [Contract] 谈判 Sprint ${sprint.sprintNumber}...`);

  const prompt = `## Sprint Contract Negotiation

You are negotiating the definition of "done" for Sprint ${sprint.sprintNumber}.

### Sprint Objectives
${sprint.objectives.map(o => `- ${o}`).join('\n')}

### Acceptance Criteria (initial)
${sprint.acceptanceCriteria.map(a => `- ${a}`).join('\n')}

### Product Context
${spec.overview}

### Your Task
Propose a concrete Sprint Contract that defines:
1. What exactly will be delivered
2. How each acceptance criterion will be verified
3. What the working demo should look like
4. Edge cases to handle

Respond in a clear, structured markdown format. This will be reviewed by the Evaluator.`;

  const result = await executeAgent(
    'You are a pragmatic developer negotiating a sprint contract. Be specific, realistic, and testable.',
    prompt,
    { engine, timeout: 120000 }
  );

  return result.success ? result.output : JSON.stringify(sprint);
}

// ============= Prompt 构建 =============

const GENERATOR_SYSTEM_PROMPT = `You are an expert full-stack developer working in a structured harness system.

## Rules
1. Implement ONLY what's in the current sprint — no scope creep
2. Write clean, production-quality code
3. Include error handling in every function
4. Write unit tests for core logic
5. Use git for version control
6. After implementing, self-evaluate your work before handing off

## Tech Stack (default)
- TypeScript (strict mode)
- Vitest for testing
- Keep it simple — no unnecessary abstractions

## Output Format
For each file, use this format:
\`\`\`typescript:src/filename.ts
// code here
\`\`\`

## Self-Evaluation
At the end, include a self-evaluation:
\`\`\`
SELF-EVAL: X/10
Strengths: ...
Weaknesses: ...
\`\`\`

## DO NOT
- Skip error handling
- Leave TODO comments
- Use placeholder code
- Implement features outside the current sprint`;


import { THREE_RED_LINES, OWNER_FOUR_QUESTIONS } from './pua-constraints.js';

const PUA_GENERATOR_PROMPT = GENERATOR_SYSTEM_PROMPT + "\n" + THREE_RED_LINES + "\n" + OWNER_FOUR_QUESTIONS;
// Replace original with PUA-enhanced version
function buildGeneratorPrompt(input: GeneratorInput): string {
  const { sprint, spec, previousIssues, sprintContract } = input;

  let prompt = `# Sprint ${sprint.sprintNumber} Implementation Task

## Product Context
${spec.overview}

## Sprint Contract
${sprintContract || 'Implement the sprint objectives and meet all acceptance criteria.'}

## Objectives
${sprint.objectives.map(o => `- ${o}`).join('\n')}

## Acceptance Criteria
${sprint.acceptanceCriteria.map(c => `- [ ] ${c}`).join('\n')}

## Technical Constraints
${sprint.technicalConstraints.length > 0 ? sprint.technicalConstraints.map(c => `- ${c}`).join('\n') : 'None specified'}`;

  if (previousIssues?.length) {
    prompt += `\n\n## Previous Issues to Fix\n${previousIssues.map(i => `- ${i}`).join('\n')}`;
  }

  prompt += `\n\n## Instructions
1. Implement ALL objectives for this sprint
2. Write unit tests for core logic
3. Self-evaluate before completing
4. Use the file output format: \`\`\`typescript:path/to/file.ts`;

  return prompt;
}

// ============= 辅助函数 =============

function extractFileList(output: string): string[] {
  const matches = output.matchAll(/```\w+:([^\n]+)/g);
  return [...matches].map(m => m[1].trim());
}

function selfEvaluate(output: string): number {
  const match = output.match(/SELF-EVAL:\s*(\d+)/i);
  return match ? Math.min(10, Math.max(1, parseInt(match[1]))) : 7;
}

function writeProgress(
  projectDir: string,
  sprint: SprintContract,
  success: boolean,
  score: number
): void {
  const progressDir = join(projectDir, '.sprint-output');
  mkdirSync(progressDir, { recursive: true });
  const file = join(progressDir, `sprint-${sprint.sprintNumber}`, 'progress.json');
  mkdirSync(join(progressDir, `sprint-${sprint.sprintNumber}`), { recursive: true });
  writeFileSync(file, JSON.stringify({
    sprintNumber: sprint.sprintNumber,
    objectives: sprint.objectives,
    completed: success,
    selfEvalScore: score,
    timestamp: new Date().toISOString(),
  }, null, 2));
}

/**
 * 结构化自验（Anthropic Article 1.6）
 * 
 * Generator 输出代码后，逐条对照 acceptance criteria 自检。
 * 全部通过才提交给 Evaluator；否则自动修复。
 */
export function selfVerify(
  acceptanceCriteria: string[],
  generatedOutput: string
): { allPassed: boolean; results: { criterion: string; passed: boolean; note: string }[] } {
  const results = acceptanceCriteria.map(criterion => {
    const lcOut = generatedOutput.toLowerCase();
    const lcCrit = criterion.toLowerCase();
    // 简单检查：输出中是否包含与 criterion 相关的关键词
    const keywords = lcCrit.split(/\s+/).filter(w => w.length > 3);
    const matched = keywords.filter(kw => lcOut.includes(kw));
    const passed = matched.length >= Math.ceil(keywords.length * 0.5);
    return {
      criterion,
      passed,
      note: passed ? `关键词匹配 ${matched.length}/${keywords.length}` : `缺失关键词: ${keywords.filter(kw => !lcOut.includes(kw)).join(', ')}`,
    };
  });

  return { allPassed: results.every(r => r.passed), results };
}
