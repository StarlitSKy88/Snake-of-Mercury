/**
 * EventBus 测试 — Agent 通信中枢
 * 
 * 核心验证：
 * 1. 发布/订阅基本流程
 * 2. 事件持久化 (JSONL)
 * 3. 通配符订阅
 * 4. 历史查询
 * 5. 取消订阅
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus, type BusEvent, type EventType } from '../event-bus.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function tmpDir() {
  const dir = join(tmpdir(), `eb-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('EventBus', () => {
  let bus: EventBus;
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    bus = new EventBus(dir);
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  // ========== 基础功能 ==========

  it('应该能发布和接收事件', () => {
    const received: BusEvent[] = [];
    bus.on('phase:started', (e) => { void received.push(e); });

    bus.emit('phase:started', 'harness', { phase: 'phase0' });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('phase:started');
    expect(received[0].source).toBe('harness');
    expect(received[0].payload.phase).toBe('phase0');
  });

  it('事件应该有唯一ID和时间戳', () => {
    const received: BusEvent[] = [];
    bus.on('sprint:passed', (e) => { void received.push(e); });

    bus.emit('sprint:passed', 'evaluator', { sprintNumber: 1 });

    expect(received[0].id).toMatch(/^evt-/);
    expect(received[0].timestamp).toBeTruthy();
    expect(new Date(received[0].timestamp).getTime()).toBeLessThanOrEqual(Date.now());
  });

  // ========== 订阅隔离 ==========

  it('应该只通知订阅了对应事件类型的handler', () => {
    const phaseEvents: BusEvent[] = [];
    const sprintEvents: BusEvent[] = [];

    bus.on('phase:completed', (e) => { void phaseEvents.push(e); });
    bus.on('sprint:passed', (e) => { void sprintEvents.push(e); });

    bus.emit('sprint:passed', 'evaluator', { sprintNumber: 1 });

    expect(phaseEvents).toHaveLength(0);
    expect(sprintEvents).toHaveLength(1);
  });

  // ========== 通配符 ==========

  it('通配符 * 应该接收所有事件', () => {
    const all: BusEvent[] = [];
    bus.on('*' as EventType, (e) => { void all.push(e); });

    bus.emit('phase:started', 'harness', {});
    bus.emit('sprint:passed', 'evaluator', {});
    bus.emit('ceo:project_created', 'ceo', {});

    expect(all).toHaveLength(3);
  });

  // ========== 取消订阅 ==========

  it('取消订阅后不应再收到事件', () => {
    const received: BusEvent[] = [];
    const unsub = bus.on('phase:started', (e) => { void received.push(e); });

    bus.emit('phase:started', 'harness', {});
    expect(received).toHaveLength(1);

    unsub();
    bus.emit('phase:started', 'harness', {});
    expect(received).toHaveLength(1); // 不再增长
  });

  // ========== onMany ==========

  it('onMany 可以订阅多种事件类型', () => {
    const received: BusEvent[] = [];
    bus.onMany(['sprint:passed', 'sprint:rejected'], (e) => { void received.push(e); });

    bus.emit('sprint:passed', 'evaluator', { sprintNumber: 1 });
    bus.emit('sprint:rejected', 'evaluator', { sprintNumber: 2 });
    bus.emit('phase:started', 'harness', {}); // 不应收到

    expect(received).toHaveLength(2);
  });

  // ========== 持久化 ==========

  it('事件应持久化到 JSONL 文件', () => {
    bus.emit('ceo:project_created', 'ceo', { name: 'test-project' });
    bus.emit('sprint:passed', 'evaluator', { sprintNumber: 1 });

    // 创建新的 EventBus 实例从文件加载
    const bus2 = new EventBus(dir);
    const history = bus2.getHistory();

    expect(history).toHaveLength(2);
    expect(history[0].type).toBe('ceo:project_created');
    expect(history[1].type).toBe('sprint:passed');
  });

  // ========== 历史查询 ==========

  it('getHistory 应该按类型过滤', () => {
    bus.emit('phase:started', 'harness', {});
    bus.emit('sprint:passed', 'evaluator', { sprintNumber: 1 });
    bus.emit('phase:completed', 'harness', {});

    const phaseEvents = bus.getHistory({ type: 'phase:started' });
    expect(phaseEvents).toHaveLength(1);

    const sprintEvents = bus.getHistory({ type: 'sprint:passed' });
    expect(sprintEvents).toHaveLength(1);
  });

  it('getHistory 应该按 projectId 过滤', () => {
    bus.emit('sprint:started', 'ralph-loop', { sprintNumber: 1 }, { projectId: 'proj-A' });
    bus.emit('sprint:started', 'ralph-loop', { sprintNumber: 1 }, { projectId: 'proj-B' });
    bus.emit('sprint:started', 'ralph-loop', { sprintNumber: 2 }, { projectId: 'proj-A' });

    const projA = bus.getHistory({ projectId: 'proj-A' });
    expect(projA).toHaveLength(2);

    const projB = bus.getHistory({ projectId: 'proj-B' });
    expect(projB).toHaveLength(1);
  });

  it('getHistory 应该限制返回数量', () => {
    for (let i = 0; i < 20; i++) {
      bus.emit('sprint:passed', 'evaluator', { sprintNumber: i });
    }

    const limited = bus.getHistory({ limit: 5 });
    expect(limited).toHaveLength(5);
    // 应该是最后5个
    expect(limited[0].payload.sprintNumber).toBe(15);
  });

  it('getProjectTimeline 应该返回项目完整时间线', () => {
    bus.emit('ceo:project_created', 'ceo', {}, { projectId: 'proj-X' });
    bus.emit('phase:started', 'harness', {}, { projectId: 'proj-X' });
    bus.emit('sprint:passed', 'evaluator', {}, { projectId: 'proj-X' });
    bus.emit('ceo:project_created', 'ceo', {}, { projectId: 'proj-Y' });

    const timeline = bus.getProjectTimeline('proj-X');
    expect(timeline).toHaveLength(3);
  });

  // ========== target 字段 ==========

  it('事件应该包含可选的 target 字段', () => {
    const received: BusEvent[] = [];
    bus.on('ceo:approval_needed', (e) => { void received.push(e); });

    bus.emit('ceo:approval_needed', 'devops', { msg: '磁盘满' }, { target: 'ceo' });

    expect(received[0].target).toBe('ceo');
  });

  // ========== 错误处理 ==========

  it('handler 抛异常不应影响其他 handler', () => {
    const good: BusEvent[] = [];
    bus.on('sprint:passed', () => { throw new Error('boom'); });
    bus.on('sprint:passed', (e) => { void good.push(e); });

    expect(() => {
      bus.emit('sprint:passed', 'evaluator', {});
    }).not.toThrow();

    expect(good).toHaveLength(1);
  });

  // ========== 并发安全 ==========

  it('多个 handler 的异步操作不应互相阻塞', async () => {
    const results: string[] = [];
    bus.on('sprint:passed', async (e) => {
      await new Promise(r => setTimeout(r, 50));
      results.push('handler1');
    });
    bus.on('sprint:passed', async (e) => {
      results.push('handler2');
    });

    bus.emit('sprint:passed', 'evaluator', {});

    // 等待异步 handler
    await new Promise(r => setTimeout(r, 100));

    expect(results).toContain('handler1');
    expect(results).toContain('handler2');
  });

  // ========== CEO 事件流 ==========

  it('CEO 项目创建 → DevOps 监控 完整事件流', () => {
    const events: string[] = [];
    bus.on('*' as EventType, (e) => { void events.push(e.type); });

    bus.emit('ceo:project_created', 'ceo', { name: '测试项目' }, { projectId: 'p1' });
    bus.emit('devops:incident', 'devops', { error: '503' }, { projectId: 'p1' });
    bus.emit('devops:auto_fixed', 'devops', { fix: 'restart' }, { projectId: 'p1' });
    bus.emit('ceo:approval_needed', 'devops', { msg: '需扩容' }, { projectId: 'p1', target: 'ceo' });

    expect(events).toEqual([
      'ceo:project_created',
      'devops:incident',
      'devops:auto_fixed',
      'ceo:approval_needed',
    ]);
  });
});
