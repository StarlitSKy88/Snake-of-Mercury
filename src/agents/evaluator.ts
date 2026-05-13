/**
 * Evaluator Agent — 只看证据，不看原始代码
 * 
 * v5: 
 *   - P0-3: 证据上下文隔离 — validateEvidence() 拒绝含原始代码的证据
 *   - P0-4: 验收标准预检有 FAIL → 立即 REJECTED
 *   - P0-1: 假成功检测集成
 */

import { TaskDAG, type Task } from '../core/task-dag.js';
import { agentCall } from '../core/agent-loop.js';
import { THREE_RED_LINES, EVALUATOR_HARDCORE, RATIONALIZATIONS, RED_FLAGS } from '../constraints/pua.js';
import { AgentMemory } from '../core/memory.js';
import { isFalseSuccess } from '../core/done-sequence.js';
import { validateEvidence, sanitizeEvidence } from '../core/evidence-guard.js';
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
- 证据含原始代码 → 自动 REJECTED (上下文污染)

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

export async function evaluate(
  task: Task,
  evidence: string,
  dag: TaskDAG,
  memory: AgentMemory,
  engine: AgentEngine = 'minimax'
): Promise<EvaluatorReport> {
  console.log(`\n🔍 [Evaluator] Task #${task.id}: ${task.subject}`);

  // v5 P0-3: 证据上下文隔离检查
  const evidenceCheck = validateEvidence(evidence);
  if (!evidenceCheck.valid) {
    console.log(`  🚫 证据上下文污染: ${evidenceCheck.reason}`);
    const report = createRejectedReport([
      `上下文隔离失败: ${evidenceCheck.reason}`,
      evidenceCheck.hasRawCodeBlocks ? '证据含原始代码块 → Generator 输出未被过滤' : '',
      !evidenceCheck.hasCodeExecutorSignature ? '缺失 CodeExecutor 签名 → Generator 可能跳过了执行' : '',
    ].filter(Boolean));
    dag.update(task.id, { status: 'failed', evidence });
    memory.put({
      namespace: String(task.id),
      type: 'anti_pattern',
      content: `Task #${task.id} REJECTED by context isolation: ${evidenceCheck.reason}`,
      score: 1.0,
    });
    return report;
  }

  // v5 P0-3: 净化证据（剥离可能的代码残留）
  const sanitized = sanitizeEvidence(evidence);
  const effectiveEvidence = sanitized !== evidence ? sanitized : evidence;
  if (sanitized !== evidence) {
    console.log(`  🧹 证据已净化（剥离代码残留）`);
  }

  // 0. Red Flags 快速检测
  const redFlag = checkRedFlags(effectiveEvidence, task);
  if (redFlag.found) {
    console.log(`  🚩 Red Flag: ${redFlag.reason}`);
    const report = createRejectedReport([redFlag.reason]);
    dag.update(task.id, { status: 'failed', evidence: effectiveEvidence });
    memory.put({
      namespace: String(task.id),
      type: 'anti_pattern',
      content: `Task #${task.id} REJECTED by Red Flag: ${redFlag.reason}`,
      score: 1.0,
    });
    return report;
  }

  // v5 P0-4: 验收标准预检
  const criteriaCheck = checkCriteria(task, effectiveEvidence);
  if (criteriaCheck.hasFailures) {
    const issues = [
      `验收标准预检: ${criteriaCheck.failCount}/${task.acceptanceCriteria.length} FAIL`,
      ...criteriaCheck.failedCriteria.map(c => `  - ${c}`),
    ];
    console.log(`  🚩 验收标准预检 FAIL → 立即 REJECTED (跳过 LLM)`);
    const report = createRejectedReport(issues);
    report.criteriaCheck = criteriaCheck.details;
    dag.update(task.id, { status: 'failed', evidence: effectiveEvidence });
    memory.put({
      namespace: String(task.id),
      type: 'anti_pattern',
      content: `Task #${task.id} REJECTED by criteria pre-check: ${criteriaCheck.failCount} FAIL`,
      metadata: { taskId: task.id, failedCriteria: criteriaCheck.failedCriteria },
      score: 0.95,
    });
    return report;
  }

  // 1. 假成功检测
  const falseSuccess = isFalseSuccess(effectiveEvidence);
  if (falseSuccess.found) {
    console.log(`  ⚠️ 证据含假成功模式: "${falseSuccess.pattern}"`);
    const report = createRejectedReport([`假成功: 证据含 "${falseSuccess.pattern}"，不可信`]);
    dag.update(task.id, { status: 'failed', evidence: effectiveEvidence });
    return report;
  }

  // 2. LLM 评估
  console.log(`  ✅ 预检通过，进入 LLM 评估`);
  const prompt = `# Task #${task.id}: ${task.subject}

## 验收标准（预检全部通过）
${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c} ✅`).join('\n')}

