/**
 * CEO Agent — 用户代理 + 项目生命周期管理
 * 
 * 与旧架构的关键区别:
 *   旧: CEO 是纯编排器，不调用 LLM
 *   新: CEO 通过 ProtocolRequest 与用户沟通，通过 TaskDAG 管理项目
 */

import { TaskDAG } from '../core/task-dag.js';
import { ProtocolBus, type ProtocolRequest } from '../core/protocol.js';
import { Gate } from '../core/gate.js';
import { AgentMemory } from '../core/memory.js';
import { plan } from './planner.js';
import { generate } from './generator.js';
import { evaluate } from './evaluator.js';
import { deploy } from './devops.js';
import { optimizeMarketing } from './marketing.js';
import type { AgentEngine } from '../utils/agent-executor.js';

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

  /** 创建新项目 */
  createProject(name: string, dir: string): Project {
    const id = `proj-${Date.now()}`;
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
    // 让 gate 使用正确的 protocol 实例
    (project as any).gate = new Gate(project.protocol);
    this.projects.set(id, project);
    console.log(`\n👑 [CEO] 项目创建: ${name} (${id})`);
    return project;
  }

  /** 运行完整流水线 */
  async run(project: Project, requirement: string): Promise<void> {
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

    // 检查是否需要审批
    const highImpact = tasks.filter(t => t.impactLevel >= 2);
    if (highImpact.length > 0) {
      const req = project.protocol.request(
        'plan_approval',
        'planner',
        'user',
        `发现 ${highImpact.length} 个高影响任务`,
        highImpact.map(t => `- Task #${t.id}: ${t.subject} (P${t.impactLevel})`).join('\n')
      );
      console.log(`⏸️  等待用户审批: approve ${req.id}`);
      // 在实际系统中，这里会等待用户审批。目前继续执行。
    }

    // Phase 2: 逐个执行 ready 任务（Ralph Loop: Generator ⇄ Evaluator）
    project.status = 'building';
    console.log('\n🔨 Phase 2: 执行任务 (Ralph Loop: 评估不通过→反馈→重试, 最大3轮)');

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

      // Gate: 检查影响级别
      const gateCheck = await project.gate.check(
        task.subject, task.description, 'generator'
      );
      if (gateCheck.blocked) {
        console.log(`  ⏸️  Task #${task.id} 需要审批 (P${task.impactLevel})`);
        continue;
      }

      // Ralph Loop: Generator ⇄ Evaluator, 最大 3 轮
      const MAX_ROUNDS = 3;
      let approved = false;

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        if (round > 1) console.log(`  🔄 重试第 ${round}/${MAX_ROUNDS} 轮`);

        const genResult = await generate(
          task, project.projectDir, project.dag, project.memory, this.engine
        );

        if (!genResult.success) {
          console.log(`  ⚠️  Generator 失败 (第${round}轮)`);
          continue;
        }

        const evalReport = await evaluate(
          task, genResult.output, genResult.evidence, project.dag, project.memory, this.engine
        );

        if (evalReport.verdict === 'APPROVED') {
          completedTasks++;
          console.log(`  ✅ Task #${task.id} 完成 (${completedTasks}/${tasks.length})`);
          approved = true;
          break;
        }

        // REJECTED: 反馈注入，下一轮 Generator 可读取
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

    console.log(`\n${'='.repeat(50)}`);
    console.log(`🏁 项目完成: ${completedTasks}/${tasks.length} 个任务通过`);
    console.log(project.dag.summary());
  }

  /** 获取用户待审批列表 */
  getUserInbox(projectId: string): ProtocolRequest[] {
    const project = this.projects.get(projectId);
    return project ? project.protocol.getUserInbox() : [];
  }

  /** 用户审批 */
  approve(projectId: string, requestId: string, approved: boolean, reason?: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    const req = project.protocol.respond(requestId, approved ? 'approved' : 'rejected', reason);
    return !!req;
  }
}
