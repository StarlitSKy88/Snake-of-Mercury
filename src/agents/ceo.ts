/**
 * CEO Agent — 用户代理 + 项目生命周期管理
 * 
 * v5:
 *   - P0-5: Generator→CodeExecutor→Evaluator 强制网关
 *   - 增加证据合法性预检查
 */

import { TaskDAG } from '../core/task-dag.js';
import { ProtocolBus, type ProtocolRequest } from '../core/protocol.js';
import { Gate } from '../core/gate.js';
import { AgentMemory } from '../core/memory.js';
import { plan } from './planner.js';
import { discuss } from './phase0-discuss.js';
import { generate } from './generator.js';
import { evaluate } from './evaluator.js';
import { hasCodeExecutorSignature } from '../core/evidence-guard.js';
import type { AgentEngine } from '../utils/agent-executor.js';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============ 类型 ============

export type ProjectStatus = 'created' | 'planning' | 'building' | 'reviewing' | 'deployed' | 'paused';

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  projectDir: string;
  dag: TaskDAG;
  protocol: ProtocolBus;
  gate: Gate;
  memory: AgentMemory;
  createdAt: string;
}

// ============ CEO ============

export class CEO {
  private projects: Map<string, Project> = new Map();
  private engine: AgentEngine;

  constructor(engine: AgentEngine = 'minimax') {
    this.engine = engine;
  }

  createProject(name: string, dir: string): Project {
    const id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const project: Project = {
      id, name,
      status: 'created',
      projectDir: dir,
      dag: new TaskDAG(dir),
      protocol: new ProtocolBus(dir),
      gate: new Gate(new ProtocolBus(dir)),
      memory: new AgentMemory(dir + '/.memory'),
      createdAt: new Date().toISOString(),
    };
    (project as any).gate = new Gate(project.protocol);
    this.projects.set(id, project);
    console.log(`\n👑 [CEO] 项目创建: ${name} (${id})`);
    return project;
  }

