/**
 * DevOps Agent — 7×24 运维监控
 * 
 * 职责：
 * 1. 监控部署项目的健康状态
 * 2. 发现问题时自动修复
 * 3. 无法解决时通过 CEO Agent 上报
 * 4. 自动扩缩容（预留）
 */

import { execCommand, type AgentEngine } from './utils/agent-executor.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============= 类型 =============

export interface ServiceEndpoint {
  name: string;
  url: string;
  type: 'frontend' | 'backend' | 'database' | 'cdn';
  expectedStatus: number;
  checkIntervalMs: number;
}

export interface HealthCheckResult {
  endpoint: ServiceEndpoint;
  healthy: boolean;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
  timestamp: string;
}

export interface Incident {
  id: string;
  endpoint: ServiceEndpoint;
  severity: 'critical' | 'warning' | 'info';
  description: string;
  detectedAt: string;
  resolvedAt?: string;
  autoResolved: boolean;
  resolution?: string;
}

export interface DevOpsState {
  endpoints: ServiceEndpoint[];
  incidents: Incident[];
  healthHistory: HealthCheckResult[];
  lastCheckTimestamp: string;
}

// ============= 常量 =============

const DEVOPS_STATE_FILE = '.devops-state.json';
const DEFAULT_CHECK_INTERVAL = 60000; // 1分钟

// ============= DevOps Agent =============

export class DevOpsAgent {
  private state: DevOpsState;
  private baseDir: string;
  private engine: AgentEngine;
  private onEscalate?: (incident: Incident) => void;
  private checkTimer?: ReturnType<typeof setInterval>;

  constructor(
    baseDir: string,
    engine: AgentEngine = 'claude',
    onEscalate?: (incident: Incident) => void
  ) {
    this.baseDir = baseDir;
    this.engine = engine;
    this.onEscalate = onEscalate;
    this.state = this.loadState();
  }

  /**
   * 注册监控端点
   */
  registerEndpoint(endpoint: ServiceEndpoint): void {
    const existing = this.state.endpoints.findIndex(e => e.url === endpoint.url);
    if (existing >= 0) {
      this.state.endpoints[existing] = endpoint;
    } else {
      this.state.endpoints.push(endpoint);
    }
    this.saveState();
    console.log(`🔧 [DevOps] 注册监控: ${endpoint.name} (${endpoint.url})`);
  }

  /**
   * 开始持续监控
   */
  startMonitoring(): void {
    console.log('🔧 [DevOps] 7×24 监控启动...');
    this.runHealthCheck(); // 立即执行一次

    this.checkTimer = setInterval(() => {
      this.runHealthCheck();
    }, DEFAULT_CHECK_INTERVAL);
  }

  /**
   * 停止监控
   */
  stopMonitoring(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      console.log('🔧 [DevOps] 监控已停止');
    }
  }

  /**
   * 执行一次健康检查
   */
  async runHealthCheck(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];

    for (const endpoint of this.state.endpoints) {
      const result = await this.checkEndpoint(endpoint);
      results.push(result);

      if (!result.healthy) {
        await this.handleUnhealthy(result);
      }
    }

    this.state.lastCheckTimestamp = new Date().toISOString();
    this.state.healthHistory.push(...results);
    // 只保留最近 1000 条记录
    if (this.state.healthHistory.length > 1000) {
      this.state.healthHistory = this.state.healthHistory.slice(-500);
    }
    this.saveState();

    return results;
  }

  /**
   * 检查单个端点
   */
  private async checkEndpoint(endpoint: ServiceEndpoint): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(endpoint.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
      });

      return {
        endpoint,
        healthy: response.status === endpoint.expectedStatus,
        statusCode: response.status,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        endpoint,
        healthy: false,
        error: String(error),
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 处理不健康的端点
   */
  private async handleUnhealthy(result: HealthCheckResult): Promise<void> {
    console.log(`\n🚨 [DevOps] ${result.endpoint.name} 异常: ${result.error || `HTTP ${result.statusCode}`}`);

    // 创建 Incident
    const incident: Incident = {
      id: `inc-${Date.now()}`,
      endpoint: result.endpoint,
      severity: 'critical',
      description: `端点 ${result.endpoint.name} 不健康: ${result.error || `HTTP ${result.statusCode}`}`,
      detectedAt: new Date().toISOString(),
      autoResolved: false,
    };

    // 尝试自动修复
    const resolved = await this.tryAutoFix(incident);
    if (resolved) {
      incident.autoResolved = true;
      incident.resolvedAt = new Date().toISOString();
      incident.resolution = '自动修复';
      console.log(`✅ [DevOps] ${result.endpoint.name} 自动修复成功`);
    } else {
      // 升级给 CEO Agent
      console.log(`⚠️ [DevOps] ${result.endpoint.name} 无法自动修复，上报 CEO`);
      this.onEscalate?.(incident);
    }

    this.state.incidents.push(incident);
    // 只保留最近 100 条
    if (this.state.incidents.length > 100) {
      this.state.incidents = this.state.incidents.slice(-50);
    }
    this.saveState();
  }

  /**
   * 尝试自动修复
   */
  private async tryAutoFix(incident: Incident): Promise<boolean> {
    // 简单策略：尝试重新部署或重启
    const endpoint = incident.endpoint;

    // 检查是否是常见的临时故障
    if (incident.description.includes('fetch failed') || incident.description.includes('ENOTFOUND')) {
      // DNS 或网络问题，等 30 秒再试
      await this.sleep(30000);
      const retry = await this.checkEndpoint(endpoint);
      return retry.healthy;
    }

    // 对于后端服务，尝试执行健康检查端点
    if (endpoint.type === 'backend') {
      try {
        const healthUrl = endpoint.url.replace(/\/$/, '') + '/health';
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
        return response.ok;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * 获取运维摘要
   */
  getSummary(): string {
    const total = this.state.endpoints.length;
    const healthy = this.state.healthHistory
      .filter(h => h.healthy)
      .length;
    const incidents = this.state.incidents.filter(i => !i.resolvedAt).length;
    const autoResolved = this.state.incidents.filter(i => i.autoResolved).length;

    return `🔧 DevOps 状态
监控端点: ${total}
活跃故障: ${incidents}
自动修复: ${autoResolved}
上次检查: ${this.state.lastCheckTimestamp || '未开始'}`;
  }

  // ========== 内部 ==========

  private loadState(): DevOpsState {
    const file = join(this.baseDir, DEVOPS_STATE_FILE);
    if (existsSync(file)) {
      try { return JSON.parse(readFileSync(file, 'utf-8')); } catch {}
    }
    return { endpoints: [], incidents: [], healthHistory: [], lastCheckTimestamp: '' };
  }

  private saveState(): void {
    mkdirSync(this.baseDir, { recursive: true });
    writeFileSync(join(this.baseDir, DEVOPS_STATE_FILE), JSON.stringify(this.state, null, 2));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
