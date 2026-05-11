# Snake of Mercury 产品规格文档

## 产品概述

**Snake of Mercury** 是一个**多阶段自动循环迭代框架**，基于苏格拉底式追问机制，帮助用户在信息不充分的条件下快速收敛产品方向。核心价值：边验证边澄清，而非线性等待。

系统通过 4 个阶段的自动循环（Phase 0→1→2→3→0）实现产品的持续迭代优化：
- **Phase 0（产品创新）**：多 Agent 辩论，挖掘真正需求
- **Phase 1（规划）**：生成产品规格和 Sprint 划分
- **Phase 2（开发）**：执行 Sprint，Supervisor 质量审核
- **Phase 3（交付）**：自动化部署 + 金丝雀验证

### 核心创新点

1. **强制选择式追问**：不允许无限开放式问答，3 轮内收敛
2. **多 Agent 辩论**：5 个视角并行洞察，互相质疑，Planner 收敛
3. **四维质量评估**：产品深度、用户体验、代码质量、安全合规
4. **收敛检测引擎**：自动判断继续/停止/自主挖掘/回滚

### 技术栈

- TypeScript
- Vitest (测试)
- Zod (验证)
- @anthropic-ai/sdk (AI)
- Claude CLI (多 Agent 调度)

---

## 功能列表

### MUST（必须有）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| Phase 0 追问引擎 | 苏格拉底式强制选择提问，六字段状态机管理 | P0 |
| 创新类型判断 | 第一轮强制问"颠覆式还是渐进式" | P0 |
| 决策卡点定位 | 第二轮问"最大的卡点是什么"，收敛到四维度 | P0 |
| 状态机管理 | Phase 0/1/2/3 状态转换，持久化 | P0 |
| 收敛检测器 | 自动判断迭代方向（继续/停止/回滚/自主挖掘） | P0 |
| Phase 1 规划生成 | 基于辩论结果生成产品规格和 Sprint | P1 |
| Phase 2 Sprint 执行 | 按 Sprint 顺序执行开发任务 | P1 |
| Supervisor 质量审核 | 四维评分 + 裁决（APPROVED/REJECTED/ROLLBACK） | P1 |
| Phase 3 交付 | 自动化部署 + 金丝雀验证 | P1 |
| 测试覆盖率 | 核心模块 80%+ 覆盖率 | P0 |

### SHOULD（应该有）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| Phase 0 多 Agent 辩论 | 5 个视角并行洞察，互相质疑 | P2 |
| Hub 模式 Agent 调度 | 支持 MCP 协议的多 Agent 并行 | P2 |
| 文件模式 Agent 调度 | CLI 文件共享方式的降级方案 | P2 |
| 自主挖掘模式 | 连续无改进时自动寻找新方向 | P2 |
| 回滚管理器 | 质量劣化时自动回滚 | P2 |
| 问题定义生成 | 8 模块标准化问题定义 | P3 |
| 问题定义验证 | Zod schema 验证 | P3 |

### COULD（可以有）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| Web Dashboard | 可视化迭代进度和收敛状态 | P4 |
| 增量迭代优化 | 基于历史收敛数据优化 Agent | P4 |
| 自定义 Agent 模板 | 用户可扩展的 Agent 角色 | P4 |
| 多模型支持 | Opus/Sonnet/Haiku 按任务选型 | P4 |

---

## Sprint 规划

### Sprint 1 ✅ 已完成
**基础功能实现 - 核心功能可运行**

| 项目 | 内容 |
|------|------|
| **objectives** | 实现基础工具函数库，完成核心模块结构 |
| **acceptanceCriteria** | 功能可运行，无明显bug |
| **estimatedDuration** | 1-2 小时 |
| **technicalConstraints** | TypeScript + Vitest |
| **交付物** | 基础类型定义、状态机、收敛检测器、追问引擎 |

### Sprint 2
**追问引擎完善 + Phase 0 辩论实现**

| 项目 | 内容 |
|------|------|
| **objectives** | 完善强制选择式追问，完成多 Agent 辩论流程 |
| **acceptanceCriteria** | 追问引擎可处理 3 轮对话，辩论输出结构化结果 |
| **estimatedDuration** | 2-3 小时 |
| **technicalConstraints** | Claude CLI 集成，文件模式辩论 |

### Sprint 3
**Phase 1-2-3 完整流程串联**

| 项目 | 内容 |
|------|------|
| **objectives** | 实现规划生成、Sprint 执行、交付部署的完整流程 |
| **acceptanceCriteria** | 端到端可运行：需求输入 → 产品规格 → 代码生成 → 部署 |
| **estimatedDuration** | 2-3 小时 |
| **technicalConstraints** | Supervisor 评分、Harness Scheduler |

