import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskDAG } from './task-dag.js';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(process.cwd(), '.test-task-dag');

describe('TaskDAG', () => {
  let dag: TaskDAG;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    dag = new TaskDAG(TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('创建任务返回正确结构', () => {
    const task = dag.create('实现登录');
    expect(task.id).toBe(1);
    expect(task.subject).toBe('实现登录');
    expect(task.status).toBe('pending');
    expect(task.blockedBy).toEqual([]);
    expect(task.owner).toBe('unassigned');
    expect(task.acceptanceCriteria).toEqual([]);
    expect(task.createdAt).toBeTruthy();
  });

  it('任务 ID 自增', () => {
    const t1 = dag.create('Task A');
    const t2 = dag.create('Task B');
    expect(t1.id).toBe(1);
    expect(t2.id).toBe(2);
  });

  it('支持 blockedBy 依赖', () => {
    dag.create('Task 1');
    dag.create('Task 2', { blockedBy: [1] });
    const t2 = dag.get(2);
    expect(t2?.blockedBy).toEqual([1]);
  });

  it('getReady(): 无依赖任务立即可做', () => {
    dag.create('Task A');
    dag.create('Task B', { blockedBy: [1] });
    const ready = dag.getReady();
    expect(ready.map(t => t.id)).toEqual([1]);
  });

  it('getReady(): 依赖完成后才可做', () => {
    dag.create('Task A');
    dag.create('Task B', { blockedBy: [1] });
    dag.update(1, { status: 'completed' });
    const ready = dag.getReady();
    expect(ready.map(t => t.id)).toEqual([2]);
  });

  it('完成任务自动清除对其他任务的阻塞', () => {
    dag.create('Task A');
    const tb = dag.create('Task B', { blockedBy: [1] });
    // 初始被阻塞
    expect(dag.getReady().length).toBe(1);
    // 完成 A
    dag.update(1, { status: 'completed' });
    expect(dag.getReady().length).toBe(1);
    const bAfter = dag.get(2);
    expect(bAfter?.blockedBy).toEqual([]);
  });

  it('getBlocked(): 被依赖未完成的任务', () => {
    dag.create('Task A');
    dag.create('Task B', { blockedBy: [1] });
    const blocked = dag.getBlocked();
    expect(blocked.map(t => t.id)).toEqual([2]);
  });

  it('summary() 正确统计', () => {
    dag.create('A');
    dag.create('B');
    dag.update(1, { status: 'completed' });
    expect(dag.summary()).toContain('1/2 done');
  });

  it('持久化: 重新加载保留数据', () => {
    dag.create('Task X');
    dag.update(1, { status: 'completed' });
    const dag2 = new TaskDAG(TEST_DIR);
    const t = dag2.get(1);
    expect(t?.subject).toBe('Task X');
    expect(t?.status).toBe('completed');
  });

  it('projectDir getter 正确返回', () => {
    expect(dag.projectDir).toBe(TEST_DIR);
  });

  it('空 DAG getReady 返回空数组', () => {
    expect(dag.getReady()).toEqual([]);
  });

  it('多级依赖链正确', () => {
    dag.create('T1');
    dag.create('T2', { blockedBy: [1] });
    dag.create('T3', { blockedBy: [2] });
    dag.update(1, { status: 'completed' });
    expect(dag.getReady().map(t => t.id)).toEqual([2]);
    dag.update(2, { status: 'completed' });
    expect(dag.getReady().map(t => t.id)).toEqual([3]);
  });

  it('delete 删除任务', () => {
    dag.create('Task to delete');
    expect(dag.delete(1)).toBe(true);
    expect(dag.get(1)).toBeNull();
  });

  it('update 不存在的任务返回 null', () => {
    expect(dag.update(999, { status: 'completed' })).toBeNull();
  });

  it('删除任务后文件不存在', () => {
    dag.create('T');
    dag.delete(1);
    expect(existsSync(join(TEST_DIR, 'task_0001.json'))).toBe(false);
  });
});
