# Snake of Mercury - 产品规格文档

## 1. 产品概述

**产品名称：** Snake of Mercury - 需求发现与创新决策 AI 助手

**核心价值：** 基于苏格拉底式追问机制，帮助用户在信息不充分的条件下快速收敛产品方向。核心机制：边验证边澄清，而非线性等待。用户输入模糊念头，系统通过强制选择式提问在3轮内输出带置信度的需求假设清单。

**当前状态：** Sprint 1 已完成 ✅
- 已实现：创新类型判断节点、决策卡点定位器、六字段状态机、强制选择式追问引擎、收敛检测、Developer-Supervisor 分离机制

---

## 2. 功能列表

### MUST（必须有）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| Phase 0 追问收敛引擎 | 苏格拉底式强制选择提问，3轮内收敛需求 | Sprint 1 ✅ |
| 创新类型判断节点 | 第一轮强制问"颠覆式还是渐进式" | Sprint 1 ✅ |
| 决策卡点定位器 | 第二轮问"最大的卡点是什么"，收敛到四维度 | Sprint 1 ✅ |
| 六字段状态机 | 管理追问进度（创新类型/卡点/问题定义/JTBD/替代方案/风险假设） | Sprint 1 ✅ |
| 收敛检测器 | 检测 CONTINUE/STOP/EXPLORE/ROLLBACK 信号 | Sprint 1 ✅ |
| Developer-Supervisor 分离 | developer 实现，supervisor 独立审查，防止"既当裁判又当运动员" | Sprint 1 ✅ |
| **辩论引擎 Hub** | 5个视角 Agent 协作，输出增强版需求文档 | Sprint 2 |
| **Phase 1 Sprint 规划自动化** | 根据需求自动生成 Sprint 合同 | Sprint 2 |
| **四维评分体系** | 产品深度(35%)/用户体验(30%)/代码质量(20%)/安全合规(15%) | Sprint 1 ✅ |

### SHOULD（应该有）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| Phase 3 交付流水线 | 部署配置、Canary 监控 | Sprint 3 |
| 回滚管理器 | 支持回滚到上一稳定版本 | Sprint 1 ✅ |
| 迭代历史快照 | 记录每次迭代的分数和质量趋势 | Sprint 2 |
| 自主挖掘模式 | 连续无改进时自动寻找新方向 | Sprint 2 |
| 多轮辩论收敛 | 3轮辩论后输出最终决策 | Sprint 2 |

### COULD（可以有）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| Web UI 界面 | 提供可视化交互界面 | Sprint 4 |
| 导出功能 | 导出需求文档、PRD、Sprint 合同 | Sprint 4 |
|Webhook 集成 | 支持外部系统触发和回调 | Sprint 4 |
| 多语言支持 | 中文/英文切换 | Sprint 4 |

---

## 3. Sprint 规划

### Sprint 1 ✅ 已完成

**目标：** 实现核心基础功能
**验收标准：**
1. 功能可运行
2. 无明显bug
3. 第一轮必须问创新类型，未问则拒绝输出结论
4. 决策卡点定位后能选择对应追问模板
**技术约束：** TypeScript + Vitest + Zod + @anthropic-ai/sdk

---

### Sprint 2：完善与优化

**目标：** 完善核心功能，建立辩论引擎，实现 Phase 1 规划自动化

**objectives：**
1. 实现辩论引擎 Hub（5个视角 Agent 协作）
2. 完成 Phase 0→Phase 1 流程串联
3. 实现 Sprint 合同自动生成
4. 提升测试覆盖率至 80%

**acceptanceCriteria：**
1. 用户完成 Phase 0 追问后，系统自动生成 ProductSpec JSON
2. 辩论引擎支持 5 个 Agent 同时参与并输出共识/分歧
3. Sprint 合同包含明确的 objectives、acceptanceCriteria、estimatedDuration
4. 所有核心模块测试覆盖率 ≥ 80%

**estimatedDuration：** 2-3 小时

**technicalConstraints：**
- 必须保持 Developer-Supervisor 分离原则
- 辩论结果必须包含 commonGround 和 keyDisagreements

---

### Sprint 3：高级功能开发

**目标：** 实现 Phase 3 交付流水线，完成集成测试

**objectives：**
1. 实现 Phase 3 部署流水线
2. 实现 Canary 监控报告
3. 完成端到端集成测试
4. 实现迭代历史和快照管理

**acceptanceCriteria：**
1. 部署流水线支持一键部署到 Vercel/Railway
2. Canary 监控报告包含延迟/错误率/可用性指标
3. E2E 测试覆盖核心用户流程
4. 迭代快照包含分数、质量趋势、改进方向

**estimatedDuration：** 2-3 小时

