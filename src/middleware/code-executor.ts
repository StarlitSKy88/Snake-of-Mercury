/**
 * Code Executor 中间件 — 填补 Generator→Evaluator 的证据缺口
 *
 * 问题：Generator 只能输出代码文本，无法产生 npm test / tsc / 运行截图等真实证据。
 *       Evaluator 的 PUA「闭环意识」持续拒绝无证据的声称 → 无效重试 → 熔断。
 *
 * 解决方案：在 Generator 和 Evaluator 之间插入 CodeExecutor：
 *   1. 从 Generator 输出中提取代码文件（```language:filepath 格式）
 *   2. 将文件写入项目目录
 *   3. 运行相关命令（npm install → npm test → npx tsc --noEmit 等）
 *   4. 收集执行证据（stdout, stderr, exit code）
 *   5. 将证据附加到 Generator 输出，一并传给 Evaluator
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { execCommand } from '../utils/agent-executor.js';
import type { Middleware, PipelineContext } from './pipeline.js';

// ============= 类型 =============

export interface CodeFile {
  language: string;
  filepath: string;
  content: string;
}

export interface ExecutionEvidence {
  /** 提取到的文件列表 */
  filesExtracted: CodeFile[];
  /** npm install 结果 */
  install?: { success: boolean; output: string };
  /** tsc 类型检查结果 */
  typeCheck?: { success: boolean; output: string };
  /** npm test 结果 */
  test?: { success: boolean; output: string };
  /** 通用构建命令结果 */
  build?: { command: string; success: boolean; output: string };
  /** 汇总 */
  summary: string;
}

// ============= 核心函数 =============

/**
 * 从 Generator 输出中提取代码文件
 * 支持格式：
 *   ```typescript:src/foo.ts
 *   ```python:main.py
 *   ```html:index.html
 *   ```javascript:src/index.js
 */
