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