**technicalConstraints：**
- 部署必须通过 CI/CD 自动化
- Canary 报告必须包含健康状态判断

---

### Sprint 4：发布准备

**目标：** 收尾工作、文档完善、部署配置

**objectives：**
1. 完善 README 和使用文档
2. 完成部署配置和环境变量管理
3. 生成最终验收报告
4. 优化错误处理和日志输出

**acceptanceCriteria：**
1. README 包含完整的安装、使用、配置说明
2. 部署配置支持一键部署
3. 所有环境变量通过 .env 管理，无硬编码
4. 最终验收报告包含所有 Sprint 的执行结果

**estimatedDuration：** 1-2 小时

**technicalConstraints：**
- 敏感信息必须通过环境变量注入
- 必须包含 health check 接口

---

## 4. 技术方向

### 技术栈（已锁定）
- **语言：** TypeScript
- **测试：** Vitest
- **验证：** Zod
- **AI：** @anthropic-ai/sdk
- **运行时：** Node.js 18+

### 架构设计

```
src/
├── phase0-questionnaire.ts    # Sprint 1 ✅ 追问收敛引擎
├── phase0-debate-engine.ts    # Sprint 2 辩论引擎 Hub
├── phase1-planner.ts          # Sprint 2 Sprint 规划自动化
├── phase2-developer.ts        # Sprint 2 Developer 执行器
├── phase2-supervisor.ts       # Sprint 1/2 Supervisor 审查器
├── phase3-delivery.ts        # Sprint 3 部署流水线
├── state-machine.ts          # Phase 状态管理
├── convergence-detector.ts    # Sprint 1 ✅ 收敛检测
├── rollback-manager.ts       # Sprint 1 ✅ 回滚管理
├── harness-scheduler.ts      # Sprint 3 迭代调度器
├── types.ts                  # 类型定义
└── integrations/             # 外部集成
```

### 核心设计原则

1. **Developer-Supervisor 分离：** developer 不可见 supervisor，supervisor 只看输出
2. **强制选择式提问：** 不允许无限开放式问答
3. **收敛检测：** 分数劣化 → 回滚，连续无改进 → 自主挖掘
4. **四维评分：** 产品深度(35%)/用户体验(30%)/代码质量(20%)/安全合规(15%)

---

## 5. 验收标准

### 全局验收标准

| 标准 | 描述 |
|------|------|
| 覆盖率 | 核心模块测试覆盖率 ≥ 80% |
| 通过阈值 | Supervisor 评分 ≥ 8.0 且无单项 < 7.0 |
| 分离原则 | Developer 实现对 Supervisor 不可见 |
| 追问约束 | 未问创新类型问题，系统拒绝输出分析结论 |
| 收敛标准 | 用户明确要求停止 OR 分数 ≥ 9.5 OR 连续3轮无改进 |

### Sprint 验收检查清单

**Sprint 1 ✅**
- [x] 创新类型判断节点实现
- [x] 决策卡点定位器实现
- [x] 六字段状态机实现
- [x] 强制选择式提问实现
- [x] 68.47% 测试覆盖率
- [x] 76 个测试全部通过

**Sprint 2**
- [ ] 辩论引擎 Hub 实现（5 Agent 协作）
- [ ] Phase 0→Phase 1 流程串联
- [ ] Sprint 合同自动生成
- [ ] 测试覆盖率 ≥ 80%

**Sprint 3**
- [ ] Phase 3 部署流水线
- [ ] Canary 监控报告
- [ ] E2E 测试通过
- [ ] 迭代快照管理

**Sprint 4**
- [ ] README 完善
- [ ] 部署配置完成
- [ ] 环境变量管理
- [ ] 最终验收报告

---

## 6. 产品创新边界

### "Simple" 约束

| 维度 | 约束 | 度量标准 |
|------|------|----------|
| 提问轮次 | 最多 3 轮强制选择 | currentRound ≤ maxRounds |
| Agent 数量 | 辩论引擎 5 个视角 | 5 agents fixed |
| Sprint 数量 | 固定 4 个 Sprint | sprintPlan.length === 4 |
| 评分维度 | 固定 4 维 | 4 dimensions fixed |
| 收敛条件 | 明确的停止信号 | 3 conditions defined |

### 停止条件（STOP Signals）

1. **用户主动停止：** 包含"停止/结束/够了/satisfied"等关键词
2. **达到目标：** 分数 ≥ 9.5 且产品深度 ≥ 9.0
3. **资源耗尽：** 连续 3 轮无改进，自主挖掘 2 次后仍无方向

---

*文档版本：v1.0*
*最后更新：2026/04/12*
*状态：Sprint 1 ✅ 完成，待执行 Sprint 2-4*
