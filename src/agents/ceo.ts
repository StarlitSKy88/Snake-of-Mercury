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
import type { AgentEngine } from '../utils/agent-executor.js';

// ============ 类型 ============

export type ProjectStatus = 'created' | 'planning' | 'building' | 'reviewing' | 'deployed' | 'paused';

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
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
    project.dag = await plan(requirement, project.dag['tasksDir'].replace('/.tasks', ''), this.engine);
    
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
      
      // 在实际系统中，这里会等待。现在我们继续。
    }

    // Phase 2: 逐个执行 ready 任务
    project.status = 'building';
    console.log('\n🔨 Phase 2: 执行任务');

    let completedTasks = 0;
    const maxTasks = tasks.length * 3; // 允许重试

    for (let iter = 0; iter < maxTasks; iter++) {
      const ready = project.dag.getReady();
      if (ready.length === 0) {
        const blocked = project.dag.getBlocked();
        if (blocked.length === 0) break; // 全部完成
        console.log(`  等待依赖: ${blocked.map(t => `#${t.id}`).join(', ')}`);
        continue;
      }

      const task = ready[0]; // 取第一个 ready 任务

      // Gate: 检查影响级别
      const gateCheck = await project.gate.check(
        task.subject, task.description, 'generator'
      );
      if (gateCheck.blocked) {
        console.log(`  ⏸️  Task #${task.id} 需要审批 (P${task.impactLevel})`);
        continue;
      }

      // Generator → Evaluator
      const genResult = await generate(task, project.dag['tasksDir'].replace('/.tasks', ''), project.dag, project.memory, this.engine);

      if (genResult.success) {
        const evalReport = await evaluate(task, genResult.output, genResult.evidence, project.dag, project.memory, this.engine);
        if (evalReport.verdict === 'APPROVED') {
          completedTasks++;
          console.log(`  ✅ Task #${task.id} 完成 (${completedTasks}/${tasks.length})`);
        } else {
          project.dag.update(task.id, { status: 'failed' });
          console.log(`  ❌ Task #${task.id} 评估未通过`);
        }
      } else {
        project.dag.update(task.id, { status: 'failed' });
      }
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
