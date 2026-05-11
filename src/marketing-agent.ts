/**
 * Marketing & Data Agent — 上线后自动化运营
 * 
 * 职责：
 * 1. 采集项目数据（用户量、转化率、留存等）
 * 2. 分析数据趋势，发现优化机会
 * 3. 自动生成优化任务→提交给 CEO Agent
 * 4. 用户反馈收集与分析
 * 5. A/B 测试启停（预留）
 */

import { execCommand, executeAgent, type AgentEngine } from './utils/agent-executor.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============= 类型 =============

export interface AnalyticsSource {
  name: string;
  type: 'plausible' | 'posthog' | 'custom_api' | 'manual';
  apiKey?: string;
  baseUrl?: string;
  siteId?: string;
}

export interface MetricSnapshot {
  timestamp: string;
  visitors: number;
  pageviews: number;
  bounceRate: number;
  avgDuration: number;
  conversions: number;
  customMetrics: Record<string, number>;
}

export interface OptimizationTask {
  id: string;
  projectId: string;
  type: 'performance' | 'ux' | 'conversion' | 'bug' | 'feature';
  title: string;
  description: string;
  priority: 1 | 2 | 3;
  source: 'analytics' | 'feedback' | 'competitor' | 'ai_suggestion';
  confidence: number;
  expectedImpact: string;
  createdAt: string;
}

export interface UserFeedback {
  id: string;
  projectId: string;
  source: 'form' | 'email' | 'chat' | 'review' | 'social';
  content: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  category: string;
  timestamp: string;
}

export interface MarketingState {
  analyticsSources: AnalyticsSource[];
  metrics: MetricSnapshot[];
  optimizationTasks: OptimizationTask[];
  feedback: UserFeedback[];
  lastFetchTimestamp: string;
}

// ============= 常量 =============

const MARKETING_STATE_FILE = '.marketing-state.json';
const DEFAULT_FETCH_INTERVAL = 3600000; // 1小时

// ============= Marketing Agent =============

export class MarketingAgent {
  private state: MarketingState;
  private baseDir: string;
  private engine: AgentEngine;
  private onTaskGenerated?: (task: OptimizationTask) => void;
  private fetchTimer?: ReturnType<typeof setInterval>;

  constructor(
    baseDir: string,
    engine: AgentEngine = 'claude',
    onTaskGenerated?: (task: OptimizationTask) => void
  ) {
    this.baseDir = baseDir;
    this.engine = engine;
    this.onTaskGenerated = onTaskGenerated;
    this.state = this.loadState();
  }

  /**
   * 配置数据源
   */
  configureSource(source: AnalyticsSource): void {
    const existing = this.state.analyticsSources.findIndex(s => s.name === source.name);
    if (existing >= 0) {
      this.state.analyticsSources[existing] = source;
    } else {
      this.state.analyticsSources.push(source);
    }
    this.saveState();
    console.log(`📈 [Marketing] 数据源已配置: ${source.name}`);
  }

  /**
   * 开始定期数据采集
   */
  startCollecting(): void {
    console.log('📈 [Marketing] 数据采集启动...');
    this.collectData(); // 立即执行一次

    this.fetchTimer = setInterval(() => {
      this.collectData();
    }, DEFAULT_FETCH_INTERVAL);
  }

  /**
   * 停止采集
   */
  stopCollecting(): void {
    if (this.fetchTimer) {
      clearInterval(this.fetchTimer);
    }
  }

  /**
   * 采集数据
   */
  async collectData(): Promise<void> {
    console.log('📈 [Marketing] 采集数据...');

    for (const source of this.state.analyticsSources) {
      try {
        const metrics = await this.fetchFromSource(source);
        if (metrics) {
          this.state.metrics.push(metrics);
          // 只保留最近 720 条（30天每小时）
          if (this.state.metrics.length > 720) {
            this.state.metrics = this.state.metrics.slice(-360);
          }
        }
      } catch (error) {
        console.warn(`[Marketing] 数据源 ${source.name} 采集失败:`, error);
      }
    }

    this.state.lastFetchTimestamp = new Date().toISOString();
    this.saveState();

    // 分析数据，生成优化任务
    await this.analyzeAndOptimize();
  }

  /**
   * 从数据源拉取指标
   */
  private async fetchFromSource(source: AnalyticsSource): Promise<MetricSnapshot | null> {
    if (source.type === 'plausible' && source.apiKey && source.siteId) {
      return this.fetchPlausible(source);
    }
    if (source.type === 'custom_api' && source.baseUrl) {
      return this.fetchCustomAPI(source);
    }
    // manual 或其他类型暂不自动抓取
    return null;
  }