export function extractCodeFiles(output: string): CodeFile[] {
  const files: CodeFile[] = [];
  const regex = /```(\w+):([^\n]+)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(output)) !== null) {
    files.push({
      language: match[1],
      filepath: match[2].trim(),
      content: match[3].trim(),
    });
  }

  return files;
}

/**
 * 将提取的文件写入磁盘
 */
export function writeCodeFiles(files: CodeFile[], projectDir: string): string[] {
  const written: string[] = [];

  for (const file of files) {
    const fullPath = join(projectDir, file.filepath);
    const dir = dirname(fullPath);

    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(fullPath, file.content, 'utf-8');
      written.push(fullPath);
    } catch (err) {
      console.error(`[CodeExecutor] 写入失败: ${fullPath}`, err);
    }
  }

  return written;
}

/**
 * 检测项目类型，决定执行什么命令
 */
function detectProjectType(files: CodeFile[]): 'node' | 'python' | 'html' | 'unknown' {
  const paths = files.map(f => f.filepath.toLowerCase());

  if (paths.some(p => p.endsWith('.html') || p.endsWith('.htm'))) return 'html';
  if (paths.some(p => p.includes('package.json'))) return 'node';
  if (paths.some(p => p.endsWith('.py'))) return 'python';

  // 默认按 node 处理（因为有 package.json 可能不在本次生成中）
  return 'node';
}

/**
 * 执行命令并收集证据
 */
async function runAndCollect(
  cmd: string,
  args: string[],
  cwd: string,
  timeout: number = 60000
): Promise<{ success: boolean; output: string }> {
  try {
    const result = await execCommand(cmd, args, { cwd, timeout });
    return {
      success: result.success,
      output: result.stdout + (result.stderr ? '\n[stderr]\n' + result.stderr : ''),
    };
  } catch (err) {
    return {
      success: false,
      output: String(err),
    };
  }
}

/**
 * 执行代码并收集证据
 */
export async function executeCode(
  output: string,
  projectDir: string
): Promise<ExecutionEvidence> {
  const files = extractCodeFiles(output);
  const evidence: ExecutionEvidence = {
    filesExtracted: files,
    summary: '',
  };

  if (files.length === 0) {
    evidence.summary = '[CodeExecutor] ⚠️ 未检测到代码文件';
    return evidence;
  }

  // 写入文件
  const written = writeCodeFiles(files, projectDir);
  console.log(`[CodeExecutor] ✅ 写入 ${written.length}/${files.length} 个文件`);

  // 检测项目类型
  const projectType = detectProjectType(files);

  // 根据类型执行相应命令
  switch (projectType) {
    case 'node': {
      // npm install
      if (existsSync(join(projectDir, 'package.json'))) {
        console.log('[CodeExecutor] 📦 npm install...');
        evidence.install = await runAndCollect('npm', ['install', '--silent'], projectDir, 120000);
      }

      // tsc 类型检查
      if (existsSync(join(projectDir, 'tsconfig.json'))) {
        console.log('[CodeExecutor] 🔍 tsc --noEmit...');
        evidence.typeCheck = await runAndCollect('npx', ['tsc', '--noEmit'], projectDir, 60000);
      }

      // npm test
      if (existsSync(join(projectDir, 'package.json'))) {
        console.log('[CodeExecutor] 🧪 npm test...');
        evidence.test = await runAndCollect(
          'npm', ['test', '--', '--passWithNoTests'], projectDir, 120000
        );
      }
      break;
    }

    case 'python': {
      // pip install
      evidence.install = await runAndCollect('pip', ['install', '-r', 'requirements.txt'], projectDir, 60000);

      // pytest
      evidence.test = await runAndCollect('python', ['-m', 'pytest', '-v'], projectDir, 120000);
      break;
    }

    case 'html': {
      // HTML 项目：三层验证
      // Layer 1: 结构检查（快，约0.1s）
      // Layer 2: JS 语法检查（快，约0.3s）  
      // Layer 3: DOM/Event 完整性检查（快，约0.5s）
      const htmlFiles = written.filter(f => f.endsWith('.html'));
      if (htmlFiles.length > 0) {
        const issues: string[] = [];
        const layerResults: string[] = [];
        let hasCanvas = false, hasScript = false, hasGameLoop = false;

        for (const file of htmlFiles) {
          const fs = await import('fs');
          const rawContent = fs.readFileSync(file, 'utf-8');

          // Layer 1: 结构
          if (!/<!DOCTYPE html>/i.test(rawContent)) issues.push('L1: 缺少 DOCTYPE');
          if (/<canvas/i.test(rawContent)) hasCanvas = true;
          else issues.push('L1: 缺少 canvas 元素');
          if (/<script[^>]*>/i.test(rawContent)) hasScript = true;
          else issues.push('L1: 缺少 script 标签');
          if (rawContent.length < 2000) issues.push('L1: 文件过小(' + rawContent.length + ' bytes)');

          // 提取 JS 代码
          const scriptMatch = rawContent.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
          const js = scriptMatch ? scriptMatch[1] : '';
          
          // Layer 2: JS 语法验证
          if (js) {
            try {
              new Function(js);
              layerResults.push('L2: JS 语法 ✅');
            } catch (e: any) {
              issues.push('L2: JS 语法错误 — ' + e.message.slice(0, 100));
            }
          }

          // Layer 3: 关键函数 + 调用链完整性
          const fnCalls = js.match(/(\w+)\(/g)?.map(c => c.slice(0, -1)) || [];
          const fnDefs = js.match(/function\s+(\w+)/g)?.map(d => d.split(/\s+/)[1]) || [];
          fnDefs.push(...(js.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:function|\([^)]*\)\s*=>)/g) || []).map(d => d.split(/\s+/)[1]));

          // 检查游戏入口函数
          const entryFns = ['startGame', 'init', 'main', 'setup'];
          const hasEntry = entryFns.some(f => fnDefs.includes(f) || fnCalls.includes(f));
          if (!hasEntry) issues.push('L3: 未找到游戏入口函数(startGame/init/main/setup)');

          // 检查渲染循环
          const hasRenderLoop = /requestAnimationFrame|setInterval.*draw|setTimeout.*gameLoop/i.test(js);
          if (hasRenderLoop) hasGameLoop = true;
          else issues.push('L3: ⚠️ 未检测到渲染循环(requestAnimationFrame/setInterval draw)');

          // 检查事件处理
          const events = js.match(/addEventListener\s*\(\s*['"](\w+)['"]/g)?.map(e => e.match(/['"](\w+)['"]/)?.[1]) || [];
          const hasInput = events.includes('keydown') || events.includes('keyup') || events.includes('click') || events.includes('touchstart');
          if (!hasInput) issues.push('L3: ⚠️ 未检测到用户输入事件(keydown/click/touchstart)');

          // 检查 Canvas API
          const hasCanvasAPI = /getContext\s*\(\s*['"]2d['"]\s*\)/.test(js) || /getContext\s*\(\s*['"]webgl/i.test(js);
          if (hasCanvas && !hasCanvasAPI) issues.push('L3: 有canvas元素但未调用getContext("2d")');

          // 检查调用链：入口函数是否触发了渲染
          if (hasEntry && hasGameLoop) {
            const entryFnName = entryFns.find(f => fnDefs.includes(f)) || 'startGame';
            // 简单检查：入口函数体内是否包含渲染调用
            const entryRegex = new RegExp('function\\s+' + entryFnName + '\\s*\\([^)]*\\)\\s*\\{[^}]+\\}', 's');
            const entryBody = js.match(entryRegex)?.[0] || '';
            if (entryBody && !/requestAnimationFrame|setInterval|setTimeout/.test(entryBody) && !/draw\s*\(/.test(entryBody)) {
              issues.push('L3: 🔴 入口函数(' + entryFnName + ')未触发渲染循环——游戏可能无法启动！');
            }
          }

          layerResults.push('L3: 函数' + fnDefs.length + '个, 事件' + events.length + '个');
        }

        evidence.build = {
          command: 'HTML 三层验证 (结构→语法→调用链)',
          success: issues.length === 0,
          output: [
            'Canvas: ' + (hasCanvas ? '✅' : '❌'),
            'Script: ' + (hasScript ? '✅' : '❌'),
            '渲染循环: ' + (hasGameLoop ? '✅' : '❌'),
            ...layerResults,
            issues.length > 0 ? '\n' + issues.join('\n') : '✅ 全部验证通过',
          ].join(' | '),
        };
        evidence.summary += '[HTML] ' + htmlFiles.length + ' 文件 | ' + issues.length + ' 个问题\n';
      }
      break;
    }

    default: {
      evidence.summary += `[CodeExecutor] 未识别的项目类型，跳过执行。\n`;
    }
  }

  // 构建汇总
  const parts: string[] = [];
  if (evidence.install) {
    parts.push(`npm install: ${evidence.install.success ? '✅' : '❌'}`);
  }
  if (evidence.typeCheck) {
    parts.push(`tsc: ${evidence.typeCheck.success ? '✅ 0 errors' : `❌\n${evidence.typeCheck.output.slice(0, 500)}`}`);
  }
  if (evidence.test) {
    parts.push(`npm test: ${evidence.test.success ? '✅' : `❌\n${evidence.test.output.slice(0, 500)}`}`);
  }
  if (evidence.build) {
    parts.push(`${evidence.build.command}: ${evidence.build.success ? '✅' : '❌'}`);
  }

  evidence.summary = parts.join(' | ') || evidence.summary;

  return evidence;
}

/**
 * 将执行证据格式化为 Evaluator 可读的文本
 */
export function formatEvidenceForEvaluator(evidence: ExecutionEvidence): string {
  let text = '\n\n---\n## ⚡ 实际执行证据（CodeExecutor 自动收集）\n\n';

  text += `**文件**: 提取 ${evidence.filesExtracted.length} 个，已写入磁盘\n\n`;

  if (evidence.install) {
    text += `### npm install\n\`\`\`\n${evidence.install.output.slice(0, 1000)}\n\`\`\`\n\n`;
  }

  if (evidence.typeCheck) {
    text += `### tsc --noEmit\n\`\`\`\n${evidence.typeCheck.output.slice(0, 1000)}\n\`\`\`\n\n`;
  }

  if (evidence.test) {
    text += `### npm test\n\`\`\`\n${evidence.test.output.slice(0, 2000)}\n\`\`\`\n\n`;
  }

  if (evidence.build) {
    text += `### ${evidence.build.command}\n\`\`\`\n${evidence.build.output.slice(0, 1000)}\n\`\`\`\n\n`;
  }

  text += `### 执行汇总\n${evidence.summary}\n`;

  return text;
}

// ============= Pipeline 中间件 =============

/**
 * 创建 CodeExecutor 中间件
 * 在 Generator 输出后、Evaluator 评估前执行
 */
export function createCodeExecutorMiddleware(): Middleware {
  return {
    name: 'CodeExecutor',
    phase: 'phase2-exec',
    agentDef: {
      id: 'agent-code-executor',
      name: 'Code Executor',
      role: 'executor',
      domain: 'testing',
      capabilities: ['file-extract', 'write-to-disk', 'npm-test', 'tsc-check', 'evidence-collection'],
      engine: 'minimax', // 不调用 LLM，直接执行系统命令
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      // CodeExecutor 由 GenEval 循环内调用，这里只是一个占位标记
      // 实际执行在 createGeneratorEvaluatorMiddleware 的循环中
      await next();
    },
  };
}
