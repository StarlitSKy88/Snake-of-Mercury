import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentMemory } from '../memory/agent-memory.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function tmpDir() {
  const d = join(tmpdir(), `mem-${Date.now()}-${Math.random().toString(36).slice(2,6)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

describe('AgentMemory', () => {
  let mem: AgentMemory;
  let dir: string;

  beforeEach(() => { dir = tmpDir(); mem = new AgentMemory(dir); });
  afterEach(() => { mem.close(); if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); });

  it('写入和读取', () => {
    const e = mem.put({ namespace: 'test', type: 'pattern', content: 'hello world' });
    const r = mem.get(e.id);
    expect(r?.content).toBe('hello world');
  });

  it('key 去重更新', () => {
    mem.put({ namespace: 'test', type: 'pattern', key: 'dup', content: 'v1' });
    mem.put({ namespace: 'test', type: 'pattern', key: 'dup', content: 'v2' });
    const results = mem.query({ namespace: 'test' });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('v2');
  });

  it('按 namespace 隔离', () => {
    mem.put({ namespace: 'proj-a', type: 'pattern', content: 'a' });
    mem.put({ namespace: 'proj-b', type: 'pattern', content: 'b' });
    expect(mem.query({ namespace: 'proj-a' })).toHaveLength(1);
    expect(mem.query({ namespace: 'proj-b' })).toHaveLength(1);
  });

  it('文本搜索', () => {
    mem.put({ namespace: 'test', type: 'pattern', content: '计数器实现方案' });
    mem.put({ namespace: 'test', type: 'fix', content: '修复内存泄漏' });
    const r = mem.query({ namespace: 'test', textSearch: '计数器' });
    expect(r).toHaveLength(1);
  });

  it('语义搜索排序', () => {
    mem.put({ namespace: 'test', type: 'pattern', content: 'React SSR 渲染优化', score: 0.9 });
    mem.put({ namespace: 'test', type: 'fix', content: '修复 CSS 样式问题', score: 0.5 });
    const r = mem.search('SSR 优化', 'test');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].entry.content).toContain('SSR');
  });

  it('持久化恢复', () => {
    mem.put({ namespace: 'test', type: 'pattern', content: 'persist me' });
    mem.flush();
    mem.close();

    const mem2 = new AgentMemory(dir);
    const r = mem2.query({ namespace: 'test' });
    expect(r).toHaveLength(1);
    expect(r[0].content).toBe('persist me');
    mem2.close();
  });

  it('统计', () => {
    mem.put({ namespace: 'a', type: 'pattern', content: '1' });
    mem.put({ namespace: 'a', type: 'fix', content: '2' });
    mem.put({ namespace: 'b', type: 'pattern', content: '3' });
    const s = mem.stats();
    expect(s.totalEntries).toBe(3);
    expect(s.byNamespace['a']).toBe(2);
  });
});