  async run(project: Project, requirement: string): Promise<void> {
    const { existsSync, readFileSync } = await import('fs');
    const { join } = await import('path');
    const reqPath = join(project.projectDir, '.tasks', 'REQUIREMENT.md');

    // v6 T1.1: 如果 REQUIREMENT.md 不存在，先自动运行 Phase0
    if (!existsSync(reqPath)) {
      console.log('\n🧠 [CEO] 未检测到 REQUIREMENT.md，自动启动 Phase 0 需求讨论...');
      const result = await discuss(requirement, project.projectDir, this.engine);
      if (!result.success) {
        console.error('❌ Phase 0 失败:', result.summary);
        return;
      }
      console.log('✅ Phase 0 完成 → REQUIREMENT.md 已生成');
    } else {
      console.log('📄 检测到 REQUIREMENT.md，跳过 Phase 0');
    }

    // Phase 1: 需求 → Task DAG
    project.status = 'planning';
    console.log('\n📋 Phase 1: 需求分析 + 任务规划');
    const newDag = await plan(requirement, project.projectDir, this.engine);
    project.dag = newDag;
    
    const tasks = project.dag.list();
    console.log(`\n任务 DAG (${tasks.length} 个任务):`);
    for (const t of tasks) {
      console.log(`  ${t.id}. [${t.blockedBy.join(',') || '-'}] → ${t.subject} (impact:${t.impactLevel})`);
    }

    // 高影响任务审批
    const highImpact = tasks.filter(t => t.impactLevel >= 2);
    if (highImpact.length > 0) {
      project.protocol.request(
        'plan_approval', 'planner', 'user',
        `发现 ${highImpact.length} 个高影响任务`,
        highImpact.map(t => `- Task #${t.id}: ${t.subject} (P${t.impactLevel})`).join('\n')
      );
    }

    // Phase 2: Ralph Loop
    project.status = 'building';
    console.log('\n🔨 Phase 2: 执行任务 (Ralph Loop)');

    let completedTasks = 0;
    const maxTasks = tasks.length * 3;

    for (let iter = 0; iter < maxTasks; iter++) {
      const ready = project.dag.getReady();
      if (ready.length === 0) {
        const blocked = project.dag.getBlocked();
        if (blocked.length === 0) break;
        console.log(`  等待依赖: ${blocked.map(t => `#${t.id}`).join(', ')}`);
        continue;
      }

      const task = ready[0];

      // Gate 检查
      const gateCheck = await project.gate.check(task.subject, task.description, 'generator');
      if (gateCheck.blocked) {
        const existingReqs = project.protocol.listPending('user');
        if (existingReqs.some(r => r.subject.includes(task.subject) && r.status === 'pending')) {
          continue;
        }
        console.log(`  ⏸️  Task #${task.id} 需要审批`);
        continue;
      }

      // v5 P0-5: Ralph Loop — Generator→CodeExecutor→Evaluator 强制网关
      const MAX_ROUNDS = 3;
      let approved = false;

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        if (round > 1) console.log(`  🔄 重试第 ${round}/${MAX_ROUNDS} 轮`);

        // Step 1: Generator (内部执行 CodeExecutor)
        const genResult = await generate(
          task, project.projectDir, project.dag, project.memory, this.engine
        );

        if (!genResult.success) {
          console.log(`  ⚠️  Generator 失败 (第${round}轮)`);
          // v5 P0-5: Generator 失败 → 不进入 Evaluator
          continue;
        }

        // v5 P0-5: 强制网关检查 — 证据必须有 CodeExecutor 签名
        if (!hasCodeExecutorSignature(genResult.evidence)) {
          console.log(`  🚫 [CEO] 证据无 CodeExecutor 签名 — 可能跳过执行，拒绝`);
          // 要求 Generator 重试
          const feedbackText = '\n\n## CEO 网关检查(第' + round + '轮)\n' +
            '证据中缺失 CodeExecutor 输出特征（文件列表/验证结果/测试通过标志）。请重新生成并通过 CodeExecutor 验证。';
          project.dag.update(task.id, {
            description: task.description + feedbackText,
          });
          continue;
        }

        // Step 2: Evaluator（只收到证据）
        const evalReport = await evaluate(
          task, genResult.evidence, project.dag, project.memory, this.engine
        );

        if (evalReport.verdict === 'APPROVED') {
          completedTasks++;
          console.log(`  ✅ Task #${task.id} 完成 (${completedTasks}/${tasks.length})`);
          approved = true;
          break;
        }

        // REJECTED: 反馈注入
        if (round < MAX_ROUNDS) {
          const fb = evalReport.issues.slice(0, 3).join('; ');
          console.log(`  ❌ 第${round}轮未通过: ${fb}`);
          const feedbackText = '\n\n## Evaluator 反馈(第' + round + '轮)\n' +
            evalReport.issues.map((s: string, i: number) => (i + 1) + '. ' + s).join('\n');
          project.dag.update(task.id, {
            description: task.description + feedbackText,
          });
        } else {
          project.dag.update(task.id, { status: 'failed' });
          console.log(`  ❌ Task #${task.id} ${MAX_ROUNDS}轮后未通过`);
          project.memory.put({
            namespace: 'global',
            type: 'anti_pattern',
            content: 'Task #' + task.id + ' "' + task.subject + '" failed after ' +
              MAX_ROUNDS + ' rounds: ' + evalReport.issues.slice(0, 3).join('; '),
            score: 0.9,
          });
        }
      }

      if (!approved) break;
    }

    // Phase 3: DevOps 部署检查
    project.status = 'reviewing';
    console.log('\n🚀 Phase 3: 部署检查');
    const { deploy } = await import('./devops.js');
    const deployResult = await deploy(project.projectDir, project.dag, project.memory, this.engine);
    if (deployResult.success) {
      project.status = 'deployed';
      console.log(`  ✅ 部署就绪 (${deployResult.configs.length} 配置文件)`);
    } else {
      console.log(`  ⚠️  部署暂停: ${deployResult.issues.join(', ')}`);
    }
    
    // 保存部署报告
    const { writeFileSync: wfs } = await import('fs');
    wfs(
      join(project.projectDir, '.tasks', 'DEPLOY.md'),
      `# 部署报告: ${project.name}\n> ${new Date().toISOString()}\n\n` +
      `状态: ${deployResult.success ? '就绪' : '暂停'}\n` +
      `配置: ${deployResult.configs.length} 个\n` +
      `问题: ${deployResult.issues.length > 0 ? deployResult.issues.join(', ') : '无'}\n`
    );

    // Phase 4: Marketing SEO 优化
    if (deployResult.success) {
      console.log('\n📈 Phase 4: SEO + 营销优化');
      const { optimizeMarketing } = await import('./marketing.js');
      const seoResult = await optimizeMarketing(project.projectDir, project.memory, this.engine);
      if (seoResult.success) {
        wfs(
          join(project.projectDir, '.tasks', 'SEO.md'),
          `# SEO 优化报告: ${project.name}\n> ${new Date().toISOString()}\n\n` +
          `优化完成: ${seoResult.seoOptimized ? '是' : '否'}\n` +
          `Analytics: ${seoResult.analyticsAdded ? '已添加' : '未添加'}\n` +
          `建议 (${seoResult.suggestions.length} 条):\n` +
          seoResult.suggestions.map((s: string) => `- ${s}`).join('\n')
        );
        console.log(`  ✅ SEO 优化完成`);
      }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`🏁 项目完成: ${completedTasks}/${tasks.length} 个任务通过`);
    console.log(project.dag.summary());
  }

