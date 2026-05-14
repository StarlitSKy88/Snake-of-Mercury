/**
 * Phase 0 对话服务器 — 多轮对话 + 历史记录
 * 
 * 启动: npm run discuss
 * 打开: http://localhost:3100
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { agentCall } from './core/agent-loop.js';
import { THREE_RED_LINES } from './constraints/pua.js';
import type { AgentEngine } from './utils/agent-executor.js';

const PORT = 3100;
const DISCUSS_DIR = join(process.cwd(), '.tasks', 'discussions');

// ═══════════ 持久化会话 ═══════════

interface Turn {
  role: 'user' | 'agent';
  content: string;
  time: string;
}

interface Session {
  id: string;
  title: string;       // 从第一句话提取
  turns: Turn[];
  createdAt: string;
  updatedAt: string;
  savedPath?: string;  // REQUIREMENT.md 路径
}

function loadSession(id: string): Session | null {
  const path = join(DISCUSS_DIR, id + '.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return null; }
}

function saveSession(session: Session): void {
  mkdirSync(DISCUSS_DIR, { recursive: true });
  session.updatedAt = new Date().toISOString();
  writeFileSync(join(DISCUSS_DIR, session.id + '.json'), JSON.stringify(session, null, 2));
}

function listSessions(): Session[] {
  mkdirSync(DISCUSS_DIR, { recursive: true });
  return readdirSync(DISCUSS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(readFileSync(join(DISCUSS_DIR, f), 'utf-8')); }
      catch { return null; }
    })
    .filter((s): s is Session => s !== null)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

// ═══════════ Agent Prompt ═══════════

const CONVERSATION_PROMPT = `你是资深产品战略顾问。你在和一个创业者对话，帮他把模糊想法梳理成可执行的需求。

## 你的对话风格
- 友好但直接。敢质疑、敢挑战。
- 每次只问一个问题。不要一次抛出一堆问题。
- 根据用户的回答深入追问。像剥洋葱一样。

## 深度拷问方法论 (gstask/superpowers 风格)

### 第一层: 问题定义
- "这个问题的本质是什么？用户真正想要的是什么？"
- "不解决这个问题，用户现在怎么过？"
- "这是维生素(锦上添花)还是止痛药(刚需)？"

### 第二层: 假设挑战
- 对用户的每个假设，你必须提一个反例
- "如果目标用户根本不care这个功能呢？"
- "有没有更简单的方案能达到同样效果？"
- "你为什么觉得用户愿意付费？有数据支撑吗？"

### 第三层: 风险挖掘
- "这个项目最可能失败的三个原因是什么？"
- "如果大厂明天做同样的事，你怎么办？"
- "技术、市场、团队、资金——哪个是你最大的瓶颈？"

### 第四层: MVP 极致压缩
- 不要满足于用户提出的功能列表
- 挑战每个功能: "去掉这个，产品还有价值吗？"
- 目标: 把 MVP 压到 1-2 个核心功能

### 强制要求
- 每轮对话至少提出 1 个**质疑** (不是同意)
- 不要做"很好！这个想法很棒！"式的附和
- 你的价值在于**帮用户避免错误**，不是帮用户确认偏见

## 对话流程 (自然过渡)
1. 理解用户想法（目标用户？解决什么问题？）
2. 做市场调研（搜索 GitHub 同类项目）
3. 挑战假设（"有没有更简单的方案？"）
4. 深度拷问（按上述四层方法论逐层深入）
5. 建议差异化方向
6. 当你觉得信息够了 → 输出 **草案文档** 给用户审查

## 输出文档的时机
当信息足够后，回复末尾输出:
\`\`\`REQUIREMENT
# 需求文档: [项目名]
## 目标
[一句话]
## 核心功能 (MVP)
- [功能]
## 差异化
[与竞品不同]
## 技术方案建议
[建议]
\`\`\`
然后问: "确认后保存为 REQUIREMENT.md。要调整吗？"

## 当用户确认
末尾输出 READY_TO_SAVE，系统自动保存。

## 原则
- 每次回复 ≤ 300 字（文档输出时除外）
- 用户说"继续"/"确认"/"没问题" → 推进
- 用户说"不对"/"修改" → 调整

${THREE_RED_LINES}`;

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
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end(); return;
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

  // 历史列表
  if (url === '/api/sessions' && req.method === 'GET') {
    const sessions = listSessions().map(s => ({
      id: s.id,
      title: s.title,
      turnCount: s.turns.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      saved: !!s.savedPath,
    }));
    json(res, sessions);
    return;
  }

  // 加载特定会话
  if (url === '/api/sessions/load' && req.method === 'POST') {
    const body = await parseBody(req);
    const session = loadSession(body.sessionId);
    if (session) {
      json(res, { success: true, session });
    } else {
      json(res, { success: false, error: '会话不存在' }, 404);
    }
    return;
  }

  // 对话 API (多轮 + 持久化)
  if (url === '/api/discuss' && req.method === 'POST') {
    const body = await parseBody(req);
    const message = body.message || '';
    const sessionId = body.sessionId || ('sess-' + Date.now());
    const engine = (process.env.HARNESS_ENGINE || 'minimax') as AgentEngine;

    let session = loadSession(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        title: message.slice(0, 40),
        turns: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // 更新标题
    if (session.turns.length === 0) {
      session.title = message.slice(0, 40);
    }

    session.turns.push({ role: 'user', content: message, time: new Date().toISOString() });

    // 构建 prompt (最近 10 轮)
    const recentTurns = session.turns.slice(-10);
    const historyText = recentTurns
      .map(t => (t.role === 'user' ? '👤: ' : '🤖: ') + t.content)
      .join('\n\n');

    const prompt = `## 对话历史\n${historyText}\n\n请回复用户。信息足够时输出需求文档草案。用户确认后末尾输出 READY_TO_SAVE。`;

    try {
      const reply = await agentCall(CONVERSATION_PROMPT, prompt, engine);
      session.turns.push({ role: 'agent', content: reply, time: new Date().toISOString() });

      const readyToSave = reply.includes('READY_TO_SAVE');
      let savedPath = '';

      if (readyToSave) {
        const docMatch = reply.match(/```REQUIREMENT\n([\s\S]*?)```/);
        if (docMatch) {
          const tasksDir = join(process.cwd(), '.tasks');
          mkdirSync(tasksDir, { recursive: true });
          const fullDoc = `# 需求文档\n\n> 生成时间: ${new Date().toISOString()}\n> 对话轮数: ${session.turns.length}\n\n${docMatch[1]}`;
          writeFileSync(join(tasksDir, 'REQUIREMENT.md'), fullDoc, 'utf-8');
          savedPath = join(tasksDir, 'REQUIREMENT.md');
          session.savedPath = savedPath;
        }
      }

      saveSession(session);

      json(res, {
        success: true,
        reply,
        readyToSave,
        savedPath,
        sessionId: session.id,
      });
    } catch (err: any) {
      json(res, { success: false, error: err?.message || String(err) }, 500);
    }
    return;
  }

  // 删除会话
  if (url === '/api/sessions/delete' && req.method === 'POST') {
    const body = await parseBody(req);
    const path = join(DISCUSS_DIR, body.sessionId + '.json');
    if (existsSync(path)) {
      unlinkSync(path);
      json(res, { success: true });
    } else {
      json(res, { success: false, error: '不存在' }, 404);
    }
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
    console.log('对话自动保存在 .tasks/discussions/');
    console.log('按 Ctrl+C 退出\n');
  });
}

if (process.argv[1]?.includes('discuss-server')) {
  startDiscussServer();
}
