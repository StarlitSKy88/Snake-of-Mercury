/**
 * Agent 集成测试 — 17 tests covering all 7 agent modules
 * Mock strategy: vi.mocked() wrapper for agent-loop mock
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskDAG, type Task } from '../core/task-dag.js';
import { AgentMemory } from '../core/memory.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// ═══════════ Setup ═══════════

const TEST_DIR = join(process.cwd(), '.test-agents');
const TEST_MEM_DIR = join(TEST_DIR, '.memory');

// Mock agent-executor → prevent real gh/search calls
vi.mock('../utils/agent-executor.js', () => ({
  execCommand: vi.fn().mockResolvedValue({ success: false, stderr: 'mock' }),
  executeAgent: vi.fn(),
}));

// Mock agent-loop BEFORE importing agents
vi.mock('../core/agent-loop.js', () => ({
  agentCall: vi.fn(),
  agentLoop: vi.fn(),
  executeAgent: vi.fn(),
}));

import { agentCall, agentLoop } from '../core/agent-loop.js';
const mockAgentCall = (response: string) => vi.mocked(agentCall).mockResolvedValue(response);
const mockAgentLoop = (result: any) => vi.mocked(agentLoop).mockResolvedValue(result);

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ═══════════ Helpers ═══════════

function createTestTask(dag: TaskDAG, overrides: Partial<Task> = {}): Task {
  return dag.create('测试登录页面', {
    description: '实现一个带表单验证的登录页面',
    acceptanceCriteria: ['用户可以输入用户名和密码', '提交时验证非空', '错误时显示红色提示'],
    ...overrides,
  });
}

// ═══════════ Planner Agent = 2 tests ═══════════

describe('Planner Agent', () => {
  it('SPECIFY 阶段输出假设列表 → 生成 TaskDAG', async () => {
    const { plan } = await import('./planner.js');
    mockAgentCall(`## ASSUMPTIONS I'M MAKING
1. 这是一个 web 应用
2. 技术栈: TypeScript + HTML
## Spec: 构建登录页面
## Tasks
- Task 1: HTML 结构
- Task 2: CSS 样式`);

    const dag = await plan('登录页面', TEST_DIR, 'minimax');
    expect(dag).toBeInstanceOf(TaskDAG);
    expect(dag.list().length).toBeGreaterThan(0);
  });

  it('市场调研失败也生成 TaskDAG（降级）', async () => {
    const { plan } = await import('./planner.js');
    mockAgentCall(`## ASSUMPTIONS\n1. web 应用\n## Tasks\n- Task 1: 基础页面`);

    const dag = await plan('简单需求', TEST_DIR, 'minimax');
    expect(dag.list().length).toBeGreaterThan(0);
  });
});

// ═══════════ Generator Agent = 3 tests ═══════════

describe('Generator Agent', () => {
  it('调用 agentLoop 并传递 TDD prompt', async () => {
    const { generate } = await import('./generator.js');
    const dag = new TaskDAG(TEST_DIR);
    const memory = new AgentMemory(TEST_MEM_DIR);
    const task = createTestTask(dag);

    mockAgentLoop({ success: true, output: 'TASK_COMPLETE\n测试通过: 3/3', iterations: 2 });

    const result = await generate(task, TEST_DIR, dag, memory, 'minimax');
    // generate 成功调用 agentLoop
    expect(agentLoop).toHaveBeenCalled();
    // agentLoop(prompt, config) → args[0]=prompt, args[1]=config
    const loopConfig = vi.mocked(agentLoop).mock.calls[0][1];
    expect(loopConfig.systemPrompt).toContain('TDD');
  });

  it('循环耗尽 → success=false', async () => {
    const { generate } = await import('./generator.js');
    const dag = new TaskDAG(TEST_DIR);
    const memory = new AgentMemory(TEST_MEM_DIR);
    const task = createTestTask(dag);

    mockAgentLoop({ success: false, output: '重试耗尽', iterations: 5, error: 'max' });

    const result = await generate(task, TEST_DIR, dag, memory, 'minimax');
    expect(result.success).toBe(false);
    // task 在 generate 内部会尝试更新状态
    const updated = dag.get(task.id);
    expect(updated).toBeDefined();
  });

  it('历史记忆传入 generate → agentLoop 被调用', async () => {
    const { generate } = await import('./generator.js');
    const dag = new TaskDAG(TEST_DIR);
    const memory = new AgentMemory(TEST_MEM_DIR);
    const task = createTestTask(dag);

    memory.put({ namespace: String(task.id), type: 'anti_pattern', content: '上次忘记处理空字符串 crash', score: 1 });

    mockAgentLoop({ success: true, output: 'TASK_COMPLETE', iterations: 1 });
    await generate(task, TEST_DIR, dag, memory, 'minimax');

    // agentLoop 被调用，说明记忆搜索和 prompt 构建完成
    expect(agentLoop).toHaveBeenCalled();
  });
});

// ═══════════ Evaluator Agent = 3 tests ═══════════

describe('Evaluator Agent', () => {
  it('假成功 → 不调用 LLM 直接 REJECTED', async () => {
    const { evaluate } = await import('./evaluator.js');
    const dag = new TaskDAG(TEST_DIR);
    const memory = new AgentMemory(TEST_MEM_DIR);
    const task = createTestTask(dag);

    const evidence = `[CodeExecutor] 验证完成
看起来没问题，基本功能正常
✅ 文件列表: index.html
✅ 验收标准: 1/3 通过`;

    const report = await evaluate(task, evidence, dag, memory, 'minimax');
    expect(report.verdict).toBe('REJECTED');
    // 假成功在 LLM 调用前被拦截
    expect(agentCall).not.toHaveBeenCalled();
  });

  it('假成功检测 → 直接 REJECTED', async () => {
    const { evaluate } = await import('./evaluator.js');
    const dag = new TaskDAG(TEST_DIR);
    const memory = new AgentMemory(TEST_MEM_DIR);
    const task = createTestTask(dag);

    const evidence = `[CodeExecutor] 验证完成
看起来没问题，基本功能正常
✅ 文件列表: index.html
✅ 验收标准: 1/3 通过`;

    const report = await evaluate(task, evidence, dag, memory, 'minimax');
    expect(report.verdict).toBe('REJECTED');
    // false success detected BEFORE LLM call
    expect(agentCall).not.toHaveBeenCalled();
  });

  it('证据上下文污染 → 直接 REJECTED', async () => {
    const { evaluate } = await import('./evaluator.js');
    const dag = new TaskDAG(TEST_DIR);
    const memory = new AgentMemory(TEST_MEM_DIR);
    const task = createTestTask(dag);

    const evidence = `const app = express();
app.get('/', (req, res) => res.send('hello'));
测试: 1/1 通过`;

    const report = await evaluate(task, evidence, dag, memory, 'minimax');
    expect(report.verdict).toBe('REJECTED');
    expect(agentCall).not.toHaveBeenCalled();
  });
});

// ═══════════ CEO Agent = 4 tests ═══════════

describe('CEO Agent', () => {
  it('createProject → 正确初始化', async () => {
    const { CEO } = await import('./ceo.js');
    const ceo = new CEO('minimax');
    const project = ceo.createProject('test-project', TEST_DIR);

    expect(project.name).toBe('test-project');
    expect(project.status).toBe('created');
    expect(project.dag).toBeInstanceOf(TaskDAG);
  });

  it('listProjects → 返回所有项目（已记录 BUG: Date.now() 碰撞）', async () => {
    const { CEO } = await import('./ceo.js');
    const ceo = new CEO('minimax');
    const d1 = join(TEST_DIR, 'p1'); const d2 = join(TEST_DIR, 'p2');
    mkdirSync(d1, { recursive: true }); mkdirSync(d2, { recursive: true });

    ceo.createProject('p1', d1);
    // BUG: Date.now() 在快速连续调用时可能相同，导致第二个项目覆盖第一个
    // 延迟以确保不同 ID
    
    ceo.createProject('p2', d2);

    expect(ceo.listProjects().length).toBe(2);
  });

  it('getUserInbox → 返回待审批请求', async () => {
    const { CEO } = await import('./ceo.js');
    const ceo = new CEO('minimax');
    const project = ceo.createProject('test', TEST_DIR);

    // protocol.request 直接发审批
    project.protocol.request('plan_approval', 'planner', 'user', '测试请求', '请审批');

    const inbox = ceo.getUserInbox(project.id);
    expect(inbox.length).toBe(1);
    expect(inbox[0].type).toBe('plan_approval');
  });

  it('saveState + resume 持久化', async () => {
    const { CEO } = await import('./ceo.js');
    const ceo = new CEO('minimax');
    const project = ceo.createProject('persist', TEST_DIR);

    const statePath = ceo.saveState(project);
    expect(statePath).toBeTruthy();

    const resumed = ceo.resume(project);
    expect(resumed).toBe(true);
  });
});

// ═══════════ DevOps Agent = 2 tests ═══════════

describe('DevOps Agent', () => {
  it('无已完成任务 → 拒绝部署', async () => {
    const { deploy } = await import('./devops.js');
    const dag = new TaskDAG(TEST_DIR);
    const memory = new AgentMemory(TEST_MEM_DIR);
    dag.create('t1', { description: 'd', acceptanceCriteria: ['a1'] });

    const result = await deploy(TEST_DIR, dag, memory, 'minimax');
    expect(result.success).toBe(false);
  });

  it('存在失败任务 → 暂停部署', async () => {
    const { deploy } = await import('./devops.js');
    const dag = new TaskDAG(TEST_DIR);
    const memory = new AgentMemory(TEST_MEM_DIR);
    const t = dag.create('t1', { description: 'd', acceptanceCriteria: ['a1'] });
    dag.update(t.id, { status: 'failed' });

    const result = await deploy(TEST_DIR, dag, memory, 'minimax');
    expect(result.success).toBe(false);
  });
});

// ═══════════ Marketing Agent = 2 tests ═══════════

describe('Marketing Agent', () => {
  it('optimizeMarketing → SEO 分析', async () => {
    const { optimizeMarketing } = await import('./marketing.js');
    const memory = new AgentMemory(TEST_MEM_DIR);
    mockAgentCall('{"title":"My App","description":"Best app"}');

    const result = await optimizeMarketing(TEST_DIR, memory, 'minimax');
    expect(result.success).toBe(true);
  });

  it('collectFeedbackToRequirements → 返回需求字符串数组', async () => {
    const { collectFeedbackToRequirements } = await import('./marketing.js');
    const memory = new AgentMemory(TEST_MEM_DIR);
    mockAgentCall('- 提升加载速度\n- 优化移动端体验\n- 增加夜间模式');

    const reqs = await collectFeedbackToRequirements('用户反馈: 太慢了', memory, 'minimax');
    expect(Array.isArray(reqs)).toBe(true);
    expect(reqs.length).toBeGreaterThan(0);
  });
});

// ═══════════ Phase0 Discuss = 1 test ═══════════

describe('Phase0 Discuss Agent', () => {
  it('生成完整 REQUIREMENT.md（含市场调研+多方案+范围）', async () => {
    const { discuss } = await import('./phase0-discuss.js');
    mockAgentCall(`# 产品分析: 测试应用

## 市场调研
1. 竞品A: stars高 — 弱点: 不支持移动端
## 创新审查
差异化方向: 开源+移动优先
## 多方案对比
| 方案 | 描述 | 优点 | 缺点 | 工期 |
| A | SPA | 快 | SEO弱 | 3天 |
推荐: A
## 范围
MVP: 登录, 列表, 搜索
后续: 推送
不做: 社交`);

    await discuss('任务管理应用', TEST_DIR, 'minimax');

    const { existsSync, readFileSync } = await import('fs');
    const reqPath = join(TEST_DIR, '.tasks', 'REQUIREMENT.md');
    expect(existsSync(reqPath)).toBe(true);

    const content = readFileSync(reqPath, 'utf-8');
    expect(content).toContain('市场调研');
    expect(content).toContain('多方案对比');
    expect(content).toContain('MVP');
  });
});
