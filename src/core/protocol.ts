/**
 * Protocol — 请求-响应协议（所有 Agent 间正式通信）
 * 
 * 每个请求有唯一 ID。接收方用同一个 ID 响应。
 * FSM: pending → approved | rejected
 * 
 * 持久化到 .protocols/ 目录，崩溃不丢。
 */

import { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

// ============ 类型 ============

export type ProtocolType = 
  | 'plan_approval'    // Agent 向用户/CEO 提交计划
  | 'shutdown'         // CEO 要求 Agent 关机
  | 'deployment'       // 部署请求
  | 'pivot'            // 方向变更
  | 'escalation';      // Agent 升级问题到 CEO/用户

export type ProtocolStatus = 'pending' | 'approved' | 'rejected';

export interface ProtocolRequest {
  id: string;
  type: ProtocolType;
  from: string;         // 发起方 ID
  to: string;           // 接收方 ID ('user' | 'ceo' | agent-id)
  subject: string;      // 简短标题
  payload: string;      // 详细内容
  status: ProtocolStatus;
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;  // 审批/拒绝理由
}

// ============ 核心 ============

export class ProtocolBus {
  private dir: string;

  constructor(projectDir: string) {
    this.dir = join(projectDir, '.protocols');
    mkdirSync(this.dir, { recursive: true });
  }

  /** 发起请求 */
  request(
    type: ProtocolType,
    from: string,
    to: string,
    subject: string,
    payload: string
  ): ProtocolRequest {
    const req: ProtocolRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type, from, to, subject, payload,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this._save(req);

    // 如果发给 user，打印到控制台
    if (to === 'user') {
      console.log(`\n📋 [${type}] ${from} → ${to}: ${subject}`);
      console.log(`${payload.slice(0, 200)}`);
      console.log(`ID: ${req.id} (respond with: approve ${req.id} / reject ${req.id} [reason])\n`);
    }

    return req;
  }

  /** 响应请求 */
  respond(id: string, status: ProtocolStatus, resolution?: string): ProtocolRequest | null {
    const req = this.get(id);
    if (!req || req.status !== 'pending') return null;

    req.status = status;
    req.resolvedAt = new Date().toISOString();
    req.resolution = resolution;
    this._save(req);

    console.log(`${status === 'approved' ? '✅' : '❌'} [Protocol] ${req.type} ${status}: ${req.subject}`);
    return req;
  }

  /** 获取请求 */
  get(id: string): ProtocolRequest | null {
    const path = this._reqPath(id);
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf-8')); }
    catch { return null; }
  }

  /** 列出待处理请求 */
  listPending(to?: string): ProtocolRequest[] {
    return this._listAll().filter(r => r.status === 'pending' && (!to || r.to === to));
  }

  /** 列出所有 */
  listAll(): ProtocolRequest[] {
    return this._listAll();
  }

  /** 给用户看的待审批摘要 */
  getUserInbox(): ProtocolRequest[] {
    return this.listPending('user');
  }

  // ===== 内部 =====

  private _save(req: ProtocolRequest): void {
    writeFileSync(this._reqPath(req.id), JSON.stringify(req, null, 2));
  }

  private _reqPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private _listAll(): ProtocolRequest[] {
    return readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(readFileSync(join(this.dir, f), 'utf-8')); }
        catch { return null; }
      })
      .filter((r): r is ProtocolRequest => r !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
