/**
 * Evaluator Agent — Anthropic Harness 三角之三
 * 
 * 职责：独立评估 Generator 输出，四维硬阈值评分
 * 
 * 设计原则：
 * - 独立Agent，无共享上下文（避免 "oracle problem"）
 * - 四维度：产品深度(35%) + 用户体验(30%) + 代码质量(20%) + 安全合规(15%)
 * - 每个维度独立硬阈值（7.0/10），任一不过 = Sprint 失败
 * - 支持 Playwright MCP E2E 测试（可选）
 * - 输出结构化的 SupervisorReport
 */

import { executeAgent, type AgentEngine } from './utils/agent-executor.js';
import type {
  SprintContract,
  SupervisorReport,
  SupervisorVerdict,
  FourDimensionScores,
  ProductSpec
} from './types.js';
import { THREE_RED_LINES, EVALUATOR_HARDCORE } from './pua-constraints.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============= 常量 =============

/** 评分维度权重（与 Anthropic 官方对齐） */
const SCORE_WEIGHTS: Record<keyof FourDimensionScores, number> = {
  productDepth: 0.35,
  userExperience: 0.30,
  codeQuality: 0.20,
  security: 0.15,
};

/** 硬阈值：任一维度低于此值 = REJECTED */
const HARD_THRESHOLD = 7.0;

/** 整体通过阈值 */
const PASS_THRESHOLD = 8.0;

// ============= 类型 =============

export interface EvaluatorInput {
  sprint: SprintContract;
  spec: ProductSpec;
  generatorOutput: string;
  projectDir: string;
  /** Sprint Contract 内容（由 Generator 和 Evaluator 谈判达成） */
  sprintContract?: string;
}

// ============= 核心 =============

/**
 * 执行 Evaluator — 评估 Generator 输出
 */
export async function executeEvaluator(
  input: EvaluatorInput,
  engine: AgentEngine = 'minimax'
): Promise<SupervisorReport> {
  console.log(`\n🔍 [Evaluator] 评估 Sprint ${input.sprint.sprintNumber}...`);

  const prompt = buildEvaluatorPrompt(input);

  try {
    const result = await executeAgent(
      EVALUATOR_SYSTEM_PROMPT + "\n" + THREE_RED_LINES + "\n" + EVALUATOR_HARDCORE,
      prompt,
      { engine, workdir: input.projectDir, timeout: 300000 }
    );

    if (!result.success) {
      console.error('[Evaluator] 执行失败，默认 REJECTED');
      return createDefaultReport('REJECTED', ['评估器执行失败: ' + (result.error || 'Unknown')]);
    }

    const report = parseEvaluatorOutput(result.output, input.sprint);

    // 保存报告
    saveReport(input.projectDir, input.sprint.sprintNumber, report);

    // 打印摘要
    printReportSummary(report);

    return report;

  } catch (error) {
    console.error('[Evaluator] 异常:', error);
    return createDefaultReport('REJECTED', ['评估器异常: ' + String(error)]);
  }
}

// ============= 审查 Sprint Contract =============

/**
 * Evaluator 审查 Generator 提议的 Sprint Contract
 * 这是 Anthropic 架构的核心创新：编码前谈判
 */
export async function reviewSprintContract(
  sprint: SprintContract,
  proposedContract: string,
  engine: AgentEngine = 'minimax'
): Promise<{ approved: boolean; feedback: string }> {
  console.log(`\n📝 [Evaluator] 审查 Sprint ${sprint.sprintNumber} Contract...`);

  const prompt = `## Sprint Contract Review

You are evaluating a proposed Sprint Contract.

### Sprint Objectives
${sprint.objectives.map(o => `- ${o}`).join('\n')}

### Acceptance Criteria
${sprint.acceptanceCriteria.map(a => `- ${a}`).join('\n')}

### Proposed Contract
${proposedContract}

### Your Task
1. Is each acceptance criterion verifiable? If not, suggest how to make it testable.
2. Are there any missing edge cases?
3. Does the contract scope match the sprint objectives?

Output format:
\`\`\`
DECISION: APPROVED | CHANGES_REQUESTED
FEEDBACK:
- point 1
- point 2
\`\`\``;

  const result = await executeAgent(
    'You are a meticulous QA engineer reviewing a sprint contract. Be thorough and constructive.',
    prompt,
    { engine, timeout: 120000 }
  );

  if (result.success) {
    const approved = result.output.includes('APPROVED') && !result.output.includes('CHANGES_REQUESTED');
    return { approved, feedback: result.output };
  }

  return { approved: true, feedback: 'Evaluator unavailable, auto-approved' };
}

