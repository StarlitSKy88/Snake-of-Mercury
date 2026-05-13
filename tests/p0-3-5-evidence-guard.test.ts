import { validateEvidence, sanitizeEvidence, hasCodeExecutorSignature } from '../src/core/evidence-guard.js';

let passed = 0; let failed = 0;
function t(n: string, fn: () => void) { try { fn(); passed++; console.log('✅ ' + n); } catch(e:any) { failed++; console.log('❌ ' + n + ': ' + e.message); } }
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

t('合法证据通过', () => {
  const r = validateEvidence('文件列表: index.html\n验证结果: test ✅ 通过\n验收标准: PASS\n模块深度评分: 8.5');
  assert(r.valid, '应通过');
  assert(r.hasCodeExecutorSignature, '应有签名');
  assert(!r.hasRawCodeBlocks, '不应有代码块');
});

t('含原始代码块→拒绝', () => {
  const r = validateEvidence('```typescript\nconst x = 1;\n```\n```html\n<div></div>\n```\n```javascript\nconsole.log(1);\n```');
  assert(!r.valid, '应拒绝');
  assert(r.hasRawCodeBlocks, '应检测到代码块');
});

t('空证据→拒绝', () => {
  assert(!validateEvidence('').valid, '空证据');
});

t('短证据→拒绝', () => {
  assert(!validateEvidence('OK done').valid, '短证据');
});

t('无签名→false', () => {
  assert(!hasCodeExecutorSignature('只是一些普通的输出'), '无签名');
});

t('文件列表→true', () => {
  assert(hasCodeExecutorSignature('文件列表: index.html, app.ts'), '文件列表=签名');
});

t('测试通过→true', () => {
  assert(hasCodeExecutorSignature('test ✅ 通过'), '测试通过=签名');
});

t('净化保留验证输出', () => {
  const s = sanitizeEvidence('一些文本\n```typescript\nconst x = 1;\n```\n验证结果: test ✅');
  assert(s.includes('验证结果'), '应保留验证输出');
});

console.log('\n' + '='.repeat(40));
console.log('P0-3+P0-5: ' + passed + ' PASS / ' + failed + ' FAIL');
if (failed > 0) process.exit(1);
