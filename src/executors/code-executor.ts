/**
 * Code Executor — 提取代码 → 写盘 → 执行 → 收集证据
 * 
 * HTML 三层验证: 结构(L1) → JS语法(L2) → 调用链(L3)
 * 上下文感知: 仅游戏/Canvas类应用检查 Canvas 和渲染循环
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

// ============ 类型 ============

export interface CodeFile {
  language: string;
  filepath: string;
  content: string;
}

export interface ExecutionEvidence {
  filesExtracted: CodeFile[];
  install?: { success: boolean; output: string };
  typeCheck?: { success: boolean; output: string };
  test?: { success: boolean; output: string };
  build?: { command: string; success: boolean; output: string };
  summary: string;
  criteriaCheck?: Array<{ criterion: string; passed: boolean; detail: string }>;
  moduleDepthScore?: { functions: number; totalLines: number; rating: '深' | '中' | '浅' };
  e2e?: { success: boolean; output: string };
}

// ============ 提取 ============

export function extractCodeFiles(output: string): CodeFile[] {
  const files: CodeFile[] = [];
  const regex = /```(\w+):([^\n]+)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(output)) !== null) {
    files.push({ language: match[1], filepath: match[2].trim(), content: match[3].trim() });
  }
  return files;
}

export function writeCodeFiles(files: CodeFile[], projectDir: string): string[] {
  const written: string[] = [];
  for (const file of files) {
    const fullPath = join(projectDir, file.filepath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf-8');
    written.push(fullPath);
  }
  return written;
}

// ============ 执行 ============

export async function executeCode(output: string, projectDir: string): Promise<ExecutionEvidence> {
  const files = extractCodeFiles(output);
  const evidence: ExecutionEvidence = { filesExtracted: files, summary: '' };

  if (files.length === 0) {
    evidence.summary = '[CodeExecutor] ⚠️ 未检测到代码文件';
    return evidence;
  }

  writeCodeFiles(files, projectDir);
  console.log(`  ⚡ [CodeExecutor] ${files.length} 文件写入`);

  // v4: 计算模块深度
  evidence.moduleDepthScore = calcModuleDepth(files);

  const projectType = detectType(files);

  switch (projectType) {
    case 'node': {
      const { execCommand } = await import('../utils/agent-executor.js');
      if (existsSync(join(projectDir, 'package.json'))) {
        evidence.install = await runCmd(execCommand, 'npm', ['install', '--silent'], projectDir, 120000);
        evidence.test = await runCmd(execCommand, 'npm', ['test', '--', '--passWithNoTests'], projectDir, 120000);
      }
      if (existsSync(join(projectDir, 'tsconfig.json'))) {
        evidence.typeCheck = await runCmd(execCommand, 'npx', ['tsc', '--noEmit'], projectDir, 60000);
      }
      break;
    }
    case 'html': {
      validateHtml(files, projectDir, evidence);
      // P2-4: 轻量 E2E 验证
      evidence.e2e = await runE2E(files, projectDir);
      break;
    }
    default: {
      evidence.summary = '[CodeExecutor] 未识别项目类型';
    }
  }

  return evidence;
}

/** HTML 三层验证: 上下文感知 */
function validateHtml(files: CodeFile[], projectDir: string, evidence: ExecutionEvidence): void {
  const hardFailures: string[] = [];
  const softWarnings: string[] = [];
  const fileList: string[] = [];

  // 判断项目类型: 是否需要 Canvas/渲染循环?
  const allContent = files.map(f => f.content).join(' ');
  const isCanvasApp = /canvas|游戏|game|时钟|clock|绘图|draw.*canvas|动画|animate|贪吃蛇|snake/i.test(allContent);

  for (const file of files.filter(f => f.filepath.endsWith('.html'))) {
    const fullPath = join(projectDir, file.filepath);
    const html = readFileSync(fullPath, 'utf-8');
    fileList.push(file.filepath + ' (' + html.length + ' bytes)');

    // L1: 硬失败 — 结构
    if (!/<!DOCTYPE/i.test(html)) hardFailures.push('L1: 缺少 DOCTYPE');
    if (html.length < 300) hardFailures.push('L1: 文件过小(' + html.length + ' bytes)');

    // Canvas 检查: 仅对 Canvas/游戏类应用
    if (isCanvasApp && !/<canvas/i.test(html)) {
      hardFailures.push('L1: Canvas应用缺少 <canvas> 元素');
    }

    // L2: 硬失败 — JS 语法
    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (scriptMatch) {
      try { new Function(scriptMatch[1]); }
      catch (e: any) { hardFailures.push('L2: JS语法错误 — ' + e.message.slice(0, 80)); }

      const js = scriptMatch[1];

      // L3: 软警告 — 仅对 Canvas/游戏应用检查渲染循环和事件
      if (isCanvasApp) {
        if (!/requestAnimationFrame|setInterval.*(?:draw|update|render|loop)|setTimeout.*(?:gameLoop|loop)/i.test(js)) {
          hardFailures.push('L3: Canvas应用缺少渲染循环 (requestAnimationFrame/setInterval)');
        }
        if (!/addEventListener\s*\(\s*['"]\w+['"]/i.test(js)) {
          softWarnings.push('L3: 游戏应用建议添加事件处理');
        }
      }
    } else if (isCanvasApp) {
      hardFailures.push('L1: Canvas应用缺少 <script> 标签');
    }
  }

  evidence.build = {
    command: 'HTML 三层验证',
    success: hardFailures.length === 0,
    output: [
      '## 文件列表',
      ...fileList.map(f => '  - ' + f),
      hardFailures.length > 0 ? '## 硬失败 (' + hardFailures.length + ')' : '## 硬失败: 0',
      ...hardFailures.map(f => '  ❌ ' + f),
      softWarnings.length > 0 ? '## 软警告 (' + softWarnings.length + ')' : '',
      ...softWarnings.map(w => '  ⚠️ ' + w),
      hardFailures.length === 0 && softWarnings.length === 0 ? '✅ 验证通过' : '',
    ].filter(Boolean).join('\n'),
  };
  evidence.summary = '[HTML] ' + hardFailures.length + ' 个硬失败, ' + softWarnings.length + ' 个警告';
}

export function formatEvidenceForEvaluator(evidence: ExecutionEvidence): string {
  let text = '\n\n---\n## ⚡ 实际执行证据\n\n';
  text += '### 生成文件\n';
  for (const f of evidence.filesExtracted) {
    text += '- ' + f.filepath + ' (' + f.language + ')\n';
  }

  // 验收标准逐条状态 (v4)
  if (evidence.criteriaCheck && evidence.criteriaCheck.length > 0) {
    text += '\n### 验收标准逐条检查\n';
    for (const c of evidence.criteriaCheck) {
      text += (c.passed ? '✅ ' : '❌ ') + c.criterion + ' — ' + c.detail + '\n';
    }
  }

  // 模块深度评分 (v4)
  if (evidence.moduleDepthScore) {
    const m = evidence.moduleDepthScore;
    text += '\n### 模块深度\n';
    text += m.functions + ' 函数 / ' + m.totalLines + ' 行 → ' + m.rating + '\n';
  }

  text += '\n### 验证结果\n';
  if (evidence.test) {
    text += '测试: ' + (evidence.test.success ? '✅ 通过' : '❌ 失败') + '\n';
    text += '```\n' + evidence.test.output.slice(0, 500) + '\n```\n';
  }
  if (evidence.typeCheck) {
    text += '类型检查: ' + (evidence.typeCheck.success ? '✅ 通过' : '❌ 失败') + '\n';
  }
  if (evidence.build) {
    text += evidence.build.command + ': ' + (evidence.build.success ? '✅ 通过' : '❌ 失败') + '\n';
    text += '```\n' + evidence.build.output + '\n```\n';
  }
  text += '\n### 汇总\n' + evidence.summary + '\n';
  return text;
}

// ============ 辅助 ============


/** P2-4: 轻量 E2E — 启动临时 HTTP 服务器，用 fetch 验证 HTML 页面可访问 */
async function runE2E(files: CodeFile[], projectDir: string): Promise<{ success: boolean; output: string }> {
  const htmlFiles = files.filter(f => f.filepath.endsWith('.html'));
  if (htmlFiles.length === 0) return { success: true, output: '非HTML项目，跳过E2E' };

  const { createServer } = await import('http');
  const results: string[] = [];
  let serverErrors = 0;

  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      try {
        const urlPath = req.url === '/' ? '/index.html' : (req.url || '/index.html');
        const relativePath = urlPath.replace(/^\//, '');
        const { readFileSync, existsSync } = require('fs');
        const { join } = require('path');

        for (const f of htmlFiles) {
          const matchPath = join(projectDir, relativePath);
          const filePath = join(projectDir, f.filepath);
          if (matchPath === filePath || relativePath === f.filepath) {
            const content = readFileSync(filePath, 'utf-8');
            const ext = f.filepath.endsWith('.html') ? 'text/html' :
                        f.filepath.endsWith('.js') ? 'application/javascript' :
                        f.filepath.endsWith('.css') ? 'text/css' : 'text/plain';
            res.writeHead(200, { 'Content-Type': ext + '; charset=utf-8' });
            res.end(content);
            return;
          }
        }
        // 其他文件
        const fullPath = join(projectDir, relativePath);
        if (existsSync(fullPath)) {
          const content = readFileSync(fullPath, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(content);
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      } catch (e: any) {
        serverErrors++;
        res.writeHead(500);
        res.end('Server error');
      }
    });

    server.listen(0, '127.0.0.1', async () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      
      try {
        for (const f of htmlFiles) {
          const url = 'http://127.0.0.1:' + port + '/' + f.filepath;
          try {
            const resp = await fetch(url);
            const text = await resp.text();
            const checks: string[] = [];
            
            if (resp.status === 200) checks.push('✅ HTTP 200');
            else { checks.push('❌ HTTP ' + resp.status); serverErrors++; }
            
            if (text.length > 100) checks.push('✅ 内容 >100B');
            else { checks.push('❌ 内容过小(' + text.length + 'B)'); serverErrors++; }
            
            const ct = resp.headers.get('content-type') || '';
            if (ct.includes('text/html')) checks.push('✅ Content-Type');
            else checks.push('⚠️ Content-Type: ' + ct);
            
            // 检测 JS 语法错误 (快速正则扫描)
            const scriptMatches = text.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
            if (scriptMatches) {
              for (const sm of scriptMatches) {
                const jsContent = sm.replace(/<\/?script[^>]*>/gi, '');
                try { new Function(jsContent); checks.push('✅ JS 语法OK'); }
                catch (e: any) { checks.push('❌ JS错误: ' + e.message.slice(0, 60)); serverErrors++; }
              }
            }
            
            results.push(f.filepath + ':\n  ' + checks.join('\n  '));
          } catch (e: any) {
            results.push(f.filepath + ': ❌ fetch失败 — ' + (e.message || String(e)).slice(0, 80));
            serverErrors++;
          }
        }
      } finally {
        server.close();
      }

      resolve({
        success: serverErrors === 0,
        output: results.join('\n') + '\n' + (serverErrors === 0 ? '✅ E2E全部通过' : '❌ ' + serverErrors + '个错误'),
      });
    });

    server.on('error', () => {
      resolve({ success: false, output: 'E2E服务器启动失败' });
    });

    // 10秒超时
    setTimeout(() => {
      server.close();
      resolve({ success: false, output: 'E2E超时(10s)' });
    }, 10000);
  });
}

