/**
 * Task DAG — 磁盘持久化的任务依赖图
 * 
 * 这是整个系统的协调骨架。每个任务是一个 JSON 文件。
 * 任务之间有 blockedBy 依赖关系，形成有向无环图。
 * 完成任务自动解锁后续任务。
 * 
 * 目录结构:
 *   .tasks/
 *     task_0001.json
 *     task_0002.json
 *     task_0003.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

// ============ 类型 ============

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface Task {
  id: number;
  subject: string;
  description: string;
  status: TaskStatus;
  blockedBy: number[];
  owner: string;          // Agent ID 或 'unassigned'
  acceptanceCriteria: string[];
  impactLevel: number;    // 0=修Bug 1=新功能 2=API变更 3=关键
  evidence?: string;      // CodeExecutor 收集的验证证据
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ============ 核心 ============

export class TaskDAG {
  private tasksDir: string;
  private nextId: number;

  constructor(projectDir: string) {
    this.tasksDir = join(projectDir, '.tasks');
    mkdirSync(this.tasksDir, { recursive: true });
    this.nextId = this._findMaxId() + 1;
  }

  // ===== CRUD =====

  /** 创建任务 */
  create(subject: string, opts: Partial<Task> = {}): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: this.nextId++,
      subject,
      description: opts.description || '',
      status: 'pending',
      blockedBy: opts.blockedBy || [],
      owner: opts.owner || 'unassigned',
      acceptanceCriteria: opts.acceptanceCriteria || [],
      impactLevel: opts.impactLevel ?? 1,
      createdAt: now,
      updatedAt: now,
    };
    this._save(task);
    return task;
  }

  /** 获取任务 */
  get(id: number): Task | null {
    const path = this._taskPath(id);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return null;
    }
  }

  /** 列出所有任务 */
  list(): Task[] {
    return readdirSync(this.tasksDir)
      .filter(f => f.startsWith('task_') && f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(readFileSync(join(this.tasksDir, f), 'utf-8')); }
        catch { return null; }
      })
      .filter((t): t is Task => t !== null)
      .sort((a, b) => a.id - b.id);
  }

  /** 更新任务 */
  update(id: number, partial: Partial<Task>): Task | null {
    const task = this.get(id);
    if (!task) return null;

    const updated = { ...task, ...partial, updatedAt: new Date().toISOString() };
    if (partial.status === 'completed' && !updated.completedAt) {
      updated.completedAt = new Date().toISOString();
    }

    // 完成任务时自动解除对其他任务的阻塞
    if (partial.status === 'completed') {
      this._clearBlock(id);
    }

    this._save(updated);
    return updated;
  }

  /** 删除任务 */
  delete(id: number): boolean {
    const path = this._taskPath(id);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }

  // ===== 依赖查询 =====

  /** 可以做的任务（pending 且所有前置已完成） */
  getReady(): Task[] {
    return this.list().filter(t => 
      t.status === 'pending' && 
      t.blockedBy.every(depId => {
        const dep = this.get(depId);
        return dep && dep.status === 'completed';
      })
    );
  }

  /** 被阻塞的任务 */
  getBlocked(): Task[] {
    return this.list().filter(t =>
      t.status === 'pending' &&
      t.blockedBy.some(depId => {
        const dep = this.get(depId);
        return !dep || dep.status !== 'completed';
      })
    );
  }

  /** 未认领的任务 */
  getUnclaimed(): Task[] {
    return this.list().filter(t => 
      t.owner === 'unassigned' && 
      t.status === 'pending'
    );
  }

  /** 已完成的 */
  getCompleted(): Task[] {
    return this.list().filter(t => t.status === 'completed');
  }

  /** 进度摘要 */
  summary(): string {
    const all = this.list();
    const done = all.filter(t => t.status === 'completed').length;
    const doing = all.filter(t => t.status === 'in_progress').length;
    const pending = all.filter(t => t.status === 'pending').length;
    const failed = all.filter(t => t.status === 'failed').length;
    return `${done}/${all.length} done, ${doing} in progress, ${pending} pending, ${failed} failed`;
  }

  // ===== 内部 =====

  private _save(task: Task): void {
    writeFileSync(this._taskPath(task.id), JSON.stringify(task, null, 2));
  }

  private _taskPath(id: number): string {
    return join(this.tasksDir, `task_${String(id).padStart(4, '0')}.json`);
  }

  private _findMaxId(): number {
    const files = readdirSync(this.tasksDir).filter(f => f.match(/^task_\d+\.json$/));
    if (files.length === 0) return 0;
    return Math.max(...files.map(f => {
      const match = f.match(/^task_(\d+)\.json$/);
      return match ? parseInt(match[1]) : 0;
    }));
  }

  /** 完成任务时清除它作为其他任务的前置依赖 */
  private _clearBlock(completedId: number): void {
    for (const task of this.list()) {
      if (task.blockedBy.includes(completedId)) {
        task.blockedBy = task.blockedBy.filter(id => id !== completedId);
        this._save(task);
      }
    }
  }
}
