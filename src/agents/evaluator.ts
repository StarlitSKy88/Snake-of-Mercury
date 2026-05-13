/**
 * Evaluator Agent — 五维评分 + Red Flags 检测
 * 
 * Google Agent Skills 式审查:
 *   1. 逐条验收标准 PASS/FAIL + 证据
 *   2. 五维度评分 (产品深度/用户体验/代码质量/安全性/测试覆盖)
 *   3. Red Flags 自动 REJECTED
 *   4. Rationalizations 检测 ("看起来没问题" = REJECTED)
 */

import { TaskDAG, type Task } from '../core/task-dag.js';
import { agentCall } from '../core/agent-loop.js';
import { THREE_RED_LINES, EVALUATOR_HARDCORE, RATIONALIZATIONS, RED_FLAGS } from '../constraints/pua.js';
import { AgentMemory } from '../core/memory.js';
import type { AgentEngine } from '../utils/agent-executor.js';

// ============ System Prompt ============

const EVALUATOR_PROMPT = `你是独立质量评估师。你有最终裁决权。

## 评估五维度（1-10分）
1. productDepth (25%): 功能是否完整？验收标准全满足？
2. userExperience (20%): 交互是否流畅？
3. codeQuality (20%): 代码质量、可读性？
4. testCoverage (20%): 是否有测试？测试是否有意义？
5. security (15%): 输入验证、无硬编码密钥？

## 硬阈值
- 每维度 >= 6.0（放宽至6.0，给修复空间）
- 总分 >= 7.5
- testCoverage = 0（无测试）→ 自动 REJECTED

## 评估方法
1. 逐条验收标准检查，每条标注 PASS/FAIL + 证据
2. 检查 CodeExecutor 的实际执行证据（不是 Generator 的声称）
3. 对 "看起来没问题"、"应该正常" 等表述 → REJECTED
4. 最终裁决

## Red Flags (检测到任一 → 立即 REJECTED)
- 代码无对应测试 → REJECTED
- Bug 修复无复现测试 → REJECTED
- "看起来没问题" 表述 → REJECTED (证据驱动，不是感觉驱动)
- "应该正常" → REJECTED
- 手动测试代替自动化测试 → REJECTED
- 测试本身不验证行为（如只检查 true=true）→ REJECTED
- "稍后补测试" → REJECTED

${THREE_RED_LINES}
${EVALUATOR_HARDCORE}
${RATIONALIZATIONS}
${RED_FLAGS}

## 输出（JSON only）
{
  "verdict": "APPROVED" | "REJECTED",
  "totalScore": 8.5,
  "dimensionScores": {"productDepth":8,"userExperience":9,"codeQuality":8,"testCoverage":7,"security":8},
  "issues": ["具体问题 — 必须可操作"],
  "criteriaCheck": [{"criterion":"xxx","passed":true,"evidence":"CodeExecutor显示..."}]
}`;

// ============ 核心 ============

export interface EvaluatorReport {
  verdict: 'APPROVED' | 'REJECTED';
  totalScore: number;
  dimensionScores: Record<string, number>;
  issues: string[];
  criteriaCheck: Array<{ criterion: string; passed: boolean; evidence: string }>;
}

