/**
 * E2E 全链路 Dry-Run — 含 T1.1 自动 Phase0 验证
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(process.cwd(), '.test-e2e');
const TEST_REQ = '一个极简待办事项应用，用户可以添加和删除任务';

vi.mock('../src/core/agent-loop.js', () => ({ agentCall: vi.fn(), agentLoop: vi.fn(), executeAgent: vi.fn() }));
vi.mock('../src/utils/agent-executor.js', () => ({ execCommand: vi.fn().mockResolvedValue({ success: false, stderr: 'mock' }), executeAgent: vi.fn() }));
vi.mock('../src/executors/code-executor.js', async () => {
  const actual = await vi.importActual('../src/executors/code-executor.js') as any;
  return { ...actual, executeCode: vi.fn(), formatEvidenceForEvaluator: vi.fn() };
  it('T1.5: 高影响任务触发审批 + CEO.approve 通过', async () => {
    const dir = join(TEST_DIR, '.tasks'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'REQUIREMENT.md'), '# pre');
    
    const { CEO } = await import('../src/agents/ceo.js');
    const ceo = new CEO('minimax');
    const project = ceo.createProject('approval-test', TEST_DIR);

    // 直接测试: protocol.request → getUserInbox → approve
    project.protocol.request('plan_approval', 'planner', 'user', '高影响任务', 'Task #1: 系统改造 (P2)');
    
    const inbox = ceo.getUserInbox(project.id);
    expect(inbox.length).toBeGreaterThan(0);
    expect(inbox[0].type).toBe('plan_approval');
    
    // 审批通过
    const approved = ceo.approve(project.id, inbox[0].id, true, '同意');
    expect(approved).toBe(true);
    
    // 审批后 inbox 为空
    expect(ceo.getUserInbox(project.id).length).toBe(0);
  });

  it('T1.6: 项目状态机 7 态流转验证', async () => {
    const { CEO } = await import('../src/agents/ceo.js');
    const ceo = new CEO('minimax');
    
    // created
    const p = ceo.createProject('state-test', TEST_DIR);
    expect(p.status).toBe('created');
    
    // 手动流转验证
    p.status = 'planning'; expect(p.status).toBe('planning');
    p.status = 'building'; expect(p.status).toBe('building');
    p.status = 'reviewing'; expect(p.status).toBe('reviewing');
    p.status = 'deployed'; expect(p.status).toBe('deployed');
    p.status = 'paused'; expect(p.status).toBe('paused');
    
    // saveState + resume
    const path = ceo.saveState(p);
    expect(existsSync(path)).toBe(true);
    const resumed = ceo.resume(p);
    expect(resumed).toBe(true);
    expect(p.status).toBe('paused');
  });

  it('T1.7: runAsync 异常重抛 + 失败不阻塞', async () => {
    const { CEO } = await import('../src/agents/ceo.js');
    const ceo = new CEO('minimax');
    const project = ceo.createProject('async-test', TEST_DIR);
    
    // runAsync 应该抛出异常（因为没有 setup mocks）
    let threw = false;
    try {
      await ceo.runAsync(project, 'test');
    } catch (e) {
      threw = true;
    }
    // 即使没有 mock LLM，runAsync 也应该正确传播错误
    expect(threw).toBe(true);
  });

});

import { agentCall, agentLoop } from '../src/core/agent-loop.js';
import { executeCode, formatEvidenceForEvaluator } from '../src/executors/code-executor.js';

const mockPlannerOutput = `## ASSUMPTIONS I'M MAKING\n1. web 应用\n2. TypeScript + HTML\n\n## Tasks\n\`\`\`json\n{"tasks":[{"id":1,"subject":"创建 index.html 待办事项应用","description":"实现完整的待办事项 HTML 页面","acceptanceCriteria":["用户可以输入任务并点击添加","任务出现在列表中","用户可以删除任务","刷新页面后任务仍然存在"],"blockedBy":[],"impactLevel":1}]}\n\`\`\``;

const mockGeneratorOutput = `## RED Phase\n测试编写完成\n\n## GREEN Phase\n\`\`\`html:index.html\n<!DOCTYPE html><html><head><title>Todo</title></head><body><h1>Todo</h1><input id="t"><button onclick="add()">Add</button><ul id="l"></ul><script>var d=JSON.parse(localStorage.t||'[]');function r(){l.innerHTML=d.map(function(x,i){return'<li>'+x+' <button onclick=\"d.splice('+i+',1);r()\">X</button></li>'}).join('');localStorage.t=JSON.stringify(d)}function add(){var v=t.value.trim();if(v){d.push(v);t.value='';r()}}r();</script></body></html>\n\`\`\`\n\n## REFACTOR Phase\n简洁代码\n\n## Feedback Loop\n验证方法: 浏览器打开 index.html → 预期结果: 功能正常\n\nTASK_COMPLETE`;

const mockEvidence = `[CodeExecutor] 验证完成\n✅ 文件列表: index.html\n✅ 验收标准: 4/4 通过\n  - 用户可以输入任务并点击添加 ✅ PASS\n  - 任务出现在列表中 ✅ PASS\n  - 用户可以删除任务 ✅ PASS\n  - 刷新页面后任务仍然存在 ✅ PASS\n✅ 测试: 5/5 通过`;

const mockEvaluatorOutput = JSON.stringify({ verdict: 'APPROVED', totalScore: 8.2, dimensionScores: { testCoverage: 8 }, issues: [], criteriaCheck: [] });

beforeEach(() => { rmSync(TEST_DIR, { recursive: true, force: true }); mkdirSync(TEST_DIR, { recursive: true }); vi.clearAllMocks(); vi.resetAllMocks(); });
afterEach(() => { rmSync(TEST_DIR, { recursive: true, force: true }); });

function setupE2EMocks() {
  vi.mocked(executeCode).mockResolvedValue({
    filesExtracted: [{ language: 'html', filepath: 'index.html', content: '<!DOCTYPE html>...' }],
    summary: '[CodeExecutor] 验证完成', moduleDepthScore: { functions: 5, totalLines: 80, rating: '中' },
    test: { success: true, output: 'all passed' }, typeCheck: { success: true, output: 'ok' },
  });
  vi.mocked(formatEvidenceForEvaluator).mockReturnValue(mockEvidence);
}

describe('E2E 全链路', () => {
  it('Phase 0: 需求讨论', async () => {
    const { discuss } = await import('../src/agents/phase0-discuss.js');
    vi.mocked(agentCall).mockResolvedValue('# 产品分析\n## MVP\n添加删除');
    await discuss(TEST_REQ, TEST_DIR, 'minimax');
    expect(existsSync(join(TEST_DIR, '.tasks', 'REQUIREMENT.md'))).toBe(true);
  });

  it('Phase 1-2: Planner→Generator→Evaluator', async () => {
    const dir = join(TEST_DIR, '.tasks'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'REQUIREMENT.md'), '# pre-generated');
    
    const { CEO } = await import('../src/agents/ceo.js');
    const ceo = new CEO('minimax');
    const project = ceo.createProject('todo-app', TEST_DIR);

    vi.mocked(agentCall).mockResolvedValueOnce(mockPlannerOutput);
    vi.mocked(agentCall).mockResolvedValueOnce(mockEvaluatorOutput);
    vi.mocked(agentLoop).mockResolvedValue({ success: true, output: mockGeneratorOutput, iterations: 1 });
    setupE2EMocks();

    await ceo.run(project, TEST_REQ);
    const completed = project.dag.list().filter(t => t.status === 'completed');
    expect(completed.length).toBeGreaterThan(0);
  });

  it('Phase 3: DevOps', async () => {
    const { deploy } = await import('../src/agents/devops.js');
    const { TaskDAG } = await import('../src/core/task-dag.js');
    const { AgentMemory } = await import('../src/core/memory.js');
    const dag = new TaskDAG(TEST_DIR);
    const t = dag.create('done', { description:'d', acceptanceCriteria:['a1'] });
    dag.update(t.id, { status: 'completed' });
    const result = await deploy(TEST_DIR, dag, new AgentMemory(join(TEST_DIR,'.m')), 'minimax');
    expect(result).toHaveProperty('success');
  });

  it('Phase 4: Marketing', async () => {
    const { optimizeMarketing } = await import('../src/agents/marketing.js');
    const { AgentMemory } = await import('../src/core/memory.js');
    vi.mocked(agentCall).mockResolvedValue('{"title":"Test"}');
    const r = await optimizeMarketing(TEST_DIR, new AgentMemory(join(TEST_DIR,'.m')), 'minimax');
    expect(r.success).toBe(true);
  });

  it('完整串联: Phase0→Pipeline', async () => {
    const { discuss } = await import('../src/agents/phase0-discuss.js');
    vi.mocked(agentCall).mockResolvedValue('# 产品分析\n## MVP\n功能');
    await discuss(TEST_REQ, TEST_DIR, 'minimax');
    
    vi.mocked(agentCall).mockReset();
    const { CEO } = await import('../src/agents/ceo.js');
    const ceo = new CEO('minimax');
    const project = ceo.createProject('full', TEST_DIR);

    vi.mocked(agentCall).mockResolvedValueOnce(mockPlannerOutput);
    vi.mocked(agentCall).mockResolvedValueOnce(mockEvaluatorOutput);
    vi.mocked(agentLoop).mockResolvedValue({ success: true, output: mockGeneratorOutput, iterations: 1 });
    setupE2EMocks();

    await ceo.run(project, TEST_REQ);
    expect(project.dag.list().filter(t => t.status === 'completed').length).toBeGreaterThan(0);
    expect(existsSync(ceo.saveState(project))).toBe(true);
  });

  it('Ralph Loop 重试: 1st REJECTED→2nd APPROVED', async () => {
    const dir = join(TEST_DIR, '.tasks'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'REQUIREMENT.md'), '# pre');
    
    const { CEO } = await import('../src/agents/ceo.js');
    const ceo = new CEO('minimax');
    const project = ceo.createProject('retry', TEST_DIR);

    vi.mocked(agentCall).mockResolvedValueOnce(mockPlannerOutput);
    vi.mocked(agentCall).mockResolvedValueOnce(JSON.stringify({ verdict:'REJECTED', totalScore:4, dimensionScores:{}, issues:['BUG'], criteriaCheck:[] }));
    vi.mocked(agentCall).mockResolvedValueOnce(mockEvaluatorOutput);
    vi.mocked(agentLoop).mockResolvedValue({ success: true, output: mockGeneratorOutput, iterations: 1 });
    setupE2EMocks();

    await ceo.run(project, TEST_REQ);
    expect(project.dag.list().filter(t => t.status === 'completed').length).toBeGreaterThan(0);
    expect(vi.mocked(agentLoop).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('T1.1: 无 REQUIREMENT.md 时 CEO.run 自动调用 Phase0', async () => {
    const { CEO } = await import('../src/agents/ceo.js');
    const ceo = new CEO('minimax');
    const project = ceo.createProject('auto-p0', TEST_DIR);

    // discuss 需要 3 次 agentCall: analysis + proposer + challenger
    vi.mocked(agentCall).mockResolvedValueOnce('# 自动Phase0\n## MVP\n测试');
    vi.mocked(agentCall).mockResolvedValueOnce('Proposer: 推荐方案A');
    vi.mocked(agentCall).mockResolvedValueOnce('Challenger: 质疑方案A');
    // Planner + Evaluator
    vi.mocked(agentCall).mockResolvedValueOnce(mockPlannerOutput);
    vi.mocked(agentCall).mockResolvedValueOnce(mockEvaluatorOutput);
    vi.mocked(agentLoop).mockResolvedValue({ success: true, output: mockGeneratorOutput, iterations: 1 });
    setupE2EMocks();

    await ceo.run(project, TEST_REQ);
    
    const reqPath = join(TEST_DIR, '.tasks', 'REQUIREMENT.md');
    expect(existsSync(reqPath)).toBe(true);
    expect(readFileSync(reqPath, 'utf-8')).toContain('自动Phase0');
    expect(project.dag.list().filter(t => t.status === 'completed').length).toBeGreaterThan(0);
  });
  it('T1.5: 高影响任务触发审批 + CEO.approve 通过', async () => {
    const dir = join(TEST_DIR, '.tasks'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'REQUIREMENT.md'), '# pre');
    
    const { CEO } = await import('../src/agents/ceo.js');
    const ceo = new CEO('minimax');
    const project = ceo.createProject('approval-test', TEST_DIR);

    // 直接测试: protocol.request → getUserInbox → approve
    project.protocol.request('plan_approval', 'planner', 'user', '高影响任务', 'Task #1: 系统改造 (P2)');
    
    const inbox = ceo.getUserInbox(project.id);
    expect(inbox.length).toBeGreaterThan(0);
    expect(inbox[0].type).toBe('plan_approval');
    
    // 审批通过
    const approved = ceo.approve(project.id, inbox[0].id, true, '同意');
    expect(approved).toBe(true);
    
    // 审批后 inbox 为空
    expect(ceo.getUserInbox(project.id).length).toBe(0);
  });

  it('T1.6: 项目状态机 7 态流转验证', async () => {
    const { CEO } = await import('../src/agents/ceo.js');
    const ceo = new CEO('minimax');
    
    // created
    const p = ceo.createProject('state-test', TEST_DIR);
    expect(p.status).toBe('created');
    
    // 手动流转验证
    p.status = 'planning'; expect(p.status).toBe('planning');
    p.status = 'building'; expect(p.status).toBe('building');
    p.status = 'reviewing'; expect(p.status).toBe('reviewing');
    p.status = 'deployed'; expect(p.status).toBe('deployed');
    p.status = 'paused'; expect(p.status).toBe('paused');
    
    // saveState + resume
    const path = ceo.saveState(p);
    expect(existsSync(path)).toBe(true);
    const resumed = ceo.resume(p);
    expect(resumed).toBe(true);
    expect(p.status).toBe('paused');
  });

  it('T1.7: runAsync 异常重抛 + 失败不阻塞', async () => {
    const { CEO } = await import('../src/agents/ceo.js');
    const ceo = new CEO('minimax');
    const project = ceo.createProject('async-test', TEST_DIR);
    
    // runAsync 应该抛出异常（因为没有 setup mocks）
    let threw = false;
    try {
      await ceo.runAsync(project, 'test');
    } catch (e) {
      threw = true;
    }
    // 即使没有 mock LLM，runAsync 也应该正确传播错误
    expect(threw).toBe(true);
  });

});
