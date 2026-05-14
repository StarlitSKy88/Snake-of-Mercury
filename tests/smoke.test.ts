/**
 * 冒烟测试 — 验证所有核心模块可加载
 */
import { DoneSequenceMatcher, isFalseSuccess } from '../src/core/done-sequence.js';
import { validateEvidence, hasCodeExecutorSignature } from '../src/core/evidence-guard.js';
import { ProtocolBus } from '../src/core/protocol.js';
import { TaskDAG } from '../src/core/task-dag.js';
import { AgentMemory, ReflectionLog } from '../src/core/memory.js';
import { HookRegistry } from '../src/core/hooks.js';
import { RESOLVE_ENGINE, ROLE_THINKING_LEVEL } from '../src/config/agent-config.js';
import { loadAllSkills } from '../src/skills/loader.js';
import { mkdirSync, rmSync } from 'fs';

let ok = 0; let err = 0;
const tmp = '/tmp/som-smoke-' + Date.now();
mkdirSync(tmp, { recursive: true });

// ProtocolBus
try {
  const pb = new ProtocolBus(tmp);
  const req = pb.request('plan_approval', 'test', 'user', 'subject', 'payload');
  if (req.id && req.status === 'pending') { ok++; console.log('✅ ProtocolBus'); }
  else { err++; console.log('❌ ProtocolBus'); }
} catch(e) { err++; console.log('❌ ProtocolBus: ' + String(e).slice(0,60)); }

// TaskDAG
try {
  const dag = new TaskDAG(tmp);
  dag.create('测试任务', { acceptanceCriteria: ['test'], impactLevel: 1 });
  const summary = dag.summary();
  if (summary.includes('0/1')) { ok++; console.log('✅ TaskDAG'); }
  else { err++; console.log('❌ TaskDAG: ' + summary); }
} catch(e) { err++; console.log('❌ TaskDAG: ' + String(e).slice(0,60)); }

// AgentMemory
try {
  const mem = new AgentMemory(tmp + '/mem');
  mem.put({ namespace: 'test', type: 'pattern', content: 'hello' });
  if (mem.stats().totalEntries === 1) { ok++; console.log('✅ AgentMemory'); }
  else { err++; console.log('❌ AgentMemory'); }
  mem.close();
} catch(e) { err++; console.log('❌ AgentMemory: ' + String(e).slice(0,60)); }

// ReflectionLog
try {
  const rl = new ReflectionLog(tmp);
  rl.record({ taskId: 1, projectName: 'test', outcome: 'pass', lesson: 'works', createdAt: new Date().toISOString() });
  if (rl.loadAll().length === 1) { ok++; console.log('✅ ReflectionLog'); }
  else { err++; console.log('❌ ReflectionLog'); }
} catch(e) { err++; console.log('❌ ReflectionLog: ' + String(e).slice(0,60)); }

// DoneSequence
try {
  const m = new DoneSequenceMatcher();
  m.record({ eventType: 'llm_response', content: 'test', sender: 't', timestamp: 1 });
  if (m.size === 1) { ok++; console.log('✅ DoneSequence'); }
  else { err++; console.log('❌ DoneSequence'); }
} catch(e) { err++; console.log('❌ DoneSequence: ' + String(e).slice(0,60)); }

// EvidenceGuard
try {
  const r = validateEvidence('文件列表: test.html (1500 bytes) | 模块深度: 深\n验证结果: test ✅ 通过');
  if (r.valid) { ok++; console.log('✅ EvidenceGuard'); }
  else { err++; console.log('❌ EvidenceGuard: ' + r.reason); }
} catch(e) { err++; console.log('❌ EvidenceGuard: ' + String(e).slice(0,60)); }

// Hooks
try {
  const hr = HookRegistry.createDefault();
  const r = await hr.execute('pre_tool_use', { event: 'pre_tool_use', agentName: 'test', iteration: 1, timestamp: Date.now(), toolName: 'test', toolInput: { safe: true } });
  if (r.allowed) { ok++; console.log('✅ Hooks'); }
  else { err++; console.log('❌ Hooks'); }
} catch(e) { err++; console.log('❌ Hooks: ' + String(e).slice(0,60)); }

// Skills loader
try {
  const skills = loadAllSkills();
  if (skills.length >= 2) { ok++; console.log('✅ Skills: ' + skills.length + ' loaded'); }
  else { err++; console.log('❌ Skills: only ' + skills.length); }
} catch(e) { err++; console.log('❌ Skills: ' + String(e).slice(0,60)); }

rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '='.repeat(30));
console.log('冒烟测试: ' + ok + ' OK / ' + err + ' FAIL');
if (err > 0) process.exit(1);
