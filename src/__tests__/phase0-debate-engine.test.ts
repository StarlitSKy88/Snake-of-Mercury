import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { executePhase0Debate, cleanupDebateDir } from '../phase0-debate-engine.js';
import type { ProblemDefinition, DebateResult } from '../types.js';

vi.mock('../utils/sdk-executor.js', () => ({
  robustSDKCall: vi.fn(),
  DEVELOPER_OUTPUT_CONSTRAINTS: '',
  validateDeveloperOutput: vi.fn(() => ({ valid: true })),
}));

import { robustSDKCall } from '../utils/sdk-executor.js';
const mockSDK = vi.mocked(robustSDKCall);

const MOCK_INSIGHT = [
  '## 洞察', '',
  '### 核心观察',
  '测试洞察输出，验证辩论引擎的结构正确性。',
  '### 建议', '1. 建议一', '2. 建议二',
  '### 风险', '- 风险一',
  '### 机会', '- 机会一', '',
].join('\n');

const mockProblem: ProblemDefinition = {
  contextSnapshot: '测试上下文快照，满足长度要求。'.repeat(2),
  problemStatement: '测试问题陈述，足够长。'.repeat(2),
  jtbd: '测试 JTBD',
  currentAlternatives: '无',
  evidenceAndAssumptions: [],
  successCriteria: ['标准1', '标准2'],
  scopeBoundaries: { inScope: ['核心'], outOfScope: ['边缘'] },
  prototypePlan: '最小原型',
};

const TEST_DIR = join(process.cwd(), '.test-debate');

describe('Phase0DebateEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('应返回合法的 DebateResult 结构（全部 SDK 成功）', async () => {
    mockSDK.mockResolvedValue({ success: true, output: MOCK_INSIGHT, attempts: 1 });

    const result: DebateResult = await executePhase0Debate(TEST_DIR, mockProblem, 1);

    expect(typeof result.convergedRequirement).toBe('string');
    expect(result.convergedRequirement.length).toBeGreaterThan(0);
    expect(Array.isArray(result.agentOutputs)).toBe(true);
    expect(result.agentOutputs.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result.acceptanceCriteria)).toBe(true);
    expect(Array.isArray(result.commonGround)).toBe(true);
    expect(Array.isArray(result.keyDisagreements)).toBe(true);
    expect(Array.isArray(result.finalDecisions)).toBe(true);
  });

  it('应在全部 SDK 失败时返回降级结果（不抛异常）', async () => {
    mockSDK.mockResolvedValue({
      success: false, output: '', attempts: 3,
      error: { type: 'api_error', message: 'API 不可用', attempt: 3 },
    });

    const result: DebateResult = await executePhase0Debate(TEST_DIR, mockProblem, 1);

    expect(result).toBeDefined();
    expect(typeof result.convergedRequirement).toBe('string');
    expect(Array.isArray(result.agentOutputs)).toBe(true);
  });

  it('应自动创建辩论目录结构', async () => {
    mockSDK.mockResolvedValue({ success: true, output: MOCK_INSIGHT, attempts: 1 });

    await executePhase0Debate(TEST_DIR, mockProblem, 1);

    expect(existsSync(join(TEST_DIR, '.phase0-debate-1'))).toBe(true);
    expect(existsSync(join(TEST_DIR, '.phase0-debate-1', 'problem-definition.json'))).toBe(true);
  });

  it('cleanupDebateDir 应删除指定迭代目录', () => {
    const debateDir = join(TEST_DIR, '.phase0-debate-99');
    mkdirSync(debateDir, { recursive: true });
    expect(existsSync(debateDir)).toBe(true);

    cleanupDebateDir(TEST_DIR, 99);

    expect(existsSync(debateDir)).toBe(false);
  });
});