  /**
   * 从 Plausible 拉取
   */
  private async fetchPlausible(source: AnalyticsSource): Promise<MetricSnapshot | null> {
    try {
      const response = await fetch(
        `https://plausible.io/api/v1/stats/aggregate?site_id=${source.siteId}&period=day`,
        {
          headers: { Authorization: `Bearer ${source.apiKey}` },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) return null;

      const data = await response.json() as Record<string, { value: number }>;
      return {
        timestamp: new Date().toISOString(),
        visitors: data.visitors?.value || 0,
        pageviews: data.pageviews?.value || 0,
        bounceRate: data.bounce_rate?.value || 0,
        avgDuration: data.visit_duration?.value || 0,
        conversions: 0,
        customMetrics: {},
      };
    } catch {
      return null;
    }
  }

  /**
   * 从自定义 API 拉取
   */
  private async fetchCustomAPI(source: AnalyticsSource): Promise<MetricSnapshot | null> {
    try {
      const response = await fetch(source.baseUrl!, {
        headers: source.apiKey ? { Authorization: `Bearer ${source.apiKey}` } : {},
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return null;
      const data = await response.json() as MetricSnapshot;
      return { ...data, timestamp: new Date().toISOString() };
    } catch {
      return null;
    }
  }

  /**
   * 分析数据并生成优化任务
   */
  async analyzeAndOptimize(): Promise<void> {
    const recent = this.state.metrics.slice(-24); // 最近24条

    if (recent.length < 2) return;

    // 简单规则：趋势分析
    const tasks: OptimizationTask[] = [];

    // 1. 跳出率上升
    const recentBounce = recent.slice(-6);
    const avgBounce = recentBounce.reduce((s, m) => s + m.bounceRate, 0) / recentBounce.length;
    if (avgBounce > 70) {
      tasks.push(this.createTask('ux', '跳出率过高，需要优化着陆页体验', 1));
    }

    // 2. 转化率下降
    const recentConv = recent.slice(-6);
    const avgConv = recentConv.reduce((s, m) => s + m.conversions, 0) / recentConv.length;
    const olderConv = recent.slice(0, 6).reduce((s, m) => s + m.conversions, 0) / 6 || 1;
    if (avgConv < olderConv * 0.7) {
      tasks.push(this.createTask('conversion', '转化率下降30%+，需要检查转化漏斗', 2));
    }

    // 3. 用户量趋势
    const recentVisitors = recent.slice(-6).reduce((s, m) => s + m.visitors, 0);
    const olderVisitors = recent.slice(0, 6).reduce((s, m) => s + m.visitors, 0);
    if (recentVisitors < olderVisitors * 0.5 && olderVisitors > 10) {
      tasks.push(this.createTask('feature', '用户量下降50%+，可能需要新功能或营销', 3));
    }

    // 注册任务
    for (const task of tasks) {
      this.state.optimizationTasks.push(task);
      this.onTaskGenerated?.(task);
    }

    if (tasks.length > 0) {
      console.log(`📈 [Marketing] 生成 ${tasks.length} 个优化任务`);
    }

    this.saveState();
  }

  /**
   * 记录用户反馈
   */
  recordFeedback(feedback: Omit<UserFeedback, 'id' | 'timestamp'>): void {
    const entry: UserFeedback = {
      ...feedback,
      id: `fb-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };

    this.state.feedback.push(entry);

    // 负面反馈自动生成优化任务
    if (entry.sentiment === 'negative') {
      const task = this.createTask('bug', `用户反馈: ${entry.content.slice(0, 100)}`, 1);
      this.state.optimizationTasks.push(task);
      this.onTaskGenerated?.(task);
    }

    this.saveState();
  }

  /**
   * 获取营销摘要
   */
  getSummary(): string {
    const recent = this.state.metrics.slice(-1)[0];
    const totalTasks = this.state.optimizationTasks.length;
    const pendingTasks = this.state.optimizationTasks.filter(t => t.priority === 1).length;

    return `📈 Marketing 状态
最近指标: ${recent ? `${recent.visitors} 访客, ${recent.pageviews} PV` : '暂无数据'}
待优化任务: ${pendingTasks}/${totalTasks}
反馈: ${this.state.feedback.length} 条
数据源: ${this.state.analyticsSources.map(s => s.name).join(', ') || '未配置'}`;
  }

  // ========== 内部 ==========

  private createTask(
    type: OptimizationTask['type'],
    description: string,
    priority: 1 | 2 | 3
  ): OptimizationTask {
    return {
      id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId: '',
      type,
      title: description.slice(0, 80),
      description,
      priority,
      source: 'analytics',
      confidence: 0.7,
      expectedImpact: '待评估',
      createdAt: new Date().toISOString(),
    };
  }

  private loadState(): MarketingState {
    const file = join(this.baseDir, MARKETING_STATE_FILE);
    if (existsSync(file)) {
      try { return JSON.parse(readFileSync(file, 'utf-8')); } catch {}
    }
    return {
      analyticsSources: [],
      metrics: [],
      optimizationTasks: [],
      feedback: [],
      lastFetchTimestamp: '',
    };
  }

  private saveState(): void {
    mkdirSync(this.baseDir, { recursive: true });
    writeFileSync(join(this.baseDir, MARKETING_STATE_FILE), JSON.stringify(this.state, null, 2));
  }
}