${effectiveEvidence}

请五维评分。`;

  let output: string;
  try {
    output = await agentCall(EVALUATOR_PROMPT, prompt, engine);
  } catch {
    memory.put({
      namespace: String(task.id),
      type: 'anti_pattern',
      content: `Evaluator unavailable for Task #${task.id}`,
    });
    return createRejectedReport(['Evaluator 不可用']);
  }

  // 3. 解析 JSON
  let report: EvaluatorReport;
  try {
    const jsonMatch = output.match(/```json\s*([\s\S]*?)```/) || output.match(/(\{[\s\S]*\})/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[1]) : JSON.parse(output);
    report = normalizeReport(parsed);
  } catch {
    report = createRejectedReport(['Evaluator JSON 解析失败']);
  }

  // 4. 兜底
  if (report.verdict === 'APPROVED' && (report.dimensionScores.testCoverage || 0) === 0) {
    report.verdict = 'REJECTED';
    report.issues.push('Red Flag: 无测试但声称通过');
  }

  // 5. 更新状态
  if (report.verdict === 'APPROVED') {
    dag.update(task.id, { status: 'completed', evidence: effectiveEvidence });
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

// ═══════════ Red Flags ═══════════

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

// ═══════════ 验收标准预检 ═══════════

interface CriteriaCheckResult {
  hasFailures: boolean;
  failCount: number;
  passCount: number;
  failedCriteria: string[];
  details: Array<{ criterion: string; passed: boolean; evidence: string }>;
}

function checkCriteria(task: Task, evidence: string): CriteriaCheckResult {
  const details: Array<{ criterion: string; passed: boolean; evidence: string }> = [];
  const failedCriteria: string[] = [];

  for (const criterion of task.acceptanceCriteria) {
    const keyword = criterion.slice(0, 30).replace(/[.*+?^${}()|[\]\\"'`]/g, '');
    const passPattern = new RegExp(keyword + '.*?(PASS|✅|✓|通过)', 'i');
    const failPattern = new RegExp(keyword + '.*?(FAIL|❌|✗|失败)', 'i');
    
    let passed = false;
    let found = '';
    
    if (passPattern.test(evidence)) {
      passed = true;
      found = evidence.match(passPattern)?.[0] || 'PASS 证据已找到';
    } else if (failPattern.test(evidence)) {
      found = evidence.match(failPattern)?.[0] || 'FAIL 证据已找到';
    } else if (new RegExp(keyword, 'i').test(evidence)) {
      found = '关键词存在但状态不明确 → FAIL';
    } else {
      found = '证据中未找到对应验证 → FAIL';
    }

    details.push({ criterion: criterion.slice(0, 60), passed, evidence: found });
    if (!passed) failedCriteria.push(criterion.slice(0, 60));
  }

  return {
    hasFailures: failedCriteria.length > 0,
    failCount: failedCriteria.length,
    passCount: details.length - failedCriteria.length,
    failedCriteria,
    details,
  };
}

// ═══════════ 工具函数 ═══════════

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

function createRejectedReport(issues: string[]): EvaluatorReport {
  return {
    verdict: 'REJECTED',
    totalScore: 4.0,
    dimensionScores: { productDepth: 5, userExperience: 5, codeQuality: 5, testCoverage: 0, security: 5 },
    issues,
    criteriaCheck: [],
  };
}
