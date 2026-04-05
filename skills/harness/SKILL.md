---
name: harness
description: Unified Autopilot 全自动闭环开发引擎。当用户输入 /harness 命令或描述产品开发需求时，自动调用 harness-coordinator，通过 Phase 0 产品创新（5 Agent 并行 + 真对抗）→ Phase 1 规划 → Phase 2 开发（三层质量把关）→ Phase 3 交付 的全自动化闭环流程，实现无人值守的持续迭代。
---

# Unified Autopilot 全自动闭环开发引擎

## 核心规则（必须 100% 严格执行）

### 1. 唯一入口：调用 harness-coordinator

每次触发此技能，**必须且只能**使用 Agent 工具调用 `harness-coordinator`：

```python
Agent(
    subagent_type="harness-coordinator",
    prompt="用户需求：{requirement}\n\n请启动 Unified Autopilot 全自动化流程，从 Phase 0 产品创新开始，经过规划、开发、交付的完整闭环迭代。"
)
```

**禁止**单独调用任何子 Agent（planner、generator、evaluator 等），全部由 coordinator 自动调度。

### 2. 完整架构（6 Agent + TeamCreate 真对抗 + Phase 0-3 闭环）

```
用户需求 → harness-coordinator 接收
    → Phase 0: 产品创新
        Step 0: problem-definition skill（标准化问题定义）
        Step 1: 5 Agent 并行洞察（互相不可见）
            - insight-challenger（需求质疑）
            - innovation-officer（颠覆创新）
            - business-operator（商业闭环）
            - quality-supervisor（质量风险）
            - planner（规划收敛）
        Step 2: TeamCreate + SendMessage 真对抗辩论
            Round 1: 每个 Agent 用 SendMessage 直接质疑其他 4 个视角
            Round 2: 每个 Agent 用 SendMessage 直接回应质疑
            Round 3: planner 整合，输出增强版需求
        Step 3: 输出增强版产品需求 + 验收标准
    → Phase 1: product-planner 生成规格文档 + Sprint 划分
    → Phase 2: 开发 + 三层质量把关
        第一层: qa-evaluator + vibcoding-three-agent-checkpoint
        第二层: bb-browser 真实用户测试（可选）
        第三层: quality-supervisor 独立裁决（一票否决权）
    → Phase 3: ship → canary → document-release
    → 收敛检测 → 继续迭代 / 自主挖掘 / 停止
```

### 3. 触发方式

- 斜杠命令：`/harness [产品需求描述]`
- 自然语言：包含「harness」「autopilot」「全自动开发」等关键词 + 需求

### 4. 自动化级别

- **完全无人值守**：正常轮次不询问用户
- **闭环迭代**：Phase 0 → 1 → 2 → 3 → 0 自动循环
- **智能收敛**：连续 2 轮无价值提升 → 自主挖掘模式 → 继续迭代
- **状态持久化**：每步保存到 `./.harness-state.json`，支持中断续跑

### 5. 输出规范

- 启动时：输出 🚀 Unified Autopilot 全自动化流程启动，包含需求、工作目录、迭代模式
- Phase 0 完成时：输出 ✅ Phase 0 产品创新阶段完成，包含核心洞察和创新方向
- 每个 Sprint 完成时：输出 ✅ Sprint {N} 完成，包含四维评分
- Phase 3 完成时：输出 ✅ Phase 3 交付阶段完成
- 收敛检测：输出 🔍 收敛检测结果
- 项目完成时：输出 🎉 Unified Autopilot 全流程完成！

## 执行流程（harness-coordinator 自动完成）

### Phase 0: 产品创新阶段（默认开启）

1. 调用 problem-definition skill 标准化问题定义（8 模块）
2. 并行启动 5 个 Agent 独立洞察（互相不可见）
3. TeamCreate 创建辩论团队，5 个 Agent 通过 SendMessage 直接通信
4. 3 轮真对抗：Round 1 质疑 → Round 2 回应 → Round 3 收敛
5. planner 整合输出增强版产品需求 + 验收标准

### Phase 1: 规划阶段

- product-planner 生成完整产品规格文档（./harness-spec.md）
- 包含：产品概述、功能列表（MUST/SHOULD/COULD）、Sprint 划分、验收标准

### Phase 2: 开发阶段

1. Sprint 协商：generator 与 evaluator 协商 Sprint 合同
2. 代码实现：generator 实现代码 + Git 提交 + 自测
3. 三层质量把关：
   - 第一层：自动化测试 + 代码审查
   - 第二层：bb-browser 真实用户测试（如果可用）
   - 第三层：独立质量监督官裁决（一票否决）
4. 迭代决策：通过→继续/否决→修复/回滚→修复

### Phase 3: 交付阶段（自动执行）

- ship：自动部署
- canary：监控验证
- document-release：更新文档

### 收敛检测

- 连续 2 轮无价值提升 → 自主挖掘模式（不停，找新方向）
- 核心功能劣化 → 自动回滚
- 用户说停止 → 停止
- 否则 → 自动返回 Phase 0

## 四维评分标准

| 维度 | 权重 | 重点 |
|------|------|------|
| 产品深度 | 35% | 核心功能完整性、惊喜体验、超越预期 |
| 用户体验 | 30% | 交互流畅度、视觉一致性、异常处理 |
| 代码质量 | 20% | 可读性、架构合理性、测试覆盖 |
| 安全合规 | 15% | 输入验证、权限控制、数据保护 |

通过标准：总分 ≥ 8.0 且无单项 < 7.0

## 使用示例

```
/harness 开发一个个人博客，支持文章发布、评论、标签
/harness 做一个命令行记账工具，支持分类统计和导出
/harness 开发一个 RSS 阅读器 Web 应用
```

## 注意事项

1. **需求要具体但开放**：1-4 句话描述核心需求即可
2. **耐心等待**：完整流程可能需要数小时
3. **信任流程**：完全自动化，正常轮次无需手动干预
4. **查看进度**：会实时报告执行进度
5. **停止方式**：直接说「停止」或「满意了」

---

**记住**：你只需要调用 `harness-coordinator`，它会自动协调 6 个 Agent（5 创新 + 1 质量监督），通过产品创新→规划→开发→交付的完整闭环，实现从想法到产品的全自动化。核心目标是「弥补产品不足、放大产品价值」，而非仅仅修复 bug。
