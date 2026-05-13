import { agentLoop, type AgentLoopConfig } from '../src/core/agent-loop.js';
import type { AgentEngine } from '../src/utils/agent-executor.js';

let passed = 0; let failed = 0;
function t(n: string, fn: () => void) { try { fn(); passed++; console.log('✅ ' + n); } catch(e:any) { failed++; console.log('❌ ' + n + ': ' + e.message); } }
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

interface ContentSnapshot { iteration: number; hash: string; }

class LoopDetector {
  private history: ContentSnapshot[] = [];
  private cycleLen: number;
  private threshold: number;

  constructor(cycleLen = 10, threshold = 0.7) {
    this.cycleLen = cycleLen;
    this.threshold = threshold;
  }

  record(iteration: number, output: string): void {
    const hash = this._simpleHash(output.slice(-2000));
    this.history.push({ iteration, hash });
    if (this.history.length > this.cycleLen * 2) this.history.shift();
  }

  detect(): boolean {
    if (this.history.length < this.cycleLen * 2) return false;
    const recent = this.history.slice(-this.cycleLen);
    const previous = this.history.slice(-this.cycleLen * 2, -this.cycleLen);
    const recentUnique = new Set(recent.map(s => s.hash));
    const previousUnique = new Set(previous.map(s => s.hash));
    let overlap = 0;
    for (const h of recentUnique) {
      if (previousUnique.has(h)) overlap++;
    }
    const dominance = recentUnique.size === 0 ? 0 : overlap / recentUnique.size;
    return dominance >= this.threshold;
  }

  private _simpleHash(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash |= 0;
    }
    return String(hash);
  }
}

t('正常变化不触发循环检测', () => {
  const d = new LoopDetector(5, 0.7);
  for (let i = 0; i < 12; i++) {
    d.record(i, `输出 ${i}: ${'x'.repeat(i * 10)} 不同内容`);
  }
  assert(!d.detect(), '变化输出不应触发');
});

t('完全重复触发循环检测', () => {
  const d = new LoopDetector(3, 0.7);
  const same = '完全相同的输出内容';
  for (let i = 0; i < 8; i++) {
    d.record(i, same);
  }
  assert(d.detect(), '完全重复应触发');
});

t('模拟真正的代码循环: 每轮微调但核心不变', () => {
  const d = new LoopDetector(4, 0.5); // 低阈值模拟
  // 模拟：每轮输出相似的代码，偶尔改变颜色但结构完全一样
  const templates = [
    'function draw() { ctx.fillStyle = "red"; ctx.fillRect(0,0,100,100); }',
    'function draw() { ctx.fillStyle = "blue"; ctx.fillRect(0,0,100,100); }',
    'function draw() { ctx.fillStyle = "red"; ctx.fillRect(0,0,100,100); }', // 重复
    'function draw() { ctx.fillStyle = "red"; ctx.fillRect(0,0,100,100); }', // 重复
    'function draw() { ctx.fillStyle = "blue"; ctx.fillRect(0,0,100,100); }',
    'function draw() { ctx.fillStyle = "red"; ctx.fillRect(0,0,100,100); }', // 重复
    'function draw() { ctx.fillStyle = "red"; ctx.fillRect(0,0,100,100); }', // 重复
    'function draw() { ctx.fillStyle = "blue"; ctx.fillRect(0,0,100,100); }',
    'function draw() { ctx.fillStyle = "red"; ctx.fillRect(0,0,100,100); }', // 重复
    'function draw() { ctx.fillStyle = "red"; ctx.fillRect(0,0,100,100); }', // 重复
  ];
  for (let i = 0; i < templates.length; i++) {
    d.record(i, templates[i]);
  }
  // 只有2个不同hash，0.5阈值应该触发
  assert(d.detect(), '2种hash循环应触发');
});

t('不足cycleLen*2不触发', () => {
  const d = new LoopDetector(5, 0.7);
  for (let i = 0; i < 8; i++) {
    d.record(i, 'same');
  }
  assert(!d.detect(), '不足10轮不应触发');
});

t('高threshold下多样化输出不触发', () => {
  const d = new LoopDetector(3, 0.9);
  for (let i = 0; i < 8; i++) {
    d.record(i, `第${i}次: 完全不同的输出ABCDEFGH${'Z'.repeat(i * 20)}`);
  }
  assert(!d.detect(), 'threshold=0.9时变化输出不应触发');
});

console.log('\n' + '='.repeat(40));
console.log('P0-2 循环检测: ' + passed + ' PASS / ' + failed + ' FAIL');
if (failed > 0) process.exit(1);
