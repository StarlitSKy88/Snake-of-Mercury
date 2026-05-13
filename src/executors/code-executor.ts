/**
 * Code Executor — 提取代码 → 写盘 → 执行 → 收集证据
 * 
 * 这是 Generator→Evaluator 之间的验证桥。
 * Generator 输出代码文本 → CodeExecutor 真正运行 → Evaluator 看到真实证据
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
      }
      if (existsSync(join(projectDir, 'tsconfig.json'))) {
        evidence.typeCheck = await runCmd(execCommand, 'npx', ['tsc', '--noEmit'], projectDir, 60000);
      }
      evidence.test = await runCmd(execCommand, 'npm', ['test', '--', '--passWithNoTests'], projectDir, 120000);
      break;
    }
    case 'html': {
      // 三层验证：结构 → JS语法 → 调用链
      const issues: string[] = [];
      for (const file of files.filter(f => f.filepath.endsWith('.html'))) {
        const fullPath = join(projectDir, file.filepath);
        const html = readFileSync(fullPath, 'utf-8');

        // L1: 结构
        if (!/<!DOCTYPE/i.test(html)) issues.push('L1: 缺少 DOCTYPE');
        if (!/<canvas/i.test(html)) issues.push('L1: 缺少 canvas');

        // L2: JS 语法
        const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
        if (scriptMatch) {
          try { new Function(scriptMatch[1]); }
          catch (e: any) { issues.push('L2: JS语法错误 — ' + e.message.slice(0, 80)); }

          const js = scriptMatch[1];
          // L3: 调用链
          if (!/requestAnimationFrame|setInterval.*draw|setTimeout.*gameLoop/i.test(js)) {
            issues.push('L3: ⚠️ 未检测到渲染循环');
          }
          if (!/addEventListener\s*\(\s*['"]\w+['"]/i.test(js)) {
            issues.push('L3: ⚠️ 未检测到事件处理');
          }
          const fnDefs = js.match(/function\s+(\w+)/g)?.map(d => d.split(/\s+/)[1]) || [];
          const entryFns = fnDefs.filter(f => ['startGame', 'init', 'main', 'setup'].includes(f));
          if (entryFns.length > 0) {
            const entryRegex = new RegExp(`function\\s+${entryFns[0]}\\s*\\([^)]*\\)\\s*\\{[^}]+\\}`, 's');
            const entryBody = (js.match(entryRegex)?.[0]) || '';
            if (entryBody && !/requestAnimationFrame|setInterval|setTimeout|draw\s*\(/.test(entryBody)) {
              issues.push(`L3: 🔴 入口函数 ${entryFns[0]}() 未触发渲染循环`);
            }
          }
        } else {
          issues.push('L1: 缺少 script 标签');
        }

        if (html.length < 2000) issues.push('L1: 文件过小(' + html.length + ' bytes)');
      }

      evidence.build = {
        command: 'HTML 三层验证',
        success: issues.length === 0,
        output: issues.length > 0 ? issues.join('\n') : '✅ 验证通过',
      };
      evidence.summary = `[HTML] ${issues.length} 个问题`;
      break;
    }
    default: {
      evidence.summary = '[CodeExecutor] 未识别项目类型';
    }
  }

  return evidence;
}

export function formatEvidenceForEvaluator(evidence: ExecutionEvidence): string {
  let text = '\n\n---\n## ⚡ 实际执行证据\n\n';
  text += `文件: ${evidence.filesExtracted.length} 个\n`;
  if (evidence.test) text += `测试: ${evidence.test.success ? '✅' : '❌'}\n${evidence.test.output.slice(0, 500)}\n`;
  if (evidence.typeCheck) text += `类型检查: ${evidence.typeCheck.success ? '✅' : '❌'}\n`;
  if (evidence.build) text += `${evidence.build.command}: ${evidence.build.output}\n`;
  text += `\n汇总: ${evidence.summary}\n`;
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
