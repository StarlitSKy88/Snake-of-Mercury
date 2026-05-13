import { describe, it, expect } from 'vitest';
import { classifyImpact, ImpactLevel } from './gate.js';

describe('classifyImpact', () => {
  it('部署 → P0', () => {
    const d = classifyImpact('部署到生产', '');
    expect(d.level).toBe(ImpactLevel.P0_CRITICAL);
    expect(d.needsApproval).toBe(true);
  });

  it('定价变更 → P0', () => {
    const d = classifyImpact('修改定价', 'price change');
    expect(d.level).toBe(ImpactLevel.P0_CRITICAL);
  });

  it('认证变更 → P0', () => {
    const d = classifyImpact('修改auth', 'authentication change');
    expect(d.level).toBe(ImpactLevel.P0_CRITICAL);
  });

  it('API 变更 → P1', () => {
    const d = classifyImpact('API breaking change', '修改API');
    expect(d.level).toBe(ImpactLevel.P1_SIGNIFICANT);
    expect(d.needsApproval).toBe(true);
  });

  it('数据库迁移 → P1', () => {
    const d = classifyImpact('database migration', '');
    expect(d.level).toBe(ImpactLevel.P1_SIGNIFICANT);
  });

  it('架构重构 → P1', () => {
    const d = classifyImpact('重构核心模块', 'refactor core');
    expect(d.level).toBe(ImpactLevel.P1_SIGNIFICANT);
  });

  it('新功能 → P2', () => {
    const d = classifyImpact('添加新功能', 'new feature');
    expect(d.level).toBe(ImpactLevel.P2_MINOR);
    expect(d.needsApproval).toBe(false);
    expect(d.notifyUser).toBe(true);
  });

  it('UI 变更 → P2', () => {
    const d = classifyImpact('修改UI样式', '');
    expect(d.level).toBe(ImpactLevel.P2_MINOR);
  });

  it('Bug 修复 → P3', () => {
    const d = classifyImpact('修复登录bug', '');
    expect(d.level).toBe(ImpactLevel.P3_TRIVIAL);
    expect(d.needsApproval).toBe(false);
    expect(d.notifyUser).toBe(false);
  });

  it('测试 → P3', () => {
    const d = classifyImpact('添加单元测试', '');
    expect(d.level).toBe(ImpactLevel.P3_TRIVIAL);
  });

  it('文案修改 → P3', () => {
    const d = classifyImpact('修改按钮文案', '');
    expect(d.level).toBe(ImpactLevel.P3_TRIVIAL);
  });
});