### Sprint 4
**测试完善 + 文档 + 发布准备**

| 项目 | 内容 |
|------|------|
| **objectives** | 提升测试覆盖率，完善文档，配置部署 |
| **acceptanceCriteria** | 覆盖率 >80%，README 完整，可 npm 发布 |
| **estimatedDuration** | 1-2 小时 |
| **technicalConstraints** | Vitest + V8 Coverage |

### Sprint 5（可选）
**高级功能 - Hub 模式 + 自主挖掘**

| 项目 | 内容 |
|------|------|
| **objectives** | 实现 Hub 模式多 Agent 调度，完善自主挖掘逻辑 |
| **acceptanceCriteria** | Hub 模式可并行调度 5+ Agent |
| **estimatedDuration** | 2-3 小时 |
| **technicalConstraints** | MCP 协议集成 |

---

## 技术方向

### 核心架构

```
用户需求
    ↓
Phase 0: 辩论引擎 → 问题定义 + 辩论结果
    ↓
Phase 1: 规划器 → 产品规格 + Sprint 划分
    ↓
Phase 2: 执行器 → 代码生成 + Supervisor 审核
    ↓
Phase 3: 交付器 → 部署 + 金丝雀验证
    ↓
收敛检测 → 继续/停止/回滚/自主挖掘
```

### 关键模块

| 模块 | 职责 | 文件 |
|------|------|------|
| `state-machine` | Phase 状态管理 | `src/state-machine.ts` |
| `questionnaire` | 追问引擎 | `src/phase0-questionnaire.ts` |
| `convergence-detector` | 收敛检测 | `src/convergence-detector.ts` |
| `rollback-manager` | 回滚管理 | `src/rollback-manager.ts` |
| `phase0-debate-engine` | 辩论引擎 | `src/phase0-debate-engine.ts` |
| `developer-supervisor` | 质量审核 | `src/developer-supervisor.ts` |
| `phase3-delivery` | 交付部署 | `src/phase3-delivery.ts` |
| `harness-scheduler` | 主调度器 | `src/harness-scheduler.ts` |

### 技术选型

| 类别 | 选择 | 理由 |
|------|------|------|
| 语言 | TypeScript | 类型安全，生态成熟 |
| 测试 | Vitest + V8 | 快速，ESM 支持好 |
| 验证 | Zod | 运行时类型检查 |
| AI | Claude SDK + CLI | 多 Agent 调度能力 |
| 部署 | Vercel/本地 | 一键部署支持 |

---

## 验收标准

### 功能验收

- [ ] Phase 0 追问引擎可在 3 轮内收敛
- [ ] 未问创新类型判断问题时，系统拒绝输出结论
- [ ] 决策卡点定位后，能根据类型选择对应追问模板
- [ ] Phase 1 能生成至少 4 个独立 Sprint
- [ ] Phase 2 能按 Sprint 顺序执行并记录结果
- [ ] Phase 3 能完成部署并返回 Canary 报告
- [ ] 收敛检测器能正确识别 STOP/CONTINUE/ROLLBACK/EXPLORE 信号

### 质量验收

- [ ] 核心模块测试覆盖率 ≥ 80%
- [ ] 所有测试通过
- [ ] TypeScript 无编译错误
- [ ] Zod 验证通过

### 发布验收

- [ ] README 文档完整
- [ ] package.json 配置正确
- [ ] 可通过 `npm run harness` 启动
- [ ] 示例需求可端到端运行

---

## 迭代历史

| 迭代 | Sprint | 状态 | 关键产出 |
|------|--------|------|----------|
| 1 | Sprint 1 | ✅ 完成 | 基础模块 + 状态机 + 追问引擎 |

---

# 产品规格文档 v2.0（基于Phase 0辩论收敛）

