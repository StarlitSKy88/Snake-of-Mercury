/**
 * Gate — 影响级别路由
 * 
 * 决定一个操作是否需要用户审批，以及如何通知。
 * 
 * 影响级别:
 *   P3 (0) — 修Bug、加测试、改文案 → 全自动
 *   P2 (1) — 新功能、UI改动 → 自动执行，事后通知
 *   P1 (2) — API变更、DB改动、架构调整 → 通知+24h无反对继续
 *   P0 (3) — 部署上线、价格变更、删功能 → 必须审批
 */

import { ProtocolBus, type ProtocolRequest } from './protocol.js';

// ============ 类型 ============

export enum ImpactLevel {
  P3_TRIVIAL = 0,
  P2_MINOR = 1,
  P1_SIGNIFICANT = 2,
  P0_CRITICAL = 3,
}

export interface GateDecision {
  level: ImpactLevel;
  needsApproval: boolean;
  notifyUser: boolean;
  description: string;
}

// ============ 判断逻辑 ============

export function classifyImpact(taskSubject: string, taskDescription: string): GateDecision {
  const text = (taskSubject + ' ' + taskDescription).toLowerCase();

  // P0: 部署、定价、删除功能、认证变更
  if (/deploy|部署|上线|publish|发布|price|定价|delete.*(?:existing|已有).*feature|删除.*已有功能|移除.*功能|砍掉.*功能|auth|认证|payment|支付/.test(text)) {
    return { level: ImpactLevel.P0_CRITICAL, needsApproval: true, notifyUser: true, description: '关键操作：部署/定价/权限变更' };
  }

  // P1: API变更、数据库迁移、架构调整
  if (/api.*(change|break|变更)|database.*(migrat|迁移)|schema|架构|refactor.*core|重构.*核心/.test(text)) {
    return { level: ImpactLevel.P1_SIGNIFICANT, needsApproval: true, notifyUser: true, description: '重要变更：API/数据库/架构' };
  }

  // P2: 新功能、UI变化
  if (/new.*(feature|功能)|add.*(feature|功能)|ui|界面|style|样式|component|组件/.test(text)) {
    return { level: ImpactLevel.P2_MINOR, needsApproval: false, notifyUser: true, description: '功能/UI变更' };
  }

  // P3: Bug修复、测试、文案
  return { level: ImpactLevel.P3_TRIVIAL, needsApproval: false, notifyUser: false, description: '微调/Bug修复' };
}

// ============ Gate ============

export class Gate {
  constructor(private protocol: ProtocolBus) {}

  /**
   * 检查一个操作是否需要审批
   * 如果需要，自动发起 ProtocolRequest
   */
  async check(
    subject: string,
    description: string,
    from: string
  ): Promise<{ blocked: boolean; request?: ProtocolRequest }> {
    const decision = classifyImpact(subject, description);

    if (decision.level <= ImpactLevel.P2_MINOR) {
      // P2/P3: 直接放行
      if (decision.notifyUser) {
        console.log(`🔔 [Gate] ${from}: ${decision.description} — 自动放行，已记录`);
      }
      return { blocked: false };
    }

    // P0/P1: 需要审批
    const req = this.protocol.request(
      'plan_approval',
      from,
      'user',
      `[${decision.description}] ${subject}`,
      `${description}\n\n影响级别: ${decision.level === ImpactLevel.P0_CRITICAL ? 'P0 关键' : 'P1 重要'}\n自动发起审批请求。`
    );

    return { blocked: true, request: req };
  }

  /**
   * 检查审批是否已通过
   */
  isApproved(requestId: string): boolean {
    const req = this.protocol.get(requestId);
    return req?.status === 'approved';
  }
}
