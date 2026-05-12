import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProblemDefinition, DebateResult } from '../types.js';

const mockExecutePhase0Debate = vi.fn();

vi.mock('../phase0-debate-engine.js', () => ({
  executePhase0Debate: mockExecutePhase0Debate,
  cleanupDebateDir: vi.fn(),
}));

import { executeHubDebate } from '../integrations/debate-engine-hub.js';

const mockProblem: ProblemDefinition = {
  contextSnapshot: '测试上下文',
  problemStatement: '测试问题',
  jtbd: '测试 JTBD',
  currentAlternatives: '无',
  evidenceAndAssumptions: [],
  successCriteria: ['标准1'],
  scopeBoundaries: { inScope: ['s1'], outOfScope: ['s2'] },
  prototypePlan: '无',
};

const mockDebateResult: DebateResult = {
  convergedRequirement: '收敛后的需求描述',
  acceptanceCriteria: ['AC1', 'AC2'],
  agentOutputs: [
    { agentName: 'phase0-insight-challenger', content: '输出1' },
  ],
  commonGround: ['共识1'],
  keyDisagreements: ['分歧1'],
  finalDecisions: ['决定1'],
};

describe('HarnessScheduler Phase0 Entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecutePhase0Debate.mockResolvedValue(mockDebateResult);
  });

  it('executeHubDebate 应正确委托到 executePhase0Debate', async () => {
    const result = await executeHubDebate('/tmp/test', mockProblem, 42);

    expect(mockExecutePhase0Debate).toHaveBeenCalledTimes(1);
    expect(mockExecutePhase0Debate).toHaveBeenCalledWith('/tmp/test', mockProblem, 42);

    expect(result).toEqual(mockDebateResult);
    expect(result.convergedRequirement).toBe('收敛后的需求描述');
    expect(result.acceptanceCriteria).toHaveLength(2);
  });

  it('应透传底层引擎的错误', async () => {
    mockExecutePhase0Debate.mockRejectedValue(new Error('辩论引擎内部错误'));

    await expect(
      executeHubDebate('/tmp/test', mockProblem, 1)
    ).rejects.toThrow('辩论引擎内部错误');
  });

  it('应接受 options 参数（兼容旧签名）', async () => {
    await executeHubDebate('/tmp/test', mockProblem, 1, {
      useFileFallback: true,
      hubConfig: { logLevel: 'error', agentTimeout: 1000, maxAgents: 3 },
    });

    expect(mockExecutePhase0Debate).toHaveBeenCalledTimes(1);
    expect(mockExecutePhase0Debate).toHaveBeenCalledWith('/tmp/test', mockProblem, 1);
  });
});
