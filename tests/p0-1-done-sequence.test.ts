/**
 * P0-1: DoneSequence 测试
 */
import { DoneSequenceMatcher, isFalseSuccess, type DoneSequence } from '../src/core/done-sequence.js';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('✅ ' + name); }
  catch (e: any) { failed++; const msg = '❌ ' + name + ': ' + e.message; console.log(msg); failures.push(msg); }
}

function assert(condition: boolean, msg: string) { if (!condition) throw new Error(msg); }

// 假成功
test('看起来完成了检测为假成功', () => { const r = isFalseSuccess('看起来完成了所有功能'); assert(r.found, '应检测到'); });
test('probably done检测为假成功', () => { const r = isFalseSuccess('The task is probably done'); assert(r.found, '应检测到'); });
test('正常输出不触发假成功', () => { const r = isFalseSuccess('All tests passed. APPROVED.'); assert(!r.found, '不应触发'); });

// DoneSequence
const codingDone: DoneSequence = {
  name: 'test-coding',
  events: [
    { eventType: 'llm_response' },
    { eventType: 'executor_pass' },
    { eventType: 'content_match', contentPattern: 'APPROVED|通过' },
  ],
};

test('完整序列匹配', () => {
  const m = new DoneSequenceMatcher();
  m.record({ eventType: 'llm_response', content: '生成了代码', sender: 'generator', timestamp: 1 });
  m.record({ eventType: 'executor_pass', content: '测试通过', sender: 'code-executor', timestamp: 2 });
  m.record({ eventType: 'llm_response', content: 'APPROVED', sender: 'evaluator', timestamp: 3 });
  assert(m.match(codingDone), '应匹配');
});

test('缺失executor不匹配', () => {
  const m = new DoneSequenceMatcher();
  m.record({ eventType: 'llm_response', content: '生成了代码', sender: 'generator', timestamp: 1 });
  m.record({ eventType: 'llm_response', content: 'APPROVED', sender: 'evaluator', timestamp: 2 });
  assert(!m.match(codingDone), '不应匹配');
});

test('executor_fail不匹配', () => {
  const m = new DoneSequenceMatcher();
  m.record({ eventType: 'llm_response', content: '生成了代码', sender: 'generator', timestamp: 1 });
  m.record({ eventType: 'executor_fail', content: '测试失败', sender: 'code-executor', timestamp: 2 });
  m.record({ eventType: 'llm_response', content: 'APPROVED', sender: 'evaluator', timestamp: 3 });
  assert(!m.match(codingDone), 'executor_fail不是executor_pass');
});

// 正则匹配
const regexSeq: DoneSequence = {
  name: 'score',
  events: [
    { eventType: 'content_match', contentPattern: '总分[:：]\\s*[89]\\.\\d+' },
    { eventType: 'content_match', contentPattern: 'APPROVED|通过' },
  ],
};
test('评分8.5匹配', () => {
  const m = new DoneSequenceMatcher();
  m.record({ eventType: 'content_match', content: '总分：8.5', sender: 'evaluator', timestamp: 1 });
  m.record({ eventType: 'content_match', content: 'APPROVED', sender: 'evaluator', timestamp: 2 });
  assert(m.match(regexSeq), '8.5应匹配');
});
test('评分6.5不匹配', () => {
  const m = new DoneSequenceMatcher();
  m.record({ eventType: 'content_match', content: '总分：6.5', sender: 'evaluator', timestamp: 1 });
  assert(!m.match(regexSeq), '6.5不应匹配');
});

// matchAny
test('matchAny正确返回', () => {
  const m = new DoneSequenceMatcher();
  m.record({ eventType: 'content_match', content: 'deploy success', sender: 'devops', timestamp: 1 });
  const deploySeq: DoneSequence = { name: 'deploy', events: [{ eventType: 'content_match', contentPattern: 'deploy.*success' }] };
  const codingSeq: DoneSequence = { name: 'coding', events: [{ eventType: 'content_match', contentPattern: 'APPROVED' }] };
  const r = m.matchAny([deploySeq, codingSeq]);
  assert(r.matched && r.name === 'deploy', '应匹配deploy');
});

test('reset清空', () => {
  const m = new DoneSequenceMatcher();
  m.record({ eventType: 'llm_response', content: 'test', sender: 't', timestamp: 1 });
  m.reset();
  assert(m.size === 0, 'size应为0');
});

console.log('\n' + '='.repeat(40));
console.log('结果: ' + passed + ' PASS / ' + failed + ' FAIL');
if (failures.length > 0) { failures.forEach(f => console.log(f)); process.exit(1); }