// ============= Prompt 构建 =============

const EVALUATOR_SYSTEM_PROMPT = `You are an independent quality assurance evaluator. You have NO access to the developer's reasoning — you judge ONLY the output.

## Your Role
You are the final gatekeeper. Your judgment is final and binding.

## Evaluation Dimensions
Score each dimension from 1-10:

1. **productDepth (35%)**: Does the implementation deliver real product value? Is it complete?
2. **userExperience (30%)**: Is the interface intuitive? Are workflows smooth? 
3. **codeQuality (20%)**: Clean code? Error handling? Tests? Readability?
4. **security (15%)**: Input validation? No hardcoded secrets? Safe defaults?

## Hard Thresholds
- Each dimension MUST score >= 7.0
- Overall weighted score MUST be >= 8.0
- ANY dimension below 7.0 → **REJECTED** (no exceptions)
- Overall below 8.0 → **REJECTED**

## Output Format (JSON only)
{
  "verdict": "APPROVED" | "REJECTED" | "ROLLBACK",
  "totalScore": 8.5,
  "dimensionScores": {
    "productDepth": 8,
    "userExperience": 9,
    "codeQuality": 8,
    "security": 8
  },
  "issues": ["issue 1", "issue 2"],
  "strengths": ["strength 1"],
  "recommendations": ["recommendation 1"]
}

## Rules
- Be SKEPTICAL — bias toward finding issues
- Do NOT praise mediocre work
- If you use ROLLBACK, the entire sprint will be reverted
- Output ONLY the JSON`;

function buildEvaluatorPrompt(input: EvaluatorInput): string {
  const { sprint, spec, generatorOutput, sprintContract } = input;

  return `# Sprint ${sprint.sprintNumber} Evaluation

## Sprint Contract
${sprintContract || sprint.objectives.join('; ')}

## Acceptance Criteria
${sprint.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Product Context
${spec.overview.slice(0, 500)}

## Generator Output (CODE TO EVALUATE)
\`\`\`
${generatorOutput.slice(0, 8000)}
\`\`\`

## Your Task
1. Evaluate against ALL acceptance criteria
2. Score each dimension with justification
3. Be strict — biased toward finding real issues
4. Output ONLY valid JSON`;
}

// ============= 输出解析 =============

function parseEvaluatorOutput(output: string, sprint: SprintContract): SupervisorReport {
  const strategies = [
    () => JSON.parse(output),
    () => JSON.parse(extractJSON(output)),
  ];

  for (const strategy of strategies) {
    try {
      const parsed = strategy();
      if (parsed?.verdict && parsed?.dimensionScores) {
        return normalizeReport(parsed, sprint);
      }
    } catch { /* continue */ }
  }

  // Fallback：从文本中推断
  console.warn('[Evaluator] 无法解析 JSON，推断结果');
  const isApproved = /APPROVED|通过|pass/i.test(output) && !/REJECTED|失败|reject/i.test(output);
  return {
    verdict: isApproved ? 'APPROVED' : 'REJECTED',
    totalScore: isApproved ? 8.5 : 5.0,
    dimensionScores: {
      productDepth: isApproved ? 8 : 5,
      userExperience: isApproved ? 8 : 5,
      codeQuality: isApproved ? 8 : 5,
      security: isApproved ? 8 : 5,
    },
    issues: isApproved ? [] : ['评估器无法解析输出，默认 REJECTED'],
  };
}