function detectType(files: CodeFile[]): 'node' | 'html' | 'unknown' {
  const paths = files.map(f => f.filepath.toLowerCase());
  if (paths.some(p => p.endsWith('.html'))) return 'html';
  if (paths.some(p => p.includes('package.json') || p.endsWith('.ts') || p.endsWith('.js'))) return 'node';
  return 'unknown';
}

async function runCmd(
  execCommand: Function, cmd: string, args: string[], cwd: string, timeout: number
): Promise<{ success: boolean; output: string }> {
  try {
    const result = await execCommand(cmd, args, { cwd, timeout });
    return { success: result.success, output: result.stdout + (result.stderr ? '\n' + result.stderr : '') };
  } catch (err) {
    return { success: false, output: String(err) };
  }
}

/** Caveman 精简格式: Agent 间通信用，省 75% token */
export function formatCompactEvidence(evidence: ExecutionEvidence): string {
  const parts: string[] = [];
  parts.push('[files]:' + evidence.filesExtracted.length);
  if (evidence.build) parts.push('[build]:' + (evidence.build.success ? 'OK' : 'FAIL'));
  if (evidence.test) parts.push('[test]:' + (evidence.test.success ? 'OK' : 'FAIL'));
  if (evidence.typeCheck) parts.push('[tsc]:' + (evidence.typeCheck.success ? 'OK' : 'FAIL'));
  if (evidence.e2e) parts.push('[e2e]:' + (evidence.e2e.success ? 'OK' : 'FAIL'));
  if (evidence.criteriaCheck) {
    const passed = evidence.criteriaCheck.filter(c => c.passed).length;
    parts.push('[criteria]:' + passed + '/' + evidence.criteriaCheck.length);
  }
  if (evidence.moduleDepthScore) {
    parts.push('[depth]:' + evidence.moduleDepthScore.rating);
  }
  parts.push('[sum]:' + evidence.summary);
  return parts.join(' ');
}

/** v4: 计算模块深度评分 */
function calcModuleDepth(files: CodeFile[]): { functions: number; totalLines: number; rating: '深' | '中' | '浅' } {
  let totalFunctions = 0;
  let totalLines = 0;
  for (const f of files) {
    const lines = f.content.split('\n').length;
    totalLines += lines;
    const fnMatches = f.content.match(/function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(|class\s+\w+/g);
    totalFunctions += fnMatches ? fnMatches.length : 0;
  }
  const ratio = totalLines > 0 ? totalFunctions / totalLines : 0;
  // > 0.05 = 深 (很多小函数), 0.02-0.05 = 中, < 0.02 = 浅
  let rating: '深' | '中' | '浅';
  if (ratio > 0.05) rating = '深';
  else if (ratio > 0.02) rating = '中';
  else rating = '浅';
  return { functions: totalFunctions, totalLines, rating };
}
