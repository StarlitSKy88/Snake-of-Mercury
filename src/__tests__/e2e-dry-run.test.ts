/**
 * 端到端 Dry-Run 测试
 * 验证完整 Phase 0→1→2→3 管道，所有 AI 调用均 mock
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../event-bus.js';
import { CEOAgent } from '../ceo-agent.js';
import { RalphWiggumLoop } from '../ralph-loop.js';
import { executePlanner } from '../planner-agent.js';
import { executeGenerator, negotiateSprintContract } from '../generator-agent.js';
import { executeEvaluator, reviewSprintContract } from '../evaluator-agent.js';
import { executePhase3Delivery } from '../phase3-delivery.js';
import type { SprintContract, ProductSpec, HarnessState } from '../types.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('../utils/agent-executor.js', () => ({
  executeAgent: vi.fn(),
  execCommand: vi.fn(),
  detectAvailableEngines: vi.fn(async () => ['minimax']),
}));

import { executeAgent } from '../utils/agent-executor.js';
const mockEA = vi.mocked(executeAgent);

function tmpDir() {
  const dir = join(tmpdir(), `e2e-${Date.now()}-${Math.random().toString(36).slice(2,6)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Canned responses
const PLANNER_JSON = JSON.stringify({
  overview: '全栈计数器应用',
  featureList: { must: ['计数器','持久化','UI'], should: ['历史记录'], could: ['多主题'] },
  sprintPlan: [
    { sprintNumber:1, objectives:['初始化'], acceptanceCriteria:['构建通过'], estimatedDuration:'30m', technicalConstraints:[] },
    { sprintNumber:2, objectives:['核心'], acceptanceCriteria:['+1可用'], estimatedDuration:'1h', technicalConstraints:[] },
    { sprintNumber:3, objectives:['持久化'], acceptanceCriteria:['刷新不丢'], estimatedDuration:'1h', technicalConstraints:[] },
    { sprintNumber:4, objectives:['UI+测试'], acceptanceCriteria:['美观','测试>70%'], estimatedDuration:'1h', technicalConstraints:[] },
  ],
  technicalDirection: 'TS+Vitest',
  acceptanceStandards: ['功能完整'],
});

const GEN_OUT = '```typescript:src/index.ts\nconsole.log("ok");\n```\nSELF-EVAL: 8/10';
const EVAL_OK = '{"verdict":"APPROVED","totalScore":9.0,"dimensionScores":{"productDepth":9,"userExperience":9,"codeQuality":9,"security":9},"issues":[]}';
const CONTRACT = 'Sprint Contract: deliverable X, verify with npm test';
const REVIEW_OK = 'DECISION: APPROVED\nFEEDBACK:\n- good';

// Helper: setup 4 mocks for one sprint (contract+review+generator+evaluator)
function mockOneSprintPass() {
  mockEA.mockResolvedValueOnce({ success:true, output:CONTRACT, engine:'minimax', duration:50 });
  mockEA.mockResolvedValueOnce({ success:true, output:REVIEW_OK, engine:'minimax', duration:50 });
  mockEA.mockResolvedValueOnce({ success:true, output:GEN_OUT, engine:'minimax', duration:100 });
  mockEA.mockResolvedValueOnce({ success:true, output:EVAL_OK, engine:'minimax', duration:100 });
}

describe('E2E Dry-Run', () => {
  let dir: string;
  let eventBus: EventBus;
  let ceo: CEOAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = tmpDir();
    eventBus = new EventBus(dir);
    ceo = new CEOAgent(dir, 'minimax');
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('Phase 1: Planner 生成产品规格', async () => {
    mockEA.mockResolvedValueOnce({ success:true, output:PLANNER_JSON, engine:'minimax', duration:100 });

    const r = await executePlanner({ originalRequirement:'计数器', projectDir:dir }, 'minimax');
    expect(r.success).toBe(true);
    expect(r.spec.sprintPlan.length).toBeGreaterThanOrEqual(3);
  });

  it('Phase 2: Ralph Loop 全部 Sprint 通过', async () => {
    const spec: ProductSpec = {
      overview:'计数器', featureList:{must:['c'],should:[],could:[]},
      sprintPlan: [
        { sprintNumber:1, objectives:['init'], acceptanceCriteria:['build'], estimatedDuration:'30m', technicalConstraints:[] },
        { sprintNumber:2, objectives:['core'], acceptanceCriteria:['+1'], estimatedDuration:'1h', technicalConstraints:[] },
      ],
      technicalDirection:'TS', acceptanceStandards:['ok'],
    };

    mockOneSprintPass(); // sprint 1
    mockOneSprintPass(); // sprint 2

    const loop = new RalphWiggumLoop({
      mode:'internal', engine:'minimax', projectDir:dir, maxIterations:50, maxRetriesPerTask:3, eventBus,
    });

    loop.initTasks(spec.sprintPlan);

    const r = await loop.run(
      async (sprint, _retry, _lastErr) => {
        await negotiateSprintContract(sprint, spec, 'minimax');
        await reviewSprintContract(sprint, CONTRACT, 'minimax');
        const g = await executeGenerator({ sprint, spec, projectDir:dir }, 'minimax');
        if (!g.success) return { passed:false, error:'gen fail' };
        const report = await executeEvaluator({ sprint, spec, generatorOutput:g.output, projectDir:dir }, 'minimax');
        return report.verdict === 'APPROVED' ? { passed:true, report } : { passed:false, error:report.issues.join(';'), report };
      },
      (n) => spec.sprintPlan.find(s => s.sprintNumber === n)
    );

    expect(r.passed).toBe(2);
    expect(r.failed).toBe(0);
  });

  it('Phase 2: REJECTED → 重试 → APPROVED', async () => {
    const spec: ProductSpec = {
      overview:'计数器', featureList:{must:['c'],should:[],could:[]},
      sprintPlan: [{ sprintNumber:1, objectives:['init'], acceptanceCriteria:['build'], estimatedDuration:'30m', technicalConstraints:[] }],
      technicalDirection:'TS', acceptanceStandards:['ok'],
    };

    // Sprint 1: contract+review+gen OK → eval REJECTED → retry: gen OK → eval APPROVED
    mockEA.mockResolvedValueOnce({ success:true, output:CONTRACT, engine:'minimax', duration:50 });
    mockEA.mockResolvedValueOnce({ success:true, output:REVIEW_OK, engine:'minimax', duration:50 });
    mockEA.mockResolvedValueOnce({ success:true, output:GEN_OUT, engine:'minimax', duration:100 });
    mockEA.mockResolvedValueOnce({ success:true, output:'{"verdict":"REJECTED","totalScore":5.0,"dimensionScores":{"productDepth":5,"userExperience":5,"codeQuality":5,"security":5},"issues":["bug1"]}', engine:'minimax', duration:100 });

    // retry: gen+eval (no contract re-negotiation in retry because lastError is set)
    // wait, the e2e callback always re-negotiates. Let me adjust.
    mockEA.mockResolvedValueOnce({ success:true, output:CONTRACT, engine:'minimax', duration:50 });
    mockEA.mockResolvedValueOnce({ success:true, output:REVIEW_OK, engine:'minimax', duration:50 });
    mockEA.mockResolvedValueOnce({ success:true, output:GEN_OUT, engine:'minimax', duration:100 });
    mockEA.mockResolvedValueOnce({ success:true, output:EVAL_OK, engine:'minimax', duration:100 });

    const loop = new RalphWiggumLoop({
      mode:'internal', engine:'minimax', projectDir:dir, maxIterations:50, maxRetriesPerTask:3, eventBus,
    });

    loop.initTasks(spec.sprintPlan);

    const r = await loop.run(
      async (sprint, _retry, _lastErr) => {
        await negotiateSprintContract(sprint, spec, 'minimax');
        await reviewSprintContract(sprint, CONTRACT, 'minimax');
        const g = await executeGenerator({ sprint, spec, projectDir:dir }, 'minimax');
        if (!g.success) return { passed:false, error:'gen fail' };
        const report = await executeEvaluator({ sprint, spec, generatorOutput:g.output, projectDir:dir }, 'minimax');
        return report.verdict === 'APPROVED' ? { passed:true, report } : { passed:false, error:report.issues.join(';'), report };
      },
      (n) => spec.sprintPlan.find(s => s.sprintNumber === n)
    );

    expect(r.passed).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('Phase 3: 本地部署降级', async () => {
    // Phase 3 needs a state — minimal construction
    const state = {
      version:'2.0', projectName:'test', originalRequirement:'test',
      currentPhase:'phase3' as const, iterationCount:1, pivotHistory:[],
      convergenceStatus: { signal:'STOP' as const, reason:'done', consecutiveNoImprovement:0, qualityTrend:'stable' as const, shouldStop:true },
      lastUpdated: new Date().toISOString(),
    };

    const r = await executePhase3Delivery(state, dir, { engine:'minimax' });
    expect(r.deployment.success).toBe(true);
    expect(r.deployment.deployedUrl).toBe('local://development');
    expect(existsSync(join(dir, '.phase3-output', 'delivery-result.json'))).toBe(true);
  });

  it('完整闭环: CEO→Planner→RalphLoop→Phase3', async () => {
    // 1. CEO 创建项目
    const proj = ceo.createProject('E2E', '端到端测试');
    expect(proj.status).toBe('ideation');

    // 2. Planner
    mockEA.mockResolvedValueOnce({ success:true, output:PLANNER_JSON, engine:'minimax', duration:100 });
    const plan = await executePlanner({ originalRequirement:proj.description, projectDir:dir }, 'minimax');
    expect(plan.success).toBe(true);
    const spec = plan.spec;
    ceo.updateProject(proj.id, { status:'planning', totalSprints:spec.sprintPlan.length });

    // 3. Ralph Loop
    for (const _ of spec.sprintPlan) mockOneSprintPass();

    const loop = new RalphWiggumLoop({
      mode:'internal', engine:'minimax', projectDir:dir, maxIterations:50, maxRetriesPerTask:3, eventBus, projectId:proj.id,
    });
    loop.initTasks(spec.sprintPlan);

    const lr = await loop.run(
      async (sprint, _retry, _lastErr) => {
        await negotiateSprintContract(sprint, spec, 'minimax');
        await reviewSprintContract(sprint, CONTRACT, 'minimax');
        const g = await executeGenerator({ sprint, spec, projectDir:dir }, 'minimax');
        if (!g.success) return { passed:false, error:'gen fail' };
        const report = await executeEvaluator({ sprint, spec, generatorOutput:g.output, projectDir:dir }, 'minimax');
        return report.verdict === 'APPROVED' ? { passed:true, report } : { passed:false, error:report.issues.join(';'), report };
      },
      (n) => spec.sprintPlan.find(s => s.sprintNumber === n)
    );

    expect(lr.passed).toBe(spec.sprintPlan.length);
    expect(lr.failed).toBe(0);
    ceo.updateProject(proj.id, { status:'reviewing', passedSprints:lr.passed });

    // 4. Phase 3
    const state = {
      version:'2.0', projectName:proj.name, originalRequirement:proj.description,
      currentPhase:'phase3' as const, iterationCount:1, pivotHistory:[],
      phase1Output:{ spec }, phase2Output:{ currentSprint:spec.sprintPlan.length, sprintResults:[] },
      convergenceStatus:{ signal:'STOP' as const, reason:'done', consecutiveNoImprovement:0, qualityTrend:'stable' as const, shouldStop:true },
      lastUpdated:new Date().toISOString(),
    };

    const delivery = await executePhase3Delivery(state, dir, { engine:'minimax' });
    expect(delivery.deployment.success).toBe(true);
    ceo.updateProject(proj.id, { status:'deployed' });

    // 最终验证
    const summary = ceo.getProjectSummary(proj.id);
    expect(summary).toContain('E2E');
    expect(summary).toContain('deployed');

    const events = eventBus.getHistory();
    expect(events.length).toBeGreaterThan(0);
  });
});
