import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SwarmCoordinator } from '../swarm/swarm-coordinator.js';
import { EventBus } from '../event-bus.js';
import { AgentMemory } from '../memory/agent-memory.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function tmpDir() {
  const d = join(tmpdir(), `sw-${Date.now()}-${Math.random().toString(36).slice(2,6)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

describe('SwarmCoordinator', () => {
  let swarm: SwarmCoordinator;
  let bus: EventBus;
  let mem: AgentMemory;
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    bus = new EventBus(dir);
    mem = new AgentMemory(dir);
    swarm = new SwarmCoordinator({ projectId: 'test', maxAgents: 5 }, bus, mem);
  });

  afterEach(() => {
    swarm.shutdown();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('注册 Agent', () => {
    const s = swarm.registerAgent({
      id: 'agent-1', name: 'Builder', role: 'generator',
      domain: 'coding', capabilities: ['typescript'], engine: 'minimax',
    });
    expect(s.status).toBe('idle');
    expect(swarm.getAgent('agent-1')?.definition.name).toBe('Builder');
  });

  it('提交并分配任务', () => {
    swarm.registerAgent({
      id: 'dev', name: 'Dev', role: 'generator',
      domain: 'coding', capabilities: ['ts'], engine: 'minimax',
    });

    const task = swarm.submitTask({
      title: '实现计数器', description: '实现+1功能',
      domain: 'coding', priority: 1, dependencies: [], maxRetries: 3,
    });

    expect(task.status).toBe('assigned');
    expect(task.assignedTo).toBe('dev');
  });

  it('完成任务', () => {
    swarm.registerAgent({
      id: 'dev', name: 'Dev', role: 'generator',
      domain: 'coding', capabilities: ['ts'], engine: 'minimax',
    });

    const task = swarm.submitTask({
      title: 'T1', description: 'test',
      domain: 'coding', priority: 1, dependencies: [], maxRetries: 2,
    });

    swarm.completeTask(task.id, { success: true, output: 'done' });
    expect(swarm.getTask(task.id)?.status).toBe('completed');
    expect(swarm.getAgent('dev')?.status).toBe('idle');
  });

  it('失败重试', () => {
    swarm.registerAgent({
      id: 'dev', name: 'Dev', role: 'generator',
      domain: 'coding', capabilities: ['ts'], engine: 'minimax',
    });

    const task = swarm.submitTask({
      title: 'T1', description: 'test',
      domain: 'coding', priority: 1, dependencies: [], maxRetries: 2,
    });

    swarm.completeTask(task.id, { success: false, output: '', error: 'bug' });
    const t = swarm.getTask(task.id)!;
    expect(t.retries).toBe(1);
    expect(t.status).toBe('assigned'); // reassigned
  });

  it('heartbeat 恢复离线 Agent', () => {
    const s = swarm.registerAgent({
      id: 'a1', name: 'A1', role: 'planner',
      domain: 'planning', capabilities: ['plan'], engine: 'minimax',
    });
    s.status = 'offline';
    swarm.heartbeat('a1');
    expect(swarm.getAgent('a1')?.status).toBe('idle');
  });

  it('getSummary', () => {
    swarm.registerAgent({
      id: 'a1', name: 'A1', role: 'planner',
      domain: 'planning', capabilities: ['plan'], engine: 'minimax',
    });
    const s = swarm.getSummary();
    expect(s).toContain('Swarm');
    expect(s).toContain('0/0');
  });
});
