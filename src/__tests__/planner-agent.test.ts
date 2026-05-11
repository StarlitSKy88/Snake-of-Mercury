/**
 * Planner Agent 测试
 * 
 * 验证：需求→产品规格的完整转换链路
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executePlanner } from '../planner-agent.js';

// Mock agent-executor
vi.mock('../utils/agent-executor.js', () => ({
  executeAgent: vi.fn(),
  execCommand: vi.fn(),
  detectAvailableEngines: vi.fn(),
}));

import { executeAgent } from '../utils/agent-executor.js';

const mockExecuteAgent = vi.mocked(executeAgent);

const VALID_SPEC_JSON = JSON.stringify({
  overview: '一个全栈计数器应用，支持增量/减量、历史记录、数据持久化',
  featureList: {
    must: ['计数器核心功能', '数据持久化', 'UI界面'],
    should: ['历史记录', '键盘快捷键'],
    could: ['多主题', '导出数据'],
  },
  sprintPlan: [
    { sprintNumber: 1, objectives: ['项目初始化'], acceptanceCriteria: ['项目可构建'], estimatedDuration: '1h', technicalConstraints: [] },
    { sprintNumber: 2, objectives: ['计数器核心'], acceptanceCriteria: ['加减可用'], estimatedDuration: '2h', technicalConstraints: [] },
    { sprintNumber: 3, objectives: ['数据持久化'], acceptanceCriteria: ['刷新不丢失'], estimatedDuration: '2h', technicalConstraints: [] },
    { sprintNumber: 4, objectives: ['UI完善'], acceptanceCriteria: ['界面美观'], estimatedDuration: '2h', technicalConstraints: [] },
    { sprintNumber: 5, objectives: ['测试+部署'], acceptanceCriteria: ['测试通过'], estimatedDuration: '1h', technicalConstraints: [] },
  ],
  technicalDirection: 'TypeScript + React + localStorage',
  acceptanceStandards: ['功能完整', '测试覆盖率>70%'],
});

describe('PlannerAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应从需求生成完整产品规格', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: VALID_SPEC_JSON,
      engine: 'codex',
      duration: 100,
    });

    const result = await executePlanner({
      originalRequirement: '做一个计数器',
      projectDir: '/tmp/test',
    }, 'codex');

    expect(result.success).toBe(true);
    expect(result.spec.featureList.must.length).toBeGreaterThanOrEqual(3);
    expect(result.spec.sprintPlan.length).toBeGreaterThanOrEqual(4);
    expect(result.spec.overview).toContain('计数器');
  });

  it('executeAgent 失败时应返回 fallback', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: false,
      output: '',
      engine: 'codex',
      error: 'API Error',
      duration: 100,
    });

    const result = await executePlanner({
      originalRequirement: '计数器',
      projectDir: '/tmp/test',
    }, 'codex');

    expect(result.success).toBe(false);
    expect(result.spec.featureList.must).toHaveLength(1);
    expect(result.spec.sprintPlan.length).toBeGreaterThanOrEqual(3); // ensureMinimumSprints
  });

  it('JSON 被 markdown 代码块包裹时也能解析', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: '```json\n' + VALID_SPEC_JSON + '\n```',
      engine: 'codex',
      duration: 100,
    });

    const result = await executePlanner({
      originalRequirement: '计数器',
      projectDir: '/tmp/test',
    }, 'codex');

    expect(result.success).toBe(true);
    expect(result.spec.featureList.must.length).toBeGreaterThanOrEqual(3);
  });

  it('Sprint不足3个时应自动补充', async () => {
    const shortSpec = JSON.stringify({
      overview: '简单应用',
      featureList: { must: ['功能A'], should: [], could: [] },
      sprintPlan: [
        { sprintNumber: 1, objectives: ['A'], acceptanceCriteria: ['A'], estimatedDuration: '1h', technicalConstraints: [] },
      ],
      technicalDirection: 'TS',
      acceptanceStandards: [],
    });

    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: shortSpec,
      engine: 'codex',
      duration: 100,
    });

    const result = await executePlanner({
      originalRequirement: '简单应用',
      projectDir: '/tmp/test',
    }, 'codex');

    expect(result.spec.sprintPlan.length).toBeGreaterThanOrEqual(3);
  });

  it('应处理辩论结果中的收敛需求', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: VALID_SPEC_JSON,
      engine: 'codex',
      duration: 100,
    });

    const result = await executePlanner({
      originalRequirement: '原始模糊需求',
      debateResult: {
        convergedRequirement: '经过辩论收敛后的精确需求：一个带历史记录和键盘快捷键的计数器',
        acceptanceCriteria: ['可增减', '显示历史', '键盘操作'],
        agentOutputs: [],
        commonGround: ['需要计数器', '需要历史记录'],
        keyDisagreements: [],
        finalDecisions: ['使用 localStorage 持久化', '支持键盘快捷键'],
      },
      projectDir: '/tmp/test',
    }, 'codex');

    expect(result.success).toBe(true);
  });

  it('异常时应返回 fallback 不崩溃', async () => {
    mockExecuteAgent.mockRejectedValueOnce(new Error('Network Error'));

    const result = await executePlanner({
      originalRequirement: '计数器',
      projectDir: '/tmp/test',
    }, 'codex');

    expect(result.success).toBe(false);
    expect(result.spec.overview).toBe('计数器'); // fallback preserves requirement
  });

  it('应包含 MoSCoW 分类的 featureList', async () => {
    mockExecuteAgent.mockResolvedValueOnce({
      success: true,
      output: VALID_SPEC_JSON,
      engine: 'codex',
      duration: 100,
    });

    const result = await executePlanner({
      originalRequirement: '计数器',
      projectDir: '/tmp/test',
    }, 'codex');

    expect(result.spec.featureList.must).toBeDefined();
    expect(result.spec.featureList.should).toBeDefined();
    expect(result.spec.featureList.could).toBeDefined();
  });
});
