/**
 * EventBus — Agent 间消息总线
 * 
 * 遵循 Managed Agents "Session as append-only event log" 设计原则。
 * 
 * 特性:
 * - 发布/订阅模式
 * - 持久化事件日志（JSON Lines）
 * - 按事件类型过滤
 * - Agent间松耦合通信
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

// ============= 类型 =============

export type EventType =
  | 'phase:started'
  | 'phase:completed'
  | 'sprint:started'
  | 'sprint:contract_proposed'
  | 'sprint:contract_approved'
  | 'sprint:generator_done'
  | 'sprint:evaluator_done'
  | 'sprint:passed'
  | 'sprint:rejected'
  | 'sprint:rollback'
  | 'ceo:project_created'
  | 'ceo:approval_needed'
  | 'ceo:approval_resolved'
  | 'devops:incident'
  | 'devops:auto_fixed'
  | 'devops:escalated'
  | 'marketing:optimization_task'
  | 'marketing:feedback'
  | 'user:message'
  | 'system:error'
  | 'system:completed';

export interface BusEvent {
  id: string;
  type: EventType;
  source: string;      // 来源 Agent 名称
  target?: string;     // 目标 Agent（可选，不指定=广播）
  projectId?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export type EventHandler = (event: BusEvent) => void | Promise<void>;

// ============= EventBus =============

export class EventBus {
  private handlers: Map<EventType, EventHandler[]> = new Map();
  private history: BusEvent[] = [];
  private logFile: string;
  private maxHistory: number;

  constructor(baseDir: string, maxHistory: number = 10000) {
    mkdirSync(baseDir, { recursive: true });
    this.logFile = join(baseDir, 'event-log.jsonl');
    this.maxHistory = maxHistory;
    this.loadHistory();
  }

  // ========== 发布 ==========

  /**
   * 发布事件
   */
  emit(
    type: EventType,
    source: string,
    payload: Record<string, unknown> = {},
    options: { target?: string; projectId?: string } = {}
  ): BusEvent {
    const event: BusEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      source,
      target: options.target,
      projectId: options.projectId,
      payload,
      timestamp: new Date().toISOString(),
    };

    // 持久化（append-only）
    this.persist(event);

    // 内存历史
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory / 2);
    }

    // 通知订阅者
    const handlers = this.handlers.get(type) || [];
    for (const handler of handlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch(err => console.error(`[EventBus] Handler error for ${type}:`, err));
        }
      } catch (err) {
        console.error(`[EventBus] Handler error for ${type}:`, err);
      }
    }

    // 也通知通配符订阅者
    const wildcardHandlers = this.handlers.get('*' as EventType) || [];
    for (const handler of wildcardHandlers) {
      try { handler(event); } catch {}
    }

    return event;
  }

  // ========== 订阅 ==========

  /**
   * 订阅特定事件类型
   */
  on(type: EventType | '*', handler: EventHandler): () => void {
    const t = type as EventType;
    if (!this.handlers.has(t)) {
      this.handlers.set(t, []);
    }
    this.handlers.get(t)!.push(handler);

    // 返回取消订阅函数
    return () => {
      const handlers = this.handlers.get(t);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }

  /**
   * 订阅多种事件类型
   */
  onMany(types: EventType[], handler: EventHandler): () => void {
    const unsubs = types.map(t => this.on(t, handler));
    return () => unsubs.forEach(fn => fn());
  }

  // ========== 查询 ==========

  /**
   * 获取历史事件（按类型过滤）
   */
  getHistory(filter?: {
    type?: EventType;
    projectId?: string;
    source?: string;
    since?: string; // ISO timestamp
    limit?: number;
  }): BusEvent[] {
    let events = [...this.history];

    if (filter?.type) events = events.filter(e => e.type === filter.type);
    if (filter?.projectId) events = events.filter(e => e.projectId === filter.projectId);
    if (filter?.source) events = events.filter(e => e.source === filter.source);
    if (filter?.since) events = events.filter(e => e.timestamp >= filter.since!);
    if (filter?.limit) events = events.slice(-filter.limit);

    return events;
  }

  /**
   * 获取项目摘要
   */
  getProjectTimeline(projectId: string): BusEvent[] {
    return this.history.filter(e => e.projectId === projectId);
  }

  // ========== 持久化 ==========

  private persist(event: BusEvent): void {
    try {
      appendFileSync(this.logFile, JSON.stringify(event) + '\n');
    } catch (err) {
      console.error('[EventBus] 持久化失败:', err);
    }
  }

  private loadHistory(): void {
    if (!existsSync(this.logFile)) return;

    try {
      const lines = readFileSync(this.logFile, 'utf-8').trim().split('\n');
      this.history = lines
        .filter(l => l.trim())
        .map(l => {
          try { return JSON.parse(l) as BusEvent; } catch { return null; }
        })
        .filter((e): e is BusEvent => e !== null)
        .slice(-this.maxHistory);
    } catch (err) {
      console.error('[EventBus] 加载历史失败:', err);
    }
  }

  // ========== 工具 ==========

  /**
   * 清空历史（仅内存）
   */
  clearMemory(): void {
    this.history = [];
  }
}
