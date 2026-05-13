import { ReflectionLog } from '../src/core/memory.js';
import { mkdirSync, rmSync } from 'fs';

const tmpDir = '/tmp/som-reflect-test-' + Date.now();
mkdirSync(tmpDir, { recursive: true });
const log = new ReflectionLog(tmpDir);

let passed = 0; let failed = 0;
function t(n: string, fn: () => void) { try { fn(); passed++; console.log('✅ ' + n); } catch(e:any) { failed++; console.log('❌ ' + n + ': ' + e.message); } }
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

log.record({ taskId: 1, projectName: 'test-proj', outcome: 'fail', lesson: 'Canvas直渲性能差，改离屏缓存。', rawReturn: '总分4.0/10', createdAt: '2026-05-14T00:00:00Z' });
log.record({ taskId: 2, projectName: 'test-proj', outcome: 'pass', lesson: 'TDD有效：先写测试再实现，3次迭代通过。', rawReturn: '总分8.5/10', createdAt: '2026-05-14T01:00:00Z' });
log.record({ taskId: 3, projectName: 'other-proj', outcome: 'fail', lesson: '验收标准模糊→评估偏差，需量化标准。', rawReturn: '总分5.0/10', createdAt: '2026-05-14T02:00:00Z' });

t('记录并检索', () => {
  assert(log.loadAll().length === 3, '应有3条记录');
});

t('同项目教训检索', () => {
  const ctx = log.getPastContext('test-proj', 2, 1);
  assert(ctx.includes('性能差'), '应含test-proj的fail教训');
  assert(ctx.includes('TDD有效'), '应含test-proj的pass教训');
});

t('跨项目教训检索', () => {
  const ctx = log.getPastContext('test-proj', 2, 1);
  assert(ctx.includes('other-proj'), '应含跨项目教训');
});

t('新项目获跨项目教训(TradingAgents: 跨ticker教训仍有价值)', () => {
  const ctx = log.getPastContext('brand-new-proj', 2, 2);
  assert(ctx.includes('other-proj'), '新项目应获得跨项目教训');
  assert(ctx.includes('跨项目教训'), '应有跨项目标签');
});

t('空日志→空上下文', () => {
  const tmpDir2 = '/tmp/som-reflect-empty-' + Date.now();
  mkdirSync(tmpDir2, { recursive: true });
  const emptyLog = new ReflectionLog(tmpDir2);
  assert(emptyLog.getPastContext('any') === '', '空日志应返回空');
  rmSync(tmpDir2, { recursive: true, force: true });
});

rmSync(tmpDir, { recursive: true, force: true });
console.log('\n' + '='.repeat(40));
console.log('P1-8 Reflection: ' + passed + ' PASS / ' + failed + ' FAIL');
if (failed > 0) process.exit(1);
