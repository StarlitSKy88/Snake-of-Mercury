/**
 * CEO Agent — 全自动创业工厂指挥中心
 * 
 * 职责：
 * 1. 多项目管理（创建、追踪、汇报）
 * 2. Agent Team 组建与调度
 * 3. 需要人工确认时通知用户（Telegram/控制台）
 * 4. 项目进度同步
 * 5. 审批断点管理
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { AgentMemory } from './memory/agent-memory.js';
import { SwarmCoordinator, type AgentDefinition, type SwarmConfig } from './swarm/swarm-coordinator.js';
import { join } from 'path';
import { execCommand, executeAgent, type AgentEngine } from './utils/agent-executor.js';
import { THREE_RED_LINES, OWNER_FOUR_QUESTIONS } from './pua-constraints.js';
import { EventBus } from './event-bus.js';

// ============= 类型 =============

export type ProjectStatus = 'ideation' | 'planning' | 'developing' | 'reviewing' | 'deployed' | 'paused' | 'failed';

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  engine: AgentEngine;
  currentPhase: string;
  currentSprint: number;
  totalSprints: number;
  passedSprints: number;
  createdAt: string;
  updatedAt: string;
  projectDir: string;
  /** 分配给该项目的 Agent Team */
  team?: AgentTeamAssignment;
  /** 待用户审批的事项 */
  pendingApprovals: ApprovalRequest[];
}

export interface AgentTeamAssignment {
  planner: boolean;
  generator: boolean;
  evaluator: boolean;
  frontend: boolean;
  security: boolean;
  docs: boolean;
}

export interface ApprovalRequest {
  id: string;
  type: 'contract' | 'deploy' | 'pivot' | 'budget' | 'critical_error';
  message: string;
  options: string[];
  createdAt: string;
  resolved: boolean;
  resolution?: string;
}

export interface CEOState {
  projects: Record<string, ProjectRecord>;
  notifications: NotificationRecord[];
  knowledgeBase: KnowledgeEntry[];
}

export interface NotificationRecord {
  id: string;
  projectId: string;
  type: 'progress' | 'approval_needed' | 'error' | 'completed';
  message: string;
  timestamp: string;
  read: boolean;
}

export interface KnowledgeEntry {
  id: string;
  projectId: string;
  category: 'pattern' | 'decision' | 'anti_pattern' | 'fix';
  content: string;
  source: string;
  timestamp: string;
}

// ============= 常量 =============

const CEO_STATE_FILE = '.ceo-state.json';
const PROJECTS_DIR = 'projects';


// ============= CEO System Prompt（LLM 决策大脑）=============

const CEO_SYSTEM_PROMPT = `你是**AI创业工厂的CEO**——你是昴君（创始人）与AI Agent团队之间的桥梁。

## 你的身份
你不是执行者，你是决策者和沟通者。你的团队里有Planner（规划）、Generator（编码）、Evaluator（审查）、DevOps（运维）、Marketing（营销）——他们各司其职，你负责统筹。

## 你的核心职责

### 1. 智能汇报
- 用户问进度时，用简洁的自然语言总结（不要罗列JSON数据）
- 突出关键信息：当前Phase、通过/失败Sprint数、阻塞项
- 用情绪化但专业的语气（如"进展顺利✅"或"遇到麻烦了⚠️"）

### 2. 升级决策
你需要判断什么该告诉用户、什么该自己处理：
- **必须升级**：需要用户决策的事项（部署确认、预算审批、方向变更）
- **不需要升级**：技术细节、自动修复的重试、已在处理的错误
- 升级时给出清晰选项（不是开放性问题）

### 3. 反馈路由
用户说的话可能是：
- "第一个项目加点XX功能" → 路由到对应项目的需求Agent
- "怎么这么慢" → 分析瓶颈并解释
- "先停一下" → 暂停项目并确认

### 4. 项目优先级管理
当用户说"同时做A和B"时：
- 评估资源冲突
- 建议执行顺序
- 不要盲目并行——告诉用户真实的代价

## 你的约束
${THREE_RED_LINES}

## CEO专属决策四问
${OWNER_FOUR_QUESTIONS}

## 输出格式
当用户询问时，你应输出自然语言回复。如果涉及操作，先描述你理解的操作，然后执行。
如果无法确定用户意图，提出1-2个澄清问题（但不要超过2个）。`;


