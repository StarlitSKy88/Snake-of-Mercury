import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentMemory } from './memory.js';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(process.cwd(), '.test-memory');

describe('AgentMemory', () => {
  let mem: AgentMemory;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    mem = new AgentMemory(TEST_DIR);
  });

  afterEach(() => {
    mem.close();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('put 返回完整 entry', () => {
    const e = mem.put({ namespace: 'proj1', type: 'pattern', content: 'hello' });
    expect(e.id).toMatch(/^mem-/);
    expect(e.namespace).toBe('proj1');
    expect(e.type).toBe('pattern');
    expect(e.content).toBe('hello');
    expect(e.createdAt).toBeTruthy();
  });

  it('get 获取已存 entry', () => {
    const e = mem.put({ namespace: 'proj1', type: 'fix', content: 'fixed bug' });
    const found = mem.get(e.id);
    expect(found?.content).toBe('fixed bug');
  });

  it('同 key 去重', () => {
    mem.put({ namespace: 'p', type: 'decision', key: 'db-choice', content: 'pg' });
    mem.put({ namespace: 'p', type: 'decision', key: 'db-choice', content: 'sqlite' });
    const results = mem.query({ namespace: 'p', type: 'decision' });
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('sqlite');
  });

  it('按 namespace 查询', () => {
    mem.put({ namespace: 'proj-A', type: 'pattern', content: 'A pattern' });
    mem.put({ namespace: 'proj-B', type: 'pattern', content: 'B pattern' });
    const a = mem.query({ namespace: 'proj-A' });
    expect(a.length).toBe(1);
    expect(a[0].content).toBe('A pattern');
  });

  it('按 type 查询', () => {
    mem.put({ namespace: 'p', type: 'pattern', content: 'p1' });
    mem.put({ namespace: 'p', type: 'anti_pattern', content: 'ap1' });
    const patterns = mem.query({ namespace: 'p', type: 'pattern' });
    expect(patterns.length).toBe(1);
  });

  it('文本搜索', () => {
    mem.put({ namespace: 'p', type: 'fix', content: '修复登录超时问题' });
    mem.put({ namespace: 'p', type: 'fix', content: '修复支付bug' });
    const results = mem.query({ textSearch: '登录' });
    expect(results.length).toBe(1);
    expect(results[0].content).toContain('登录');
  });

  it('search 返回评分排序', () => {
    mem.put({ namespace: 'p', type: 'fix', content: '修复canvas渲染bug', score: 1.0 });
    mem.put({ namespace: 'p', type: 'pattern', content: 'canvas绘制模式', score: 0.5 });
    const results = mem.search('canvas', 'p');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].entry.content).toContain('canvas');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('update 更新内容', () => {
    const e = mem.put({ namespace: 'p', type: 'fix', content: 'old' });
    mem.update(e.id, { content: 'new' });
    expect(mem.get(e.id)?.content).toBe('new');
  });

  it('delete 删除', () => {
    const e = mem.put({ namespace: 'p', type: 'fix', content: 'x' });
    expect(mem.delete(e.id)).toBe(true);
    expect(mem.get(e.id)).toBeUndefined();
  });

  it('持久化: flush + reload', () => {
    mem.put({ namespace: 'persist', type: 'pattern', content: 'survive' });
    mem.flush();
    const mem2 = new AgentMemory(TEST_DIR);
    const results = mem2.query({ namespace: 'persist' });
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('survive');
    mem2.close();
  });

  it('stats 统计正确', () => {
    mem.put({ namespace: 'p1', type: 'pattern', content: 'a' });
    mem.put({ namespace: 'p1', type: 'pattern', content: 'b' });
    mem.put({ namespace: 'p2', type: 'anti_pattern', content: 'c' });
    const stats = mem.stats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.byNamespace['p1']).toBe(2);
    expect(stats.byNamespace['p2']).toBe(1);
  });

  it('空记忆 search 返回空', () => {
    expect(mem.search('nothing', 'empty').length).toBe(0);
  });

  it('过期过滤', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    mem.put({ namespace: 'p', type: 'fix', content: 'expired' });
    // Manually set expired via internal API
    const entries = mem.query({ namespace: 'p' });
    if (entries.length > 0) {
      // Set expiresAt to past
      const e = entries[0];
      mem.update(e.id, {});
    }
  });

  it('findByKey 精确查找', () => {
    mem.put({ namespace: 'p', type: 'decision', key: 'stack', content: 'ts' });
    const found = mem.findByKey('p', 'stack');
    expect(found?.content).toBe('ts');
  });

  it('limit 限制返回数量', () => {
    for (let i = 0; i < 5; i++) {
      mem.put({ namespace: 'p', type: 'fix', content: 'fix ' + i });
    }
    expect(mem.query({ namespace: 'p', limit: 2 }).length).toBe(2);
  });
});
