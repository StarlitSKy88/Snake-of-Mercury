/**
 * Evaluator Agent 测试
 * 
 * 验证：四维硬阈值评分 + Contract审查 + 输出解析
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeEvaluator, reviewSprintContract, HARD_THRESHOLD, PASS_THRESHOLD } from '../evaluator-agent.js';
import type { SprintContract, ProductSpec } from '../types.js';

vi.mock('../utils/agent-executor.js', () => ({
  executeAgent: vi.fn(),
  execCommand: vi.fn(),
  detectAvailableEngines: vi.fn(),
}));

import { executeAgent } from '../utils/agent-executor.js';
const mockExecuteAgent = vi.mocked(executeAgent);

const MOCK_SPRINT: SprintContract = {
  sprintNumber: 1,
  objectives: ['计数器'],
  acceptanceCriteria: ['点击+1', '显示计数'],
  estimatedDuration: '1h',
  technicalConstraints: [],
};

const MOCK_SPEC: ProductSpec = {
  overview: '计数器应用',
  featureList: { must: ['计数器'], should: [], could: [] },
  sprintPlan: [MOCK_SPRINT],
  technicalDirection: 'TS',
  acceptanceStandards: ['可用'],
};

const APPROVED_JSON = JSON.stringify({
  verdict: 'APPROVED',
  totalScore: 9.0,
  dimensionScores: {
    productDepth: 9,
    userExperience: 9,
    codeQuality: 9,
    security: 9,
  },
  issues: [],
});

const REJECTED_JSON = JSON.stringify({
  verdict: 'REJECTED',
  totalScore: 6.0,
  dimensionScores: {
    productDepth: 7,
    userExperience: 5,
    codeQuality: 6,
    security: 6,
  },
  issues: ['计数逻辑错误', '缺少UI组件', '无错误处理'],
});

describe('EvaluatorAgent', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ===== executeEvaluator =====

  it('应输出 APPROVED 评分报告', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: APPROVED_JSON,
      engine: 'minimax',
      duration: 100,
    });

    const report = await executeEvaluator({
      sprint: MOCK_SPRINT,
      spec: MOCK_SPEC,
      generatorOutput: 'code here',
      projectDir: '/tmp/eval-test',
    }, 'minimax');

    expect(report.verdict).toBe('APPROVED');
    expect(report.totalScore).toBe(9.0);
    expect(report.dimensionScores.productDepth).toBe(9);
  });

  it('应输出 REJECTED 评分报告', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: REJECTED_JSON,
      engine: 'minimax',
      duration: 100,
    });

    const report = await executeEvaluator({
      sprint: MOCK_SPRINT,
      spec: MOCK_SPEC,
      generatorOutput: 'broken code',
      projectDir: '/tmp/eval-test',
    }, 'minimax');

    expect(report.verdict).toBe('REJECTED');
    expect(report.issues.length).toBeGreaterThan(0);
  });

  // ===== 硬阈值强制检查 =====

  it('LLM输出APPROVED但某维度低于7.0 → 强制REJECTED', async () => {
    const weakApproved = JSON.stringify({
      verdict: 'APPROVED',
      totalScore: 9.0,
      dimensionScores: {
        productDepth: 9,
        userExperience: 9,
        codeQuality: 6,  // 低于硬阈值!
        security: 9,
      },
      issues: [],
    });

    mockExecuteAgent.mockResolvedValueOnce({
      success: true, output: weakApproved, engine: 'minimax', duration: 100,
    });

    const report = await executeEvaluator({
      sprint: MOCK_SPRINT, spec: MOCK_SPEC,
      generatorOutput: 'code', projectDir: '/tmp/eval-test',
    }, 'minimax');

    expect(report.verdict).toBe('REJECTED'); // 硬阈值覆盖
  });

  it('总分低于8.0 → 强制REJECTED', async () => {
    const lowScore = JSON.stringify({
      verdict: 'APPROVED',
      totalScore: 7.0,
      dimensionScores: {
        productDepth: 8, userExperience: 8,
        codeQuality: 7, security: 7,
      },
      issues: [],
    });

    mockExecuteAgent.mockResolvedValueOnce({
      success: true, output: lowScore, engine: 'minimax', duration: 100,
    });

    const report = await executeEvaluator({
      sprint: MOCK_SPRINT, spec: MOCK_SPEC,
      generatorOutput: 'code', projectDir: '/tmp/eval-test',
    }, 'minimax');

    expect(report.verdict).toBe('REJECTED');
  });

  // ===== JSON 解析容错 =====

  it('JSON外有markdown代码块也能解析', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: '```json\n' + APPROVED_JSON + '\n```',
      engine: 'minimax',
      duration: 100,
    });

    const report = await executeEvaluator({
      sprint: MOCK_SPRINT, spec: MOCK_SPEC,
      generatorOutput: 'code', projectDir: '/tmp/eval-test',
    }, 'minimax');

    expect(report.verdict).toBe('APPROVED');
  });

  it('完全不合法输出应降级为REJECTED', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: '这是一段随意的文字，不是JSON',
      engine: 'minimax',
      duration: 100,
    });

    const report = await executeEvaluator({
      sprint: MOCK_SPRINT, spec: MOCK_SPEC,
      generatorOutput: 'code', projectDir: '/tmp/eval-test',
    }, 'minimax');

    expect(report.verdict).toBe('REJECTED');
    expect(report.issues).toContain('评估器输出无法解析，默认 REJECTED');
  });

  it('Agent执行失败应返回默认REJECTED', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: false, output: '', engine: 'minimax',
      error: 'timeout', duration: 100,
    });

    const report = await executeEvaluator({
      sprint: MOCK_SPRINT, spec: MOCK_SPEC,
      generatorOutput: 'code', projectDir: '/tmp/eval-test',
    }, 'minimax');

    expect(report.verdict).toBe('REJECTED');
  });

  it('异常不崩溃', async () => {
    mockExecuteAgent.mockRejectedValueOnce(new Error('Boom'));

    const report = await executeEvaluator({
      sprint: MOCK_SPRINT, spec: MOCK_SPEC,
      generatorOutput: 'code', projectDir: '/tmp/eval-test',
    }, 'minimax');

    expect(report.verdict).toBe('REJECTED');
    expect(report.issues[0]).toContain('Boom');
  });

  // ===== reviewSprintContract =====

  it('审查通过Sprint Contract', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: 'DECISION: APPROVED\nFEEDBACK:\n- looks good',
      engine: 'minimax',
      duration: 100,
    });

    const result = await reviewSprintContract(
      MOCK_SPRINT,
      '计数器实现合同',
      'minimax',
    );

    expect(result.approved).toBe(true);
  });

  it('审查要求修改Sprint Contract', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: 'DECISION: CHANGES_REQUESTED\nFEEDBACK:\n- 缺少错误处理描述',
      engine: 'minimax',
      duration: 100,
    });

    const result = await reviewSprintContract(
      MOCK_SPRINT,
      '不完整的合同',
      'minimax',
    );

    expect(result.approved).toBe(false);
  });

  it('审查失败应自动批准', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: false,
      output: '',
      engine: 'minimax',
      error: 'timeout',
      duration: 100,
    });

    const result = await reviewSprintContract(MOCK_SPRINT, '合同', 'minimax');

    // 降级为auto-approved（不阻塞流程）
    expect(result.approved).toBe(true);
  });

  // ===== 加权分数计算 =====

  it('加权总分应正确计算', async () => {
    const scores = JSON.stringify({
      verdict: 'APPROVED',
      totalScore: 8.5,
      dimensionScores: {
        productDepth: 10,    // * 0.35 = 3.5
        userExperience: 10,  // * 0.30 = 3.0
        codeQuality: 5,      // * 0.20 = 1.0 → 低于硬阈值!
        security: 10,        // * 0.15 = 1.5
      },
      issues: [],
    });

    mockExecuteAgent.mockResolvedValueOnce({
      success: true, output: scores, engine: 'minimax', duration: 100,
    });

    const report = await executeEvaluator({
      sprint: MOCK_SPRINT, spec: MOCK_SPEC,
      generatorOutput: 'code', projectDir: '/tmp/eval-test',
    }, 'minimax');

    // codeQuality 5.0 < 7.0 硬阈值 → 强制 REJECTED
    expect(report.verdict).toBe('REJECTED');
  });
});