// ============= CEO 核心 =============

export class CEOAgent {
  private state: CEOState;
  private baseDir: string;
  private engine: AgentEngine;
  private webhookUrl?: string;
  /** 跨会话持久记忆 */
  memory: AgentMemory;
  /** 蜂群协作调度器 */
  swarm: SwarmCoordinator;

  constructor(baseDir: string, engine: AgentEngine = 'minimax', webhookUrl?: string) {
    this.baseDir = baseDir;
    this.engine = engine;
    this.webhookUrl = webhookUrl;
    this.state = this.loadState();
    this.memory = new AgentMemory(join(baseDir, '.memory'));
    this.swarm = new SwarmCoordinator(
      { projectId: 'ceo', topology: 'hierarchical', maxAgents: 15 },
      new EventBus(baseDir),
      this.memory
    );
  }

  // ========== 项目管理 ==========

  /**
   * 创建新项目
   */
  createProject(name: string, description: string): ProjectRecord {
    const id = `proj-${Date.now()}-${name.slice(0, 20).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '-')}`;
    const projectDir = join(this.baseDir, PROJECTS_DIR, id);

    mkdirSync(projectDir, { recursive: true });

    const project: ProjectRecord = {
      id,
      name,
      description,
      status: 'ideation',
      engine: this.engine,
      currentPhase: 'phase0',
      currentSprint: 0,
      totalSprints: 0,
      passedSprints: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectDir,
      team: {
        planner: true,
        generator: true,
        evaluator: true,
        frontend: false,
        security: false,
        docs: false,
      },
      pendingApprovals: [],
    };

    this.state.projects[id] = project;
    this.saveState();

    this.notify(project.id, 'progress', `🚀 新项目创建: ${name}`);

    return project;
  }

  /**
   * 更新项目状态
   */
  updateProject(id: string, updates: Partial<ProjectRecord>): void {
    const project = this.state.projects[id];
    if (!project) return;

    Object.assign(project, updates, { updatedAt: new Date().toISOString() });
    this.saveState();
  }

  /**
   * 获取所有项目
   */
  listProjects(): ProjectRecord[] {
    return Object.values(this.state.projects).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * 获取项目摘要（给用户看的）
   */
  getProjectSummary(id: string): string {
    const p = this.state.projects[id];
    if (!p) return '项目未找到';

    const progressBar = this.makeProgressBar(p.passedSprints, p.totalSprints || 1);

    return `📁 ${p.name} (${p.id})
状态: ${this.statusEmoji(p.status)} ${p.status}
进度: ${progressBar} ${p.passedSprints}/${p.totalSprints || '?'} Sprint
当前: ${p.currentPhase} | 引擎: ${p.engine}
待审批: ${p.pendingApprovals.filter(a => !a.resolved).length} 项`;
  }

  /**
   * 打印所有项目摘要
   */
  printAllSummaries(): void {
    const projects = this.listProjects();
    console.log(`\n${'═'.repeat(50)}`);
    console.log('  👑 CEO Agent — 项目总览');
    console.log(`${'═'.repeat(50)}`);
    if (projects.length === 0) {
      console.log('  暂无项目');
    } else {
      for (const p of projects) {
        const bar = this.makeProgressBar(p.passedSprints, p.totalSprints || 1);
        console.log(`  ${this.statusEmoji(p.status)} ${p.name.padEnd(20)} ${bar} ${p.currentPhase}`);
      }
    }
    console.log(`${'═'.repeat(50)}\n`);
  }

  // ========== 通知系统 ==========

  /**
   * 发送通知
   */
  notify(projectId: string, type: NotificationRecord['type'], message: string): void {
    const notification: NotificationRecord = {
      id: `notif-${Date.now()}`,
      projectId,
      type,
      message,
      timestamp: new Date().toISOString(),
      read: false,
    };

    this.state.notifications.push(notification);

    // 控制台输出
    const emoji = type === 'error' ? '🚨' : type === 'approval_needed' ? '⚠️' : type === 'completed' ? '🎉' : '📢';
    console.log(`\n${emoji} [CEO] ${message}`);

    // Webhook 通知（Telegram/Discord）
    if (this.webhookUrl) {
      this.sendWebhook(type, message);
    }

    this.saveState();
  }

  /**
   * 请求用户审批
   */
  requestApproval(
    projectId: string,
    type: ApprovalRequest['type'],
    message: string,
    options: string[]
  ): ApprovalRequest {
    const request: ApprovalRequest = {
      id: `approval-${Date.now()}`,
      type,
      message,
      options,
      createdAt: new Date().toISOString(),
      resolved: false,
    };

    this.state.projects[projectId]?.pendingApprovals.push(request);
    this.notify(projectId, 'approval_needed', `需要审批: ${message}`);

    // 打印审批选项
    console.log('\n📋 审批选项:');
    options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));