export async function evaluate(
  task: Task,
  generatorOutput: string,
  evidence: string,
  dag: TaskDAG,
  memory: AgentMemory,
  engine: AgentEngine = 'minimax'
): Promise<EvaluatorReport> {
  console.log(`\n🔍 [Evaluator] Task #${task.id}: ${task.subject}`);

  // 0. Red Flags 快速检测（不等 LLM）
  const redFlagResult = checkRedFlags(generatorOutput, evidence, task);
  if (redFlagResult.found) {
    console.log(`  🚩 Red Flag: ${redFlagResult.reason}`);
    const report = createDefaultReport('REJECTED', [redFlagResult.reason]);
    dag.update(task.id, { status: 'failed', evidence });
    memory.put({
      namespace: 'global',
      type: 'anti_pattern',
      content: `Task #${task.id} "${task.subject}" REJECTED by Red Flag: ${redFlagResult.reason}`,
      score: 1.0,
    });
    return report;
  }

  // 1. LLM 评估
  const prompt = `# Task #${task.id}: ${task.subject}

## 验收标准
${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Generator 输出
(如果末尾有截断标记不代表代码不完整，请查看 CodeExecutor 证据中的实际文件)
${generatorOutput.slice(0, 8000)}

${evidence}

请逐条验收标准检查并五维评分。`;

  let output: string;
  try {
    output = await agentCall(EVALUATOR_PROMPT, prompt, engine);
  } catch {
    memory.put({
      namespace: 'global',
      type: 'anti_pattern',
      content: `Evaluator unavailable for Task #${task.id} "${task.subject}"`,
    });
    return createDefaultReport('REJECTED', ['Evaluator 不可用']);
  }

  // 2. 解析 JSON
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

  // 3. 兜底检测: 如果 testCoverage=0 但说 APPROVED → 强制 REJECTED
  if (report.verdict === 'APPROVED' && (report.dimensionScores.testCoverage || 0) === 0) {
    report.verdict = 'REJECTED';
    report.issues.push('Red Flag: 无测试但声称通过');
  }

  // 4. 更新 Task 状态
  if (report.verdict === 'APPROVED') {
    dag.update(task.id, { status: 'completed', evidence });
    console.log(`  ✅ APPROVED (${report.totalScore}/10) | 维度: ${Object.entries(report.dimensionScores).map(([k,v]) => `${k}=${v}`).join(', ')}`);
    memory.put({
      namespace: 'global',
      type: 'pattern',
      content: `Task #${task.id} "${task.subject}" PASSED (${report.totalScore}/10). ${report.issues.length} issues.`,
      metadata: { taskId: task.id, scores: report.dimensionScores },
      score: 0.5,
    });
  } else {
    console.log(`  ❌ REJECTED (${report.totalScore}/10)`);
    console.log(`  问题: ${report.issues.slice(0, 3).join('; ')}`);
    memory.put({
      namespace: 'global',
      type: 'anti_pattern',
      content: `Task #${task.id} "${task.subject}" REJECTED. Issues: ${report.issues.slice(0, 3).join('; ')}`,
      metadata: { taskId: task.id, scores: report.dimensionScores },
      score: 0.9,
    });
  }

  return report;
}

// ============ Red Flags 快速检测 ============

interface RedFlagResult {
  found: boolean;
  reason: string;
}

function checkRedFlags(generatorOutput: string, evidence: string, task: Task): RedFlagResult {
  // 1. "看起来没问题" / "应该正常"
  if (/看起来.*没问题|应该.*没问题|应该.*正常|看上去.*正确|probably.*fine|seems.*ok/i.test(generatorOutput)) {
    return { found: true, reason: 'Red Flag: "看起来没问题" 表述 — 需要证据，不是感觉' };
  }

  // 2. 无测试证据
  const hasTestEvidence = /测试.*通过|test.*pass|✅.*test|test.*success/i.test(evidence);
  const hasTestFile = /\.test\.(ts|js)/i.test(generatorOutput);
  const isPureHtml = task.subject.toLowerCase().includes('html') && !task.acceptanceCriteria.some(c => c.includes('测试'));

  if (!hasTestEvidence && !hasTestFile && !isPureHtml) {
    return { found: true, reason: 'Red Flag: 无测试证据 — testCoverage=0，自动 REJECTED' };
  }

  // 3. "稍后补测试" / "先实现再测试"
  if (/稍后.*测试|后面.*测试|等.*再.*测试|先.*实现.*再.*测试|TBD.*test/i.test(generatorOutput)) {
    return { found: true, reason: 'Red Flag: "稍后补测试" — 测试必须现在写' };
  }

  // 4. 手动测试代替自动化
  if (/手动.*测试|manual.*test|浏览器.*打开.*看/i.test(generatorOutput) && !hasTestEvidence) {
    return { found: true, reason: 'Red Flag: 手动测试代替自动化测试' };
  }

  return { found: false, reason: '' };
}

// ============ 辅助 ============

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