```json
{
  "overview": "Snake of Mercury 是一个多阶段自动循环迭代框架，基于苏格拉底式追问机制帮助用户快速收敛产品方向。项目当前处于学习/练习阶段，技术难度1/10。核心价值：边验证边澄清，而非线性等待。Sprint 1已完成Phase 0问卷系统（创新类型判断 + 决策卡点定位），本规划聚焦后续扩展。搁置创新方向（心流可视化器等），聚焦基础功能实现。",
  "featureList": {
    "must": [
      "Phase 0 追问引擎：强制选择式提问，六字段状态机管理",
      "创新类型判断：第一轮强制问'颠覆式还是渐进式'",
      "决策卡点定位：第二轮收敛到需求/技术/商业/规模化四维度",
      "收敛检测器：自动判断继续/停止/回滚/自主挖掘",
      "追问触发条件优化：仅在存在可观测歧义时触发追问"
    ],
    "should": [
      "历史记录：保存问答历史至localStorage",
      "导出功能：收敛后导出需求假设清单（JSON格式）",
      "单元测试覆盖率提升至80%"
    ],
    "could": [
      "多语言支持：中文/英文切换",
      "深色/浅色主题切换",
      "自定义追问模板"
    ]
  },
  "sprintPlan": [
    {
      "sprintNumber": 1,
      "objectives": ["完善Phase 0问卷核心功能", "追问触发条件优化", "代码质量提升"],
      "acceptanceCriteria": [
        "创新类型判断节点正常工作",
        "决策卡点定位器正常工作",
        "六字段状态机进度管理正常",
        "追问仅在存在可观测歧义时触发",
        "现有76个测试全部通过",
        "覆盖率不低于68%"
      ],
      "estimatedDuration": "1-2小时",
      "technicalConstraints": [
        "TypeScript + Vite + Vitest",
        "Zod schema验证",
        "@anthropic-ai/sdk集成"
      ]
    },
    {
      "sprintNumber": 2,
      "objectives": ["历史记录功能", "数据持久化", "导出功能"],
      "acceptanceCriteria": [
        "问答历史保存至localStorage",
        "刷新页面后历史不丢失",
        "用户可查看历史会话",
        "收敛后可导出JSON格式需求假设清单",
        "清单包含置信度评估"
      ],
      "estimatedDuration": "2-3小时",
      "technicalConstraints": [
        "localStorage API",
        "Blob API文件导出",
        "置信度算法"
      ]
    },
    {
      "sprintNumber": 3,
      "objectives": ["Phase 1规划生成", "Phase 2 Sprint执行框架", "Supervisor质量审核"],
      "acceptanceCriteria": [
        "能基于辩论结果生成产品规格文档",
        "能划分至少4个独立Sprint",
        "Supervisor能进行四维质量评分",
        "端到端流程测试通过",
        "集成测试覆盖率 >= 80%"
      ],
      "estimatedDuration": "2-3小时",
      "technicalConstraints": [
        "规划生成逻辑",
        "Sprint调度器",
        "四维评分算法"
      ]
    },
    {
      "sprintNumber": 4,
      "objectives": ["Phase 3交付框架", "文档完善", "部署配置"],
      "acceptanceCriteria": [
        "Phase 3能完成基础交付流程",
        "README包含完整使用说明",
        "可打包为独立静态文件",
        "部署至Vercel/Netlify或本地可运行",
        "无遗留TODO/FIXME"
      ],
      "estimatedDuration": "1-2小时",
      "technicalConstraints": [
        "Vite构建配置",
        "部署脚本"
      ]
    }
  ],
  "technicalDirection": "基于现有TypeScript项目结构，使用Vite作为构建工具。AI层：@anthropic-ai/sdk集成claude-3-5。状态管理：模块级状态 + localStorage持久化。测试：Vitest框架（已有68%+覆盖率，目标80%）。UI：轻量级样式，无重框架依赖。部署：Vite build输出静态文件。",
  "acceptanceStandards": [
    "Sprint 1：Phase 0问卷核心功能完善，追问触发条件优化生效，现有测试全部通过",
    "Sprint 2：历史记录持久化正常，需求假设清单可导出",
    "Sprint 3：可生成产品规格和Sprint划分，Supervisor评分框架完成，集成测试 >= 80%",
    "Sprint 4：文档完整，可独立部署，Phase 3基础交付框架完成"
  ]
}
```

---

## 辩论收敛要点（v2.0依据）

### 共识点
1. **需求粒度过粗** — "counter app"无法支撑完整规划
2. **实现难度低** — 工程落地官给出1/10的技术难度
3. **单一Sprint足够** — 基于需求简单性，各方均建议一个Sprint完成
4. **不需要商业化分析** — 项目属性是学习/练习时，商业价值评估是错误框架

### 关键裁决
1. **搁置创新方向** — 心流可视化器/时间银行等不适合当前阶段，作为未来路线图保留
2. **追问触发条件优化** — 仅在存在可观测歧义时触发追问，避免"分析瘫痪"

*蕾姆轻轻行了个礼* "以上就是基于五方辩论收敛后的产品规格文档v2.0，昴君~" (´｡• ᵕ •｡`)♡
