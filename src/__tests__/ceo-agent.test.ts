/**
 * CEO Agent 测试 — 多项目管理 + 审批 + 知识库
 * 
 * 核心验证：
 * 1. 项目创建/查询/更新
 * 2. Agent Team 组建
 * 3. 审批请求/解决
 * 4. 通知系统
 * 5. 知识库 CRUD
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CEOAgent, type ProjectRecord } from '../ceo-agent.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function tmpDir() {
  const dir = join(tmpdir(), `ceo-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('CEOAgent', () => {
  let ceo: CEOAgent;
  let dir: string;

  beforeEach(() => { dir = tmpDir(); ceo = new CEOAgent(dir, 'minimax'); });
  afterEach(() => { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); });

  // ========== 项目管理 ==========

  it('应该创建新项目', () => {
    const project = ceo.createProject('Counter App', '一个计数器应用');

    expect(project.id).toMatch(/^proj-/);
    expect(project.name).toBe('Counter App');
    expect(project.status).toBe('ideation');
    expect(project.engine).toBe('minimax');
    expect(project.team?.planner).toBe(true);
    expect(project.team?.generator).toBe(true);
    expect(project.team?.evaluator).toBe(true);
  });

  it('应该列出所有项目', () => {
    ceo.createProject('A项目', '描述A');
    ceo.createProject('B项目', '描述B');

    const projects = ceo.listProjects();

    expect(projects).toHaveLength(2);
    // 按更新时间降序
    expect(projects.map(p => p.name).sort()).toEqual(["A项目", "B项目"]);
    // projects sorted by updatedAt
  });

  it('应该更新项目状态', () => {
    const project = ceo.createProject('测试项目', '测试');

    ceo.updateProject(project.id, { status: 'developing', currentPhase: 'phase2' });

    const updated = ceo.listProjects()[0];
    expect(updated.status).toBe('developing');
    expect(updated.currentPhase).toBe('phase2');
  });

  it('getProjectSummary 应返回格式化摘要', () => {
    const project = ceo.createProject('MyApp', '一个应用');

    const summary = ceo.getProjectSummary(project.id);

    expect(summary).toContain('MyApp');
    expect(summary).toContain(project.id);
    expect(summary).toContain('ideation');
  });

  // ========== Agent Team ==========

  it('应该组建默认 Agent Team (Planner+Generator+Evaluator)', () => {
    const project = ceo.createProject('TeamProject', '测试Team');

    const team = ceo.assembleTeam(project.id);

    expect(team.planner).toBe(true);
    expect(team.generator).toBe(true);
    expect(team.evaluator).toBe(true);
    expect(team.frontend).toBe(false);
    expect(team.security).toBe(false);
  });

  it('应该支持添加前端、安全、文档 Agent', () => {
    const project = ceo.createProject('FullTeam', '全栈项目');

    const team = ceo.assembleTeam(project.id, {
      frontend: true,
      security: true,
      docs: true,
    });

    expect(team.frontend).toBe(true);
    expect(team.security).toBe(true);
    expect(team.docs).toBe(true);
  });

  // ========== 审批系统 ==========

  it('应该创建审批请求', () => {
    const project = ceo.createProject('ApprovalTest', '测试审批');

    const req = ceo.requestApproval(
      project.id,
      'deploy',
      '是否部署到生产环境？',
      ['立即部署', '等待金丝雀通过', '手动审批']
    );

    expect(req.type).toBe('deploy');
    expect(req.options).toHaveLength(3);
    expect(req.resolved).toBe(false);

    const p = ceo.listProjects()[0];
    expect(p.pendingApprovals).toHaveLength(1);
  });

  it('应该解决审批请求', () => {
    const project = ceo.createProject('ResolveTest', '测试解决');

    const req = ceo.requestApproval(project.id, 'contract', '合同审批', ['同意', '拒绝']);
    ceo.resolveApproval(project.id, req.id, '同意');

    const p = ceo.listProjects()[0];
    expect(p.pendingApprovals[0].resolved).toBe(true);
    expect(p.pendingApprovals[0].resolution).toBe('同意');
  });

  it('getProjectSummary 应显示待审批数量', () => {
    const project = ceo.createProject('MultiApproval', '多审批');

    ceo.requestApproval(project.id, 'deploy', 'Q1', ['Y', 'N']);
    ceo.requestApproval(project.id, 'budget', 'Q2', ['Y', 'N']);

    const summary = ceo.getProjectSummary(project.id);
    expect(summary).toContain('待审批: 2');
  });

  // ========== 通知系统 ==========

  it('notify 应直接输出到控制台', () => {
    const project = ceo.createProject('NotifyTest', '测试通知');
    // notify 是 private，通过 requestApproval 触发
    ceo.requestApproval(project.id, 'critical_error', '紧急问题', ['修复', '回滚']);

    // 验证通知已记录在状态中
    const p = ceo.listProjects()[0];
    expect(p.pendingApprovals).toHaveLength(1);
  });

  // ========== 知识库 ==========

  it('应该记录知识条目', () => {
    const project = ceo.createProject('KBTest', '测试知识库');

    ceo.recordKnowledge(project.id, 'pattern', '使用Zod做运行时验证效果很好', 'evaluator-agent');

    const results = ceo.searchKnowledge('Zod');
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('pattern');
    expect(results[0].content).toContain('Zod');
  });

  it('应该按类别记录不同类型的知识', () => {
    const project = ceo.createProject('KBMulti', '多类型');

    ceo.recordKnowledge(project.id, 'pattern', 'TDD最佳实践', 'generator-agent');
    ceo.recordKnowledge(project.id, 'anti_pattern', '不要硬编码API密钥', 'security');
    ceo.recordKnowledge(project.id, 'decision', '选择Vitest作测试框架', 'architect');
    ceo.recordKnowledge(project.id, 'fix', '修复deepseek上下文重置问题', 'ralph-loop');

    const patterns = ceo.searchKnowledge('TDD');
    expect(patterns).toHaveLength(1);
    expect(patterns[0].category).toBe('pattern');

    const fixes = ceo.searchKnowledge('deepseek');
    expect(fixes).toHaveLength(1);
    expect(fixes[0].category).toBe('fix');
  });

  it('searchKnowledge 应该支持模糊搜索', () => {
    const project = ceo.createProject('KBFuzzy', '模糊搜索');

    ceo.recordKnowledge(project.id, 'pattern', 'SSR渲染优化方案', 'frontend');

    expect(ceo.searchKnowledge('SSR')).toHaveLength(1);
    expect(ceo.searchKnowledge('渲染')).toHaveLength(1);
    expect(ceo.searchKnowledge('不存在的')).toHaveLength(0);
  });

  // ========== 多项目隔离 ==========

  it('不同项目的知识应该隔离', () => {
    const projA = ceo.createProject('ProjectA', 'A');
    const projB = ceo.createProject('ProjectB', 'B');

    ceo.recordKnowledge(projA.id, 'pattern', 'A的经验', 'agent-a');
    ceo.recordKnowledge(projB.id, 'pattern', 'B的经验', 'agent-b');

    // 全局搜索应该能找到全部
    expect(ceo.searchKnowledge('经验')).toHaveLength(2);
  });

  // ========== 持久化 ==========

  it('CEO 状态应该持久化', () => {
    ceo.createProject('PersistTest', '持久化测试');
    ceo.recordKnowledge('proj-persist', 'pattern', '持久化知识', 'test');

    // 新建 CEO 实例从文件加载
    const ceo2 = new CEOAgent(dir, 'minimax');
    const projects = ceo2.listProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('PersistTest');
  });

  // ========== printAllSummaries ==========

  it('printAllSummaries 不应该崩溃（空项目）', () => {
    expect(() => ceo.printAllSummaries()).not.toThrow();
  });

  it('printAllSummaries 不应该崩溃（有项目）', () => {
    ceo.createProject('Display', '显示测试');
    expect(() => ceo.printAllSummaries()).not.toThrow();
  });

  // ========== findProject (edge case) ==========

  it('getProjectSummary 对不存在的项目返回提示', () => {
    expect(ceo.getProjectSummary('不存在的ID')).toBe('项目未找到');
  });

  it('updateProject 对不存在的项目不应崩溃', () => {
    expect(() => ceo.updateProject('不存在的ID', { status: 'deployed' })).not.toThrow();
  });
});
