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
import { join } from 'path';
import { execCommand, executeAgent, type AgentEngine } from './utils/agent-executor.js';

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

// ============= CEO 核心 =============

export class CEOAgent {
  private state: CEOState;
  private baseDir: string;
  private engine: AgentEngine;
  private webhookUrl?: string;

  constructor(baseDir: string, engine: AgentEngine = 'claude', webhookUrl?: string) {
    this.baseDir = baseDir;
    this.engine = engine;
    this.webhookUrl = webhookUrl;
    this.state = this.loadState();
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
