import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Pipeline, type Middleware, type PipelineContext } from '../middleware/pipeline.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function tmpDir() {
  const d = join(tmpdir(), `pipe-${Date.now()}-${Math.random().toString(36).slice(2,6)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

describe('Pipeline', () => {
  let dir: string;
  let pipeline: Pipeline;

  beforeEach(() => { dir = tmpDir(); pipeline = new Pipeline('test-proj', dir); });
  afterEach(() => { pipeline.shutdown(); if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); });

  it('应顺序执行中间件', async () => {
    const order: string[] = [];
    pipeline.useAll([
      { name: 'A', phase: 'p1', async run(ctx, next) { order.push('A'); await next(); } },
      { name: 'B', phase: 'p2', async run(ctx, next) { order.push('B'); await next(); } },
      { name: 'C', phase: 'p3', async run(ctx, next) { order.push('C'); await next(); } },
    ]);

    await pipeline.run('test', dir);
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('上下文在中间件间传递', async () => {
    pipeline.useAll([
      { name: 'Writer', phase: 'p1', async run(ctx, next) { ctx.myData = 'hello'; await next(); } },
      { name: 'Reader', phase: 'p2', async run(ctx, next) { ctx.readBack = ctx.myData; await next(); } },
    ]);

    const ctx = await pipeline.run('test', dir);
    expect(ctx.myData).toBe('hello');
    expect(ctx.readBack).toBe('hello');
  });

  it('中间件错误不阻断后续', async () => {
    const order: string[] = [];
    pipeline.useAll([
      { name: 'A', phase: 'p1', async run(ctx, next) { order.push('A'); await next(); } },
      { name: 'Faulty', phase: 'p2', async run(_ctx, next) { order.push('Faulty'); throw new Error('boom'); } },
      { name: 'B', phase: 'p3', async run(ctx, next) { order.push('B'); await next(); } },
    ]);

    const ctx = await pipeline.run('test', dir);
    expect(order).toEqual(['A', 'Faulty', 'B']);
    expect(ctx.errors.length).toBe(1);
    expect(ctx.errors[0]).toContain('boom');
  });

  it('应注册 Agent 到 Swarm', () => {
    pipeline.use({
      name: 'TestAgent', phase: 'test',
      agentDef: { id: 'ag-1', name: 'TA', role: 'tester', domain: 'test', capabilities: [], engine: 'minimax' },
      async run(_ctx, next) { await next(); },
    });

    const agent = pipeline.swarm.getAgent('ag-1');
    expect(agent).toBeDefined();
    expect(agent?.definition.name).toBe('TA');
  });

  it('状态应正确', async () => {
    pipeline.use({ name: 'A', phase: 'p1', async run(_ctx, next) { await next(); } });
    expect(pipeline.status).toBe('idle');
    await pipeline.run('test', dir);
    expect(pipeline.status).toBe('completed');
  });

  it('summary', async () => {
    pipeline.useAll([
      { name: 'Planner', phase: 'phase1', async run(_ctx, next) { await next(); } },
      { name: 'Generator', phase: 'phase2', async run(_ctx, next) { await next(); } },
    ]);
    await pipeline.run('test', dir);
    const s = pipeline.summary();
    expect(s).toContain('Pipeline');
    expect(s).toContain('Planner');
    expect(s).toContain('Generator');
  });
});
