/**
 * Evaluator Agent — 只看证据，不看原始代码
 * 
 * v4: 上下文隔离。Evaluator 不接收 Generator 原始输出，
 *     只看 CodeExecutor 收集的结构化证据 + 验收标准。
 */

import { TaskDAG, type Task } from '../core/task-dag.js';
import { agentCall } from '../core/agent-loop.js';
import { THREE_RED_LINES, EVALUATOR_HARDCORE, RATIONALIZATIONS, RED_FLAGS } from '../constraints/pua.js';
import { AgentMemory } from '../core/memory.js';
import type { AgentEngine } from '../utils/agent-executor.js';

const EVALUATOR_PROMPT = `你是独立质量评估师。你只看到 CodeExecutor 的实际执行证据，看不到原始代码。

## 你的信息来源（仅此两份）
1. **验收标准** — Task 定义中的 acceptanceCriteria
2. **CodeExecutor 证据** — 包含：文件列表、验证结果、验收标准逐条状态、模块深度评分

## 评估五维度
1. productDepth (25%): 验收标准全满足？
2. userExperience (20%): 证据显示交互完整？
3. codeQuality (20%): 模块深度合理？文件数量恰当？
4. testCoverage (20%): 有测试证据？
5. security (15%): 无明显安全漏洞？

## 硬阈值
- 每维度 >= 6.0
- 总分 >= 7.5
- testCoverage = 0 → 自动 REJECTED
- 验收标准有 FAIL → 自动 REJECTED

## 评估方法
1. 对每条验收标准: 在证据中找对应的 PASS/FAIL
2. 找不到对应证据 → 标注 "证据缺失" → FAIL
3. 五维度评分基于证据，不基于猜测
4. 最终裁决

## Red Flags (检测到 → 立即 REJECTED)
- 验收标准有 FAIL 或 "证据缺失" → REJECTED
- 无 CodeExecutor 证据 → REJECTED
- "看起来没问题" 表述 → REJECTED

${THREE_RED_LINES}
${EVALUATOR_HARDCORE}
${RATIONALIZATIONS}
${RED_FLAGS}

## 输出（JSON only）
{
  "verdict": "APPROVED" | "REJECTED",
  "totalScore": 8.5,
  "dimensionScores": {"productDepth":8,"userExperience":9,"codeQuality":8,"testCoverage":7,"security":8},
  "issues": ["具体可操作问题"],
  "criteriaCheck": [{"criterion":"xxx","passed":true,"evidence":"CodeExecutor显示..."}]
}`;

export interface EvaluatorReport {
  verdict: 'APPROVED' | 'REJECTED';
  totalScore: number;
  dimensionScores: Record<string, number>;
  issues: string[];
  criteriaCheck: Array<{ criterion: string; passed: boolean; evidence: string }>;
}

// ═══════════ v4: 只接收 evidence，不接收 generatorOutput ═══════════

