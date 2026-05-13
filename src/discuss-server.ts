/**
 * Phase 0 对话服务器 — 多轮对话模式
 * 
 * 启动: npm run discuss
 * 打开: http://localhost:3100
 * 
 * Agent 通过多轮对话与用户交互:
 *   提问 → 回答 → 挑战 → 整理 → 展示文档 → 用户确认 → 保存
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { agentCall } from './core/agent-loop.js';
import { THREE_RED_LINES } from './constraints/pua.js';
import type { AgentEngine } from './utils/agent-executor.js';

const PORT = 3100;

// ═══════════ 对话型 Agent ═══════════

const CONVERSATION_PROMPT = `你是资深产品战略顾问。你在和一个创业者对话，帮他把模糊想法梳理成可执行的需求。

## 你的对话风格
- 友好但直接。敢质疑、敢挑战。不拍马屁。
- 每次只问一个问题。不要一次抛出一堆问题。
- 根据用户的回答深入追问。像剥洋葱一样。

## 对话流程 (自然过渡，不强制)
1. 先理解用户的想法（目标用户？解决什么问题？）
2. 做市场调研（搜索 GitHub 同类项目，告诉用户竞品情况）
3. 挑战假设（"你确定用户需要这个？有没有更简单的方案？"）
4. 建议差异化方向（"市面上的 X 已经做了 Y，你的不同点在哪？"）
5. 当你觉得信息够了 → 输出 **草案文档** 给用户审查

## 输出文档的时机
当你收集到足够信息后，在回复末尾输出:
\`\`\`REQUIREMENT
# 需求文档: [项目名]
## 目标
[一句话]
## 用户画像
[谁在用，什么场景]
## 核心功能 (MVP)
- [功能1]
- [功能2]
## 差异化
[与竞品不同之处]
## 技术方案建议
[建议的技术栈]
## 待确认
- [需要用户确认的问题]
\`\`\`
然后问用户: "这是需求草案，确认后我会保存为 REQUIREMENT.md。有什么要调整的吗？"

## 当用户确认后
在回复末尾输出 READY_TO_SAVE，系统会自动保存文档。

## 原则
- 不要一次性输出，边聊边深入
- 每次回复控制在 300 字以内（除了文档输出时）
- 如果用户说"继续"/"确认"/"没问题" → 进入下一步
- 如果用户说"不对"/"修改" → 调整文档

${THREE_RED_LINES}`;

// ═══════════ 会话管理 ═══════════

interface Turn {
  role: 'user' | 'agent';
  content: string;
}

const sessions = new Map<string, Turn[]>();

function getConversationHistory(sessionId: string): Turn[] {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, []);
  }
  return sessions.get(sessionId)!;
}

// ═══════════ HTTP 服务器 ═══════════

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

function json(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const url = req.url || '/';

  // 主页
  if (url === '/' || url === '/index.html') {
    const htmlPath = join(import.meta.dirname, '..', 'discuss.html');
    if (existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(htmlPath, 'utf-8'));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>discuss.html 未找到</h1>');
    }
    return;
  }

  // 对话 API (多轮)
  if (url === '/api/discuss' && req.method === 'POST') {
    const body = await parseBody(req);
    const message = body.message || '';
    const sessionId = body.sessionId || 'default';
    const engine = (process.env.HARNESS_ENGINE || 'minimax') as AgentEngine;

    const history = getConversationHistory(sessionId);
    history.push({ role: 'user', content: message });

    // 裁剪历史（保留最近 10 轮）
    const recentHistory = history.slice(-10);

    // 构建 prompt
    const historyText = recentHistory
      .map(t => (t.role === 'user' ? '👤 用户: ' : '🤖 Agent: ') + t.content)
      .join('\n\n');

    const prompt = `## 对话历史
${historyText}

请根据对话历史回复用户。如果信息足够，输出需求文档草案。
如果用户已确认，末尾输出 READY_TO_SAVE。`;

    try {
      const reply = await agentCall(CONVERSATION_PROMPT, prompt, engine);
      history.push({ role: 'agent', content: reply });

      // 检测 READY_TO_SAVE
      const readyToSave = reply.includes('READY_TO_SAVE');

      // 提取并保存 REQUIREMENT.md
      let savedPath = '';
      if (readyToSave) {
        const docMatch = reply.match(/```REQUIREMENT\n([\s\S]*?)```/);
        if (docMatch) {
          const docContent = docMatch[1];
          const tasksDir = join(process.cwd(), '.tasks');
          mkdirSync(tasksDir, { recursive: true });
          const fullDoc = `# 需求文档\n\n> 生成时间: ${new Date().toISOString()}\n> 对话轮数: ${history.length}\n\n${docContent}`;
          writeFileSync(join(tasksDir, 'REQUIREMENT.md'), fullDoc, 'utf-8');
          savedPath = join(tasksDir, 'REQUIREMENT.md');
        }
      }

      json(res, {
        success: true,
        reply,
        readyToSave,
        savedPath,
      });

    } catch (err: any) {
      json(res, { success: false, error: err?.message || String(err) }, 500);
    }
    return;
  }

  // 重置会话
  if (url === '/api/reset' && req.method === 'POST') {
    const body = await parseBody(req);
    const sessionId = body.sessionId || 'default';
    sessions.delete(sessionId);
    json(res, { success: true });
    return;
  }

  // 健康检查
  if (url === '/api/health') {
    json(res, { status: 'ok' });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

export function startDiscussServer() {
  server.listen(PORT, () => {
    console.log(`\n🧠 Phase 0 对话窗口: http://localhost:${PORT}`);
    console.log('Agent 会通过多轮对话帮你梳理需求');
    console.log('当你确认后, Agent 自动保存 REQUIREMENT.md');
    console.log('按 Ctrl+C 退出\n');
  });
}

if (process.argv[1]?.includes('discuss-server')) {
  startDiscussServer();
}