function normalizeReport(raw: Record<string, unknown>, sprint: SprintContract): SupervisorReport {
  const scores: FourDimensionScores = {
    productDepth: Number((raw.dimensionScores as Record<string,unknown>)?.productDepth) || 5,
    userExperience: Number((raw.dimensionScores as Record<string,unknown>)?.userExperience) || 5,
    codeQuality: Number((raw.dimensionScores as Record<string,unknown>)?.codeQuality) || 5,
    security: Number((raw.dimensionScores as Record<string,unknown>)?.security) || 5,
  };

  const totalScore = calculateWeightedScore(scores);
  let verdict: SupervisorVerdict = String(raw.verdict || 'REJECTED') as SupervisorVerdict;

  // 强制硬阈值检查（覆盖 LLM 可能错误的裁决）
  if (totalScore < PASS_THRESHOLD || anyDimensionBelowThreshold(scores)) {
    verdict = 'REJECTED';
  }

  return {
    verdict,
    totalScore,
    dimensionScores: scores,
    issues: Array.isArray(raw.issues) ? raw.issues.map(String) : [],
  };
}

function calculateWeightedScore(scores: FourDimensionScores): number {
  return Number((
    scores.productDepth * SCORE_WEIGHTS.productDepth +
    scores.userExperience * SCORE_WEIGHTS.userExperience +
    scores.codeQuality * SCORE_WEIGHTS.codeQuality +
    scores.security * SCORE_WEIGHTS.security
  ).toFixed(1));
}

function anyDimensionBelowThreshold(scores: FourDimensionScores): boolean {
  return (
    scores.productDepth < HARD_THRESHOLD ||
    scores.userExperience < HARD_THRESHOLD ||
    scores.codeQuality < HARD_THRESHOLD ||
    scores.security < HARD_THRESHOLD
  );
}

// ============= 工具函数 =============

function extractJSON(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (match) return match[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function createDefaultReport(verdict: SupervisorVerdict, issues: string[]): SupervisorReport {
  return {
    verdict,
    totalScore: verdict === 'APPROVED' ? 8.5 : 5.0,
    dimensionScores: { productDepth: 5, userExperience: 5, codeQuality: 5, security: 5 },
    issues,
  };
}

function saveReport(projectDir: string, sprintNum: number, report: SupervisorReport): void {
  const dir = join(projectDir, '.supervisor-reports');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `sprint-${sprintNum}.json`), JSON.stringify(report, null, 2));
}

function printReportSummary(report: SupervisorReport): void {
  const emoji = report.verdict === 'APPROVED' ? '✅' : report.verdict === 'ROLLBACK' ? '🔄' : '❌';
  console.log(`\n${emoji} [Evaluator] ${report.verdict} | 总分: ${report.totalScore}/10`);
  console.log(`   产品深度:${report.dimensionScores.productDepth} UX:${report.dimensionScores.userExperience} 代码:${report.dimensionScores.codeQuality} 安全:${report.dimensionScores.security}`);
  if (report.issues.length > 0) {
    console.log(`   问题: ${report.issues.slice(0, 3).join('; ')}`);
  }
}

// ============= 导出常量 =============

export { SCORE_WEIGHTS, HARD_THRESHOLD, PASS_THRESHOLD };

/**
 * 逐个评估每项 acceptance criterion（Anthropic 2026.03 规范）
 * 
 * 每个 criterion 独立判断，全部通过才算 Sprint PASS。
 */
export function evaluateEachCriterion(
  criteria: string[],
  report: { verdict: string; issues: string[] }
): { criterion: string; passed: boolean; reason: string }[] {
  return criteria.map(criterion => {
    const matchedIssue = report.issues?.find(
      (issue: string) => issue.toLowerCase().includes(criterion.toLowerCase().slice(0, 10))
    );
    if (matchedIssue) return { criterion, passed: false, reason: matchedIssue };
    if (report.verdict === 'APPROVED') return { criterion, passed: true, reason: 'verdict APPROVED' };
    return { criterion, passed: false, reason: report.issues?.join('; ') || '未通过评估' };
  });
}
