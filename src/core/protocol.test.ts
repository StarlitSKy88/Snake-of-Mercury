import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProtocolBus } from './protocol.js';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(process.cwd(), '.test-protocol');

describe('ProtocolBus', () => {
  let bus: ProtocolBus;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    bus = new ProtocolBus(TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('发起请求返回完整结构', () => {
    const req = bus.request('plan_approval', 'planner', 'ceo', '审批计划', '详细内容');
    expect(req.id).toMatch(/^req-/);
    expect(req.type).toBe('plan_approval');
    expect(req.from).toBe('planner');
    expect(req.to).toBe('ceo');
    expect(req.status).toBe('pending');
  });

  it('响应 pending 请求成功', () => {
    const req = bus.request('deployment', 'ceo', 'user', '部署上线', '...');
    const resolved = bus.respond(req.id, 'approved', '同意');
    expect(resolved?.status).toBe('approved');
    expect(resolved?.resolution).toBe('同意');
    expect(resolved?.resolvedAt).toBeTruthy();
  });

  it('重复响应返回 null', () => {
    const req = bus.request('shutdown', 'ceo', 'generator', '关机', '');
    bus.respond(req.id, 'approved');
    expect(bus.respond(req.id, 'rejected')).toBeNull();
  });

  it('listPending() 过滤', () => {
    bus.request('plan_approval', 'planner', 'user', 'S1', '');
    bus.request('plan_approval', 'planner', 'ceo', 'S2', '');
    expect(bus.listPending('user').length).toBe(1);
    expect(bus.listPending('ceo').length).toBe(1);
    expect(bus.listPending().length).toBe(2);
  });

  it('响应后不再 pending', () => {
    const req = bus.request('pivot', 'planner', 'user', '改方向', '');
    bus.respond(req.id, 'rejected', '不需要');
    expect(bus.listPending().length).toBe(0);
  });

  it('get 不存在的请求返回 null', () => {
    expect(bus.get('req-nonexistent')).toBeNull();
  });

  it('持久化: 数据跨实例保留', () => {
    const req = bus.request('escalation', 'generator', 'ceo', '报错', 'error');
    const bus2 = new ProtocolBus(TEST_DIR);
    const loaded = bus2.get(req.id);
    expect(loaded?.subject).toBe('报错');
    expect(loaded?.status).toBe('pending');
  });

  it('getUserInbox() 只返回发给 user 的 pending', () => {
    bus.request('deployment', 'ceo', 'user', '需要审批上线', '');
    bus.request('shutdown', 'ceo', 'generator', '内部关机', '');
    const inbox = bus.getUserInbox();
    expect(inbox.length).toBe(1);
    expect(inbox[0].to).toBe('user');
  });

  it('listAll() 按时间排序', () => {
    bus.request('plan_approval', 'a', 'b', 'First', '');
    bus.request('plan_approval', 'c', 'd', 'Second', '');
    const all = bus.listAll();
    expect(new Date(all[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(all[1].createdAt).getTime()
    );
  });
});
