/**
 * Evaluator Agent — 验证任务 + 写入记忆
 * 
 * 流程:
 *   1. 接收 Generator 输出 + CodeExecutor 证据
 *   2. 逐条验收标准检查
 *   3. 四维评分
 *   4. 写入记忆（通过/失败模式）
 */

import { TaskDAG, type Task } from '../core/task-dag.js';
import { agentCall } from '../core/agent-loop.js';
import { THREE_RED_LINES, EVALUATOR_HARDCORE } from '../constraints/pua.js';
import { AgentMemory } from '../core/memory.js';
import type { AgentEngine } from '../utils/agent-executor.js';

// ============ System Prompt ============

const EVALUATOR_PROMPT = `你是独立质量评估师。你对代码有最终裁决权。

## 评估维度（1-10分）
1. productDepth (35%): 功能是否完整？
2. userExperience (30%): 交互是否流畅？
3. codeQuality (20%): 代码质量、测试、可读性？
4. security (15%): 输入验证、无硬编码密钥？

## 硬阈值
- 每维度 >= 7.0
- 总分 >= 8.0
- 不满足 → REJECTED

## 评估方法
1. 逐条验收标准检查，每条标注 PASS/FAIL + 证据
2. 检查 CodeExecutor 的实际执行证据
3. 最终裁决

${THREE_RED_LINES}
${EVALUATOR_HARDCORE}

## 输出（JSON only）
{
  "verdict": "APPROVED" | "REJECTED",
  "totalScore": 8.5,
  "dimensionScores": {"productDepth":8,"userExperience":9,"codeQuality":8,"security":8},
  "issues": ["具体问题"],
  "criteriaCheck": [{"criterion":"xxx","passed":true,"evidence":"..."}]
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

  const prompt = `# Task #${task.id}: ${task.subject}

## 验收标准
${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Generator 输出
${generatorOutput.slice(0, 6000)}

${evidence}

请逐条验收标准检查并评分。`;

  let output: string;
  try {
    output = await agentCall(EVALUATOR_PROMPT, prompt, engine);
  } catch {
    // Evaluator 不可用时默认 REJECTED
    memory.put({
      namespace: 'global',
      type: 'anti_pattern',
      content: `Evaluator unavailable for Task #${task.id} "${task.subject}"`,
    });
    return createDefaultReport('REJECTED', ['Evaluator 不可用']);
  }

  // 解析 JSON
  let report: EvaluatorReport;
  try {
    const jsonMatch = output.match(/```json\s*([\s\S]*?)```/) || output.match(/(\{[\s\S]*\})/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[1]) : JSON.parse(output);
    report = normalizeReport(parsed);
  } catch {
    // JSON 解析失败，从文本推断
    const approved = /APPROVED|通过/i.test(output) && !/REJECTED|失败/i.test(output);
    report = createDefaultReport(
      approved ? 'APPROVED' : 'REJECTED',
      approved ? [] : ['Evaluator JSON 解析失败']
    );
  }

  // 更新 Task 状态
  if (report.verdict === 'APPROVED') {
    dag.update(task.id, { status: 'completed', evidence });
    console.log(`  ✅ APPROVED (${report.totalScore}/10)`);
    memory.put({
      namespace: 'global',
      type: 'pattern',
      content: `Task #${task.id} "${task.subject}" PASSED with score ${report.totalScore}. ${report.issues.length} issues noted.`,
      metadata: { taskId: task.id },
      score: 0.5,
    });
  } else {
    console.log(`  ❌ REJECTED (${report.totalScore}/10)`);
    console.log(`  问题: ${report.issues.slice(0, 2).join('; ')}`);
    memory.put({
      namespace: 'global',
      type: 'anti_pattern',
      content: `Task #${task.id} "${task.subject}" REJECTED. Issues: ${report.issues.slice(0, 3).join('; ')}`,
      metadata: { taskId: task.id },
      score: 0.9,
    });
  }

  return report;
}

// ============ 辅助 ============

function normalizeReport(raw: Record<string, any>): EvaluatorReport {
  return {
    verdict: raw.verdict || 'REJECTED',
    totalScore: Number(raw.totalScore) || 5.0,
    dimensionScores: raw.dimensionScores || { productDepth: 5, userExperience: 5, codeQuality: 5, security: 5 },
    issues: Array.isArray(raw.issues) ? raw.issues : [],
    criteriaCheck: Array.isArray(raw.criteriaCheck) ? raw.criteriaCheck : [],
  };
}

function createDefaultReport(verdict: 'APPROVED' | 'REJECTED', issues: string[]): EvaluatorReport {
  return {
    verdict,
    totalScore: verdict === 'APPROVED' ? 8.5 : 5.0,
    dimensionScores: { productDepth: 5, userExperience: 5, codeQuality: 5, security: 5 },
    issues,
    criteriaCheck: [],
  };
}