export async function evaluate(
  task: Task,
  evidence: string,
  dag: TaskDAG,
  memory: AgentMemory,
  engine: AgentEngine = 'minimax'
): Promise<EvaluatorReport> {
  console.log(`\n🔍 [Evaluator] Task #${task.id}: ${task.subject}`);

  // 0. Red Flags 快速检测
  const redFlag = checkRedFlags(evidence, task);
  if (redFlag.found) {
    console.log(`  🚩 Red Flag: ${redFlag.reason}`);
    const report = createDefaultReport('REJECTED', [redFlag.reason]);
    dag.update(task.id, { status: 'failed', evidence });
    memory.put({
      namespace: String(task.id),
      type: 'anti_pattern',
      content: `Task #${task.id} REJECTED by Red Flag: ${redFlag.reason}`,
      score: 1.0,
    });
    return report;
  }

  // 1. 先检查证据中验收标准的逐条状态（不等 LLM）
  const criteriaPreCheck = preCheckCriteria(task, evidence);
  if (criteriaPreCheck.hasFailures) {
    console.log(`  🚩 验收标准预检: ${criteriaPreCheck.failCount} FAIL`);
  }

  // 2. LLM 评估（只传证据）
  const prompt = `# Task #${task.id}: ${task.subject}

## 验收标准
${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${evidence}

请逐条验收标准检查并五维评分。`;

  let output: string;
  try {
    output = await agentCall(EVALUATOR_PROMPT, prompt, engine);
  } catch {
    memory.put({
      namespace: String(task.id),
      type: 'anti_pattern',
      content: `Evaluator unavailable for Task #${task.id}`,
    });
    return createDefaultReport('REJECTED', ['Evaluator 不可用']);
  }

  // 3. 解析 JSON
  let report: EvaluatorReport;
  try {
    const jsonMatch = output.match(/```json\s*([\s\S]*?)```/) || output.match(/(\{[\s\S]*\})/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[1]) : JSON.parse(output);
    report = normalizeReport(parsed);
  } catch {
    const approved = /APPROVED|通过/i.test(output) && !/REJECTED|失败/i.test(output);
    report = createDefaultReport(
      approved ? 'APPROVED' : 'REJECTED',
      approved ? [] : ['Evaluator JSON 解析失败']
    );
  }

  // 4. 兜底: testCoverage=0 但 APPROVED → 强制 REJECTED
  if (report.verdict === 'APPROVED' && (report.dimensionScores.testCoverage || 0) === 0) {
    report.verdict = 'REJECTED';
    report.issues.push('Red Flag: 无测试但声称通过');
  }

  // 5. 兜底: 验收标准预检有 FAIL 但 LLM 说 APPROVED → 强制 REJECTED
  if (report.verdict === 'APPROVED' && criteriaPreCheck.hasFailures) {
    report.verdict = 'REJECTED';
    report.issues.push('预检: 验收标准有 FAIL，LLM 评估可能有误');
  }

  // 6. 更新 Task 状态
  if (report.verdict === 'APPROVED') {
    dag.update(task.id, { status: 'completed', evidence });
    console.log(`  ✅ APPROVED (${report.totalScore}/10)`);
    memory.put({
      namespace: String(task.id),
      type: 'pattern',
      content: `Task #${task.id} PASSED (${report.totalScore}/10). ${report.issues.length} issues.`,
      metadata: { taskId: task.id, scores: report.dimensionScores },
      score: 0.5,
    });
  } else {
    console.log(`  ❌ REJECTED (${report.totalScore}/10)`);
    console.log(`  问题: ${report.issues.slice(0, 3).join('; ')}`);
    memory.put({
      namespace: String(task.id),
      type: 'anti_pattern',
      content: `Task #${task.id} REJECTED. Issues: ${report.issues.slice(0, 3).join('; ')}`,
      metadata: { taskId: task.id, scores: report.dimensionScores },
      score: 0.9,
    });
  }

  return report;
}

// ═══════════ 预检 ═══════════

function checkRedFlags(evidence: string, task: Task): { found: boolean; reason: string } {
  if (!evidence || evidence.length < 50) {
    return { found: true, reason: 'Red Flag: 无 CodeExecutor 证据' };
  }
  if (/看起来.*没问题|应该.*正常|probably.*fine/i.test(evidence)) {
    return { found: true, reason: 'Red Flag: "看起来没问题" 表述' };
  }
  const hasTest = /test.*[✅✓]|测试.*通过|✅.*test/i.test(evidence);
  const hasBuild = /build.*[✅✓]|验证.*通过|✅.*验证/i.test(evidence);
  if (!hasTest && !hasBuild) {
    return { found: true, reason: 'Red Flag: 无测试/构建通过证据' };
  }
  return { found: false, reason: '' };
}

/** 验收标准预检：在证据中搜索 PASS/FAIL 状态 */
function preCheckCriteria(task: Task, evidence: string): { hasFailures: boolean; failCount: number } {
  let failCount = 0;
  for (const criterion of task.acceptanceCriteria) {
    const keyword = criterion.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '');
    const pattern = new RegExp(keyword + '.*[❌FAIL]|FAIL.*' + keyword, 'i');
    if (pattern.test(evidence)) failCount++;
  }
  return { hasFailures: failCount > 0, failCount };
}

function normalizeReport(raw: Record<string, any>): EvaluatorReport {
  const scores = raw.dimensionScores || {};
  return {
    verdict: raw.verdict || 'REJECTED',
    totalScore: Number(raw.totalScore) || 5.0,
    dimensionScores: {
      productDepth: Number(scores.productDepth) || 5,
      userExperience: Number(scores.userExperience) || 5,
      codeQuality: Number(scores.codeQuality) || 5,
      testCoverage: Number(scores.testCoverage) || (scores.security ? 5 : 0),
      security: Number(scores.security) || 5,
    },
    issues: Array.isArray(raw.issues) ? raw.issues : [],
    criteriaCheck: Array.isArray(raw.criteriaCheck) ? raw.criteriaCheck : [],
  };
}

function createDefaultReport(verdict: 'APPROVED' | 'REJECTED', issues: string[]): EvaluatorReport {
  return {
    verdict,
    totalScore: verdict === 'APPROVED' ? 8.0 : 4.0,
    dimensionScores: { productDepth: 5, userExperience: 5, codeQuality: 5, testCoverage: 0, security: 5 },
    issues,
    criteriaCheck: [],
  };
}
