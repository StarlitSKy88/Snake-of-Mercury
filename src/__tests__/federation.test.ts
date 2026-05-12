import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Federation } from '../federation/federation.js';
import { EventBus } from '../event-bus.js';
import { AgentMemory } from '../memory/agent-memory.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function tmpDir() {
  const d = join(tmpdir(), `fed-${Date.now()}-${Math.random().toString(36).slice(2,6)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

describe('Federation', () => {
  let fed: Federation;
  let bus: EventBus;
  let mem: AgentMemory;
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    bus = new EventBus(dir);
    mem = new AgentMemory(dir);
    fed = new Federation({ nodeId: 'node-a', nodeName: 'Alpha' }, bus, mem);
  });

  afterEach(() => {
    fed.shutdown();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('注册节点', () => {
    fed.registerNode({ id: 'node-b', name: 'Beta', endpoint: '/tmp/beta', sharedNamespaces: ['global'] });
    expect(fed.getNode('node-b')?.name).toBe('Beta');
    expect(fed.getNode('node-b')?.status).toBe('pending');
  });

  it('连接本地节点', async () => {
    const bDir = tmpDir();
    fed.registerNode({ id: 'node-b', name: 'Beta', endpoint: bDir, sharedNamespaces: ['global'] });
    const ok = await fed.connect('node-b');
    expect(ok).toBe(true);
    expect(fed.getNode('node-b')?.status).toBe('connected');
    rmSync(bDir, { recursive: true, force: true });
  });

  it('断开节点', () => {
    fed.registerNode({ id: 'node-x', name: 'X', endpoint: '/tmp/x', sharedNamespaces: [] });
    fed.disconnect('node-x');
    expect(fed.getNode('node-x')?.status).toBe('disconnected');
  });

  it('委托任务', async () => {
    const bDir = tmpDir();
    fed.registerNode({ id: 'node-b', name: 'Beta', endpoint: bDir, sharedNamespaces: ['global'] });
    await fed.connect('node-b');
    
    const ok = await fed.delegateTask('node-b', {
      title: 'Test Task', description: 'do something', domain: 'coding',
    });
    expect(ok).toBe(true);
    rmSync(bDir, { recursive: true, force: true });
  });

  it('摘要', () => {
    fed.registerNode({ id: 'n1', name: 'N1', endpoint: '/tmp/n1', sharedNamespaces: [] });
    const s = fed.getSummary();
    expect(s).toContain('Federation');
    expect(s).toContain('Alpha');
    expect(s).toContain('1 总数');
  });

  it('getConnectedNodes', async () => {
    const bDir = tmpDir();
    fed.registerNode({ id: 'n1', name: 'N1', endpoint: bDir, sharedNamespaces: [] });
    await fed.connect('n1');
    expect(fed.getConnectedNodes()).toHaveLength(1);
    rmSync(bDir, { recursive: true, force: true });
  });
});