  saveState(project: Project): string {
    const dag = project.dag;
    const tasks = dag.list();
    const completed = tasks.filter(t => t.status === 'completed');
    const inProgress = tasks.filter(t => t.status === 'in_progress');
    const pending = tasks.filter(t => t.status === 'pending');
    const failed = tasks.filter(t => t.status === 'failed');
    
    const handoff = [
      '# Handoff: ' + project.name,
      '> 生成时间: ' + new Date().toISOString(),
      '',
      '## 项目状态: ' + project.status,
      '',
      '## 完成 (' + completed.length + '/' + tasks.length + ')',
      ...completed.map(t => '- [x] #' + t.id + ' ' + t.subject),
      '',
      '## 进行中',
      ...inProgress.map(t => '- [~] #' + t.id + ' ' + t.subject),
      '',
      '## 待办',
      ...pending.map(t => '- [ ] #' + t.id + ' ' + t.subject),
      '',
      '## 失败',
      ...failed.map(t => '- [!] #' + t.id + ' ' + t.subject),
      '',
      '## 审批中',
      ...project.protocol.listPending('user').map(r => '- [' + r.id + '] ' + r.subject),
    ].join('\n');
    
    const path = join(project.projectDir, '.tasks', 'HANDOFF.md');
    writeFileSync(path, handoff);
    console.log('📝 Handoff 已保存: ' + path);
    return path;
  }

  resume(project: Project): boolean {
    const path = join(project.projectDir, '.tasks', 'HANDOFF.md');
    if (!existsSync(path)) {
      console.log('未找到 HANDOFF.md');
      return false;
    }
    const content = readFileSync(path, 'utf-8');
    const statusMatch = content.match(/项目状态: (\w+)/);
    if (statusMatch) {
      project.status = statusMatch[1] as ProjectStatus;
    }
    console.log('📝 已从 HANDOFF 恢复项目: ' + project.name);
    return true;
  }

  getUserInbox(projectId: string): ProtocolRequest[] {
    const project = this.projects.get(projectId);
    return project ? project.protocol.getUserInbox() : [];
  }

  runAsync(project: Project, requirement: string): Promise<void> {
    return this.run(project, requirement).catch(err => {
      console.error(`[${project.name}] 异常:`, err?.message || err);
      throw err; // P0修复: 重新抛出，调用者可以感知失败
    });
  }

  listProjects(): Project[] {
    return [...this.projects.values()];
  }

  approve(projectId: string, requestId: string, approved: boolean, reason?: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    const req = project.protocol.respond(requestId, approved ? 'approved' : 'rejected', reason);
    return !!req;
  }
}
