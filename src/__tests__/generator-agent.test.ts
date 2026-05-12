/**
 * Generator Agent 测试
 * 
 * 验证：Sprint Contract 谈判 + 代码实现 + 自评
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeGenerator, negotiateSprintContract } from '../generator-agent.js';
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
  objectives: ['实现计数器'],
  acceptanceCriteria: ['点击按钮数值+1', '显示当前计数'],
  estimatedDuration: '1h',
  technicalConstraints: [],
};

const MOCK_SPEC: ProductSpec = {
  overview: '一个计数器应用',
  featureList: { must: ['计数器'], should: [], could: [] },
  sprintPlan: [MOCK_SPRINT],
  technicalDirection: 'TypeScript',
  acceptanceStandards: ['功能可用'],
};

const MOCK_GENERATOR_OUTPUT = `
\`\`\`typescript:src/counter.ts
export class Counter {
  private count = 0;
  increment() { this.count++; return this.count; }
  decrement() { this.count--; return this.count; }
  getCount() { return this.count; }
}
\`\`\`

\`\`\`typescript:src/counter.test.ts
import { describe, it, expect } from 'vitest';
import { Counter } from './counter';

describe('Counter', () => {
  it('increments', () => {
    const c = new Counter();
    expect(c.increment()).toBe(1);
  });
  it('decrements', () => {
    const c = new Counter();
    expect(c.decrement()).toBe(-1);
  });
});
\`\`\`

SELF-EVAL: 8/10
Strengths: 实现简洁，包含测试
Weaknesses: 缺少UI组件
`;

describe('GeneratorAgent', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ===== executeGenerator =====

  it('应成功执行代码生成', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: MOCK_GENERATOR_OUTPUT,
      engine: 'minimax',
      duration: 200,
    });

    const result = await executeGenerator({
      sprint: MOCK_SPRINT,
      spec: MOCK_SPEC,
      projectDir: '/tmp/gen-test',
    }, 'minimax');

    expect(result.success).toBe(true);
    expect(result.filesCreated.length).toBeGreaterThan(0);
    expect(result.filesCreated).toContain('src/counter.ts');
    expect(result.selfEvalScore).toBe(8);
  });

  it('应提取自评分数', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: 'SELF-EVAL: 9/10\nStrengths: good',
      engine: 'minimax',
      duration: 100,
    });

    const result = await executeGenerator({
      sprint: MOCK_SPRINT,
      spec: MOCK_SPEC,
      projectDir: '/tmp/gen-test',
    }, 'minimax');

    expect(result.selfEvalScore).toBe(9);
  });

  it('自评分数应限制在1-10范围', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: 'SELF-EVAL: 15/10\nStrengths: perfect',
      engine: 'minimax',
      duration: 100,
    });

    const result = await executeGenerator({
      sprint: MOCK_SPRINT,
      spec: MOCK_SPEC,
      projectDir: '/tmp/gen-test',
    }, 'minimax');

    expect(result.selfEvalScore).toBeLessThanOrEqual(10);
  });

  it('Agent执行失败应返回 success=false', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: false,
      output: '',
      engine: 'minimax',
      error: 'API Error',
      duration: 100,
    });

    const result = await executeGenerator({
      sprint: MOCK_SPRINT,
      spec: MOCK_SPEC,
      projectDir: '/tmp/gen-test',
    }, 'minimax');

    expect(result.success).toBe(false);
  });

  it('异常时应返回失败不崩溃', async () => {
    mockExecuteAgent.mockRejectedValueOnce(new Error('Crash'));

    const result = await executeGenerator({
      sprint: MOCK_SPRINT,
      spec: MOCK_SPEC,
      projectDir: '/tmp/gen-test',
    }, 'minimax');

    expect(result.success).toBe(false);
    expect(result.output).toContain('Crash');
  });

  it('应处理上次失败的问题列表（修复模式）', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: MOCK_GENERATOR_OUTPUT,
      engine: 'minimax',
      duration: 200,
    });

    const result = await executeGenerator({
      sprint: MOCK_SPRINT,
      spec: MOCK_SPEC,
      projectDir: '/tmp/gen-test',
      previousIssues: ['计数器不工作', 'UI显示异常'],
    }, 'minimax');

    expect(result.success).toBe(true);
    // 验证 prompt 中包含 issue
    const callArgs = mockExecuteAgent.mock.calls[0];
    expect(callArgs[1]).toContain('Previous Issues');
    expect(callArgs[1]).toContain('计数器不工作');
  });

  // ===== negotiateSprintContract =====

  it('应谈判 Sprint Contract', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: '## Sprint Contract\n- Deliverable: 计数器组件\n- Verification: npm test 通过',
      engine: 'minimax',
      duration: 100,
    });

    const contract = await negotiateSprintContract(MOCK_SPRINT, MOCK_SPEC, 'minimax');

    expect(contract).toContain('计数器');
  });

  it('谈判失败应降级为 JSON 形式', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: false,
      output: '',
      engine: 'minimax',
      error: 'timeout',
      duration: 100,
    });

    const contract = await negotiateSprintContract(MOCK_SPRINT, MOCK_SPEC, 'minimax');

    // 降级为 sprint JSON
    expect(contract).toContain('sprintNumber');
  });
});