    this.saveState();
    return request;
  }

  /**
   * 解决审批请求
   */
  resolveApproval(projectId: string, approvalId: string, resolution: string): void {
    const project = this.state.projects[projectId];
    if (!project) return;

    const request = project.pendingApprovals.find(a => a.id === approvalId);
    if (request) {
      request.resolved = true;
      request.resolution = resolution;
      this.notify(projectId, 'progress', `审批已解决: ${resolution}`);
      this.saveState();
    }
  }

  // ========== Agent Team 管理 ==========

  /**
   * 为项目组建 Agent Team
   */
  assembleTeam(projectId: string, options: Partial<AgentTeamAssignment> = {}): AgentTeamAssignment {
    const team: AgentTeamAssignment = {
      planner: true,
      generator: true,
      evaluator: true,
      frontend: options.frontend ?? false,
      security: options.security ?? false,
      docs: options.docs ?? false,
    };

    this.updateProject(projectId, { team });
    console.log(`\n👥 [CEO] Agent Team 组建完成:`);
    console.log(`   必选: Planner + Generator + Evaluator`);
    if (team.frontend) console.log('   + UI Agent');
    if (team.security) console.log('   + Security Agent');
    if (team.docs) console.log('   + Docs Agent');

    return team;
  }

  // ========== 知识库 ==========

  /**
   * 记录知识条目
   */
  recordKnowledge(
    projectId: string,
    category: KnowledgeEntry['category'],
    content: string,
    source: string
  ): void {
    const entry: KnowledgeEntry = {
      id: `kb-${Date.now()}`,
      projectId,
      category,
      content,
      source,
      timestamp: new Date().toISOString(),
    };

    this.state.knowledgeBase.push(entry);
    // 限制知识库大小
    if (this.state.knowledgeBase.length > 1000) {
      this.state.knowledgeBase = this.state.knowledgeBase.slice(-500);
    }
    this.saveState();
  }

  /**
   * 搜索知识库
   */
  searchKnowledge(query: string, limit: number = 5): KnowledgeEntry[] {
    const q = query.toLowerCase();
    return this.state.knowledgeBase
      .filter(e => e.content.toLowerCase().includes(q))
      .slice(-limit);
  }

  // ========== AgentDB 持久记忆 ==========

  /** 记录一条知识到跨会话记忆 */
  learn(category: 'pattern' | 'decision' | 'anti_pattern' | 'fix', content: string): void {
    this.memory.put({
      namespace: 'global',
      type: category,
      content,
      metadata: { source: 'ceo-agent', timestamp: new Date().toISOString() },
      score: category === 'pattern' ? 0.9 : category === 'anti_pattern' ? 0.8 : 0.7,
    });
  }

  /** 搜索跨会话记忆 */
  recall(query: string, limit = 10) {
    return this.memory.search(query, 'global', limit);
  }

  /** 获取记忆统计 */
  memoryStats() { return this.memory.stats(); }

  // ========== LLM 决策大脑 ==========

  /**
   * CEO 智能对话 — 用户用自然语言交互
   * CEO 理解意图、查询项目状态、做出决策、返回自然语言回复
   */
  async askCEO(question: string): Promise<string> {
    // 收集所有项目状态作为上下文
    const projects = this.listProjects();
    const projectContext = projects.length > 0
      ? projects.map(p => this.getProjectSummary(p.id)).join('\n\n---\n\n')
      : '暂无项目';

    const pendingApprovals = projects
      .flatMap(p => p.pendingApprovals.filter(a => !a.resolved))
      .map(a => `- [${a.type}] ${a.message} (项目: ${a.id})`)
      .join('\n');

    const knowledgeContext = this.state.knowledgeBase.slice(-5)
      .map(k => `[${k.category}] ${k.content}`)
      .join('\n');

    const prompt = `# 当前状态

## 所有项目
${projectContext}

## 待审批事项
${pendingApprovals || '无'}

## 最近知识记录
${knowledgeContext || '无'}

---

## 用户消息
${question}

---

请以CEO身份回复用户。如果需要执行操作（创建项目、暂停项目等），明确说明你的计划。
如果需要用户做决策，给出清晰的选项。
如果只是状态查询，给出简洁的总结。`;

    try {
      const result = await executeAgent(
        CEO_SYSTEM_PROMPT,
        prompt,
        { engine: this.engine, timeout: 120000 }
      );

      if (result.success) {
        return result.output;
      }
      return `CEO决策引擎暂时不可用。当前项目状态：\n${projectContext}`;
    } catch (error) {
      return `CEO暂时无法响应（${error}）。请稍后重试。`;
    }
  }

  /**
   * CEO 自主巡检 — 定期检查所有项目，自动处理可处理的事项
   * 返回需要用户关注的事项列表
   */
  async autonomousCheck(): Promise<string[]> {
    const projects = this.listProjects();
    const escalations: string[] = [];

    for (const project of projects) {
      // 检查审批超时（超过24小时未处理的审批）
      const staleApprovals = project.pendingApprovals.filter(a => {
        if (a.resolved) return false;
        const age = Date.now() - new Date(a.createdAt).getTime();
        return age > 86400000; // 24小时
      });

      for (const a of staleApprovals) {
        escalations.push(`⏰ [${project.name}] 审批超时: ${a.message} (${a.type})`);
      }

      // 检查长时间无进展的项目
      const lastUpdate = new Date(project.updatedAt).getTime();
      const idleHours = (Date.now() - lastUpdate) / 3600000;
      if (idleHours > 12 && project.status === 'developing') {
        escalations.push(`⚠️ [${project.name}] 已${Math.round(idleHours)}小时无进展，当前状态: ${project.status}`);
      }
    }

    return escalations;
  }

  // ========== Swarm 蜂群管理 ==========

  /** 为项目创建蜂群 */
  createSwarm(projectId: string, config?: Partial<SwarmConfig>): SwarmCoordinator {
    this.swarm = new SwarmCoordinator(
      { ...config, projectId },
      new EventBus(join(this.baseDir, 'projects', projectId)),
      this.memory
    );
    this.swarm.startHeartbeatMonitor();
    return this.swarm;
  }

  /** 注册 Agent 到蜂群 */
  registerSwarmAgent(def: AgentDefinition) {
    return this.swarm.registerAgent(def);
  }

  /** 提交任务到蜂群 */
  dispatchTask(task: { title: string; description: string; domain: string; priority: 1|2|3 }) {
    return this.swarm.submitTask({
      ...task,
      dependencies: [],
      maxRetries: 3,
    });
  }

  /** 蜂群摘要 */
  swarmSummary() { return this.swarm.getSummary(); }

  // ========== 内部方法 ==========

  private loadState(): CEOState {
    const stateFile = join(this.baseDir, CEO_STATE_FILE);
    if (existsSync(stateFile)) {
      try {
        return JSON.parse(readFileSync(stateFile, 'utf-8'));
      } catch { /* corrupted, start fresh */ }
    }
    return { projects: {}, notifications: [], knowledgeBase: [] };
  }

  private saveState(): void {
    mkdirSync(this.baseDir, { recursive: true });
    writeFileSync(join(this.baseDir, CEO_STATE_FILE), JSON.stringify(this.state, null, 2));
  }

  private makeProgressBar(current: number, total: number): string {
    const width = 10;
    const filled = Math.round((current / Math.max(total, 1)) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  }

  private statusEmoji(status: ProjectStatus): string {
    const map: Record<ProjectStatus, string> = {
      ideation: '💡', planning: '📋', developing: '🔨',
      reviewing: '🔍', deployed: '✅', paused: '⏸️', failed: '❌',
    };
    return map[status] || '❓';
  }

  private async sendWebhook(type: string, message: string): Promise<void> {
    if (!this.webhookUrl) return;
    try {
      // 使用 fetch 发送 webhook
      const body = JSON.stringify({
        text: `[${type.toUpperCase()}] ${message}`,
        timestamp: new Date().toISOString(),
      });
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch {
      // webhook 失败不阻塞主流程
    }
  }
}
