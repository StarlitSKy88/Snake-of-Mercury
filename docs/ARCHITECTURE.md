# Snake of Mercury (水银之蛇) — 架构文档

> **版本**: v2.4 (TeamCreate 真对抗架构)
> **生成时间**: 2026-04-05
> **作者**: Ola

---

## 一、项目概述

### 1.1 核心目标

**「弥补产品不足、放大产品价值」，而非仅仅修复 bug**

实现从用户简短需求（1-4 句话）到完整可运行产品的**全自动化闭环开发流程**。

### 1.2 核心特性

| 特性 | 描述 |
|------|------|
| ✅ Phase 0 默认开启 | 每轮迭代先经过产品创新阶段 |
| ✅ 完全自动化 | 无人值守，正常轮次不询问用户 |
| ✅ 闭环迭代 | Phase 0 → 1 → 2 → 3 → 0 自动循环 |
| ✅ 智能收敛 | 连续 2 轮无价值提升自动暂停 |
| ✅ **TeamCreate 真对抗** | 5 Agent 通过 SendMessage 直接辩论 |
| ✅ 三层质量把关 | 测试 + 真实用户 + 独立裁决 |
| ✅ 上下文保护 | Phase 边界重置，防止溢出 |

---

## 二、架构全景图

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   🐍 Snake of Mercury (水银之蛇)                                 │
│               Snake of Mercury (水银之蛇) 全自动闭环开发引擎                                │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  用户需求 (1-4 句话)                                                              │
│      │                                                                           │
│      ▼                                                                           │
│  /harness skill ──调用──► harness-coordinator                                    │
│      │                      (总控协调器)                                          │
│      │                           │                                               │
│      ▼                           ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │ Phase 0: 产品创新阶段（默认开启）                                            │ │
│  │                                                                            │ │
│  │  Step 0: problem-definition skill → 8 模块标准化问题定义                     │ │
│  │                                                                            │ │
│  │  Step 1: 5 Agent 并行洞察（互相不可见）                                      │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │ │
│  │  │ insight-     │ │ innovation-  │ │ business-    │ │ quality-     │     │ │
│  │  │ challenger   │ │ officer      │ │ operator     │ │ supervisor   │     │ │
│  │  │ (需求质疑)    │ │ (颠覆创新)    │ │ (商业闭环)    │ │ (质量风险)    │     │ │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘     │ │
│  │  ┌──────────────┐                                                          │ │
│  │  │ planner      │                                                          │ │
│  │  │ (规划收敛)    │                                                          │ │
│  │  └──────────────┘                                                          │ │
│  │                                                                            │ │
│  │  Step 2: TeamCreate + SendMessage 真对抗辩论                               │ │
│  │  ┌────────────────────────────────────────────────────────────────────┐   │ │
│  │  │ Team: phase0-debate-{iteration_id}                                 │   │ │
│  │  │                                                                    │   │ │
│  │  │ Round 1: 每个 Agent 用 SendMessage 直接质疑其他 4 个视角            │   │ │
│  │  │          ←──────────── SendMessage ────────────→                   │   │ │
│  │  │                                                                    │   │ │
│  │  │ Round 2: 每个 Agent 用 SendMessage 直接回应质疑                     │   │ │
│  │  │          ←──────────── SendMessage ────────────→                   │   │ │
│  │  │                                                                    │   │ │
│  │  │ Round 3: planner 整合，输出增强版需求                               │   │ │
│  │  │          → .phase0-debate/converged-requirements.md                │   │ │
│  │  └────────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                            │ │
│  │  输出：增强版产品需求 + 验收标准                                            │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│      │                                                                           │
│      ▼                                                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │ Phase 1: 规划阶段                                                          │ │
│  │   product-planner: 生成产品规格文档 + Sprint 划分                           │ │
│  │   输出：./harness-spec.md                                                  │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│      │                                                                           │
│      ▼                                                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │ Phase 2: 开发阶段                                                          │ │
│  │                                                                            │ │
│  │  code-generator: 实现代码 + Git 提交 + 自测                                 │ │
│  │       │                                                                    │ │
│  │       ▼                                                                    │ │
│  │  ┌─────────────────────────────────────────────────────────────────────┐  │ │
│  │  │ 三层质量把关                                                        │  │ │
│  │  │                                                                     │  │ │
│  │  │ 第一层: qa-evaluator + vibcoding-three-agent-checkpoint            │  │ │
│  │  │         E2E 测试 + 代码审查 + 安全检查                               │  │ │
│  │  │                                                                     │  │ │
│  │  │ 第二层: bb-browser（可选）                                          │  │ │
│  │  │         真实用户场景测试                                             │  │ │
│  │  │                                                                     │  │ │
│  │  │ ★ 第三层: quality-supervisor 独立裁决                               │  │ │
│  │  │           一票否决权 + 收敛触发权                                    │  │ │
│  │  └─────────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│      │                                                                           │
│      ▼                                                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │ Phase 3: 交付阶段（自动执行）                                               │ │
│  │   ship → canary → document-release                                         │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│      │                                                                           │
│      ▼                                                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │ 收敛检测                                                                    │ │
│  │   • 连续 2 轮无价值提升 → 自主挖掘模式 → 继续迭代                            │ │
│  │   • 核心功能劣化 → 自动回滚                                                 │ │
│  │   • 用户说"停止" → 结束循环                                                 │ │
│  │   • 否则 → 自动返回 Phase 0                                                │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、6 人终局 Agent 阵容

| # | Agent | Phase | 核心职责 | 特殊权力 | 工具权限 |
|---|-------|-------|----------|----------|----------|
| 1 | **insight-challenger** | Phase 0 | 质疑需求、挖痛点、重构定位 | 3 个核心质疑 | Read, Grep, Glob, Write, SendMessage, TaskUpdate, TaskList, TaskGet |
| 2 | **innovation-officer** | Phase 0 | 创意发散、差异化、颠覆式创新 | 1 个完全推翻现有框架的方向 | Read, Grep, Glob, WebSearch, Write, SendMessage, TaskUpdate, TaskList, TaskGet |
| 3 | **business-operator** | Phase 0 | 商业评估、变现路径、壁垒分析 | 商业价值分 + 落地可行性分 | Read, Grep, Glob, Write, SendMessage, TaskUpdate, TaskList, TaskGet |
| 4 | **quality-supervisor** | Phase 0 + 2 | 质量视角 + 质量裁决 | **一票否决权 + 收敛触发权** | Read, Grep, Glob, Bash, Write, SendMessage, TaskUpdate, TaskList, TaskGet |
| 5 | **planner** | Phase 0 | 整合 5 视角、碰撞对抗、收敛决策 | 最终需求决策权 | (复用现有 planner agent) |
| 6 | **harness-coordinator** | All | 总控协调、流程调度、状态管理 | 全局调度权 | Read, Write, Grep, Glob, Bash, Agent, SendMessage, TaskCreate, TaskUpdate, Skill |

---

## 四、Phase 0 Step 2: TeamCreate 真对抗详解

### 4.1 核心机制

```python
# 1. 创建辩论团队
TeamCreate(team_name="phase0-debate-{id}", description="Phase 0 产品创新辩论")

# 2. 写入共享文件（供团队成员读取）
Write(".phase0-debate/{agent}-output.md", step1_results)

# 3. 启动 5 个 Agent 作为团队成员（并行）
Agent(subagent_type="phase0-insight-challenger", name="insight-challenger", team_name=team_name)
Agent(subagent_type="phase0-innovation-officer", name="innovation-officer", team_name=team_name)
Agent(subagent_type="phase0-business-operator", name="business-operator", team_name=team_name)
Agent(subagent_type="phase0-quality-supervisor", name="quality-supervisor", team_name=team_name)
Agent(subagent_type="planner", name="planner", team_name=team_name)

# 4. 辩论（自动进行）
# Round 1: SendMessage(to="xxx", message="[Round 1 质疑] ...")
# Round 2: SendMessage(to="*", message="[Round 2 回应] ...")
# Round 3: planner 整合 → converged-requirements.md

# 5. 清理
SendMessage(to="*", message={"type": "shutdown_request"})
TeamDelete()
```

### 4.2 与旧方案（coordinator 中转）的关键区别

| 维度 | 旧方案（已废弃） | 新方案（当前） |
|------|-----------------|---------------|
| 通信方式 | Agent → coordinator 转述 → Agent | **Agent → SendMessage → Agent（直接）** |
| 信息完整性 | 有损（转述时压缩/遗漏） | **无损（完整原始内容）** |
| 追问能力 | 必须等下一轮 | **即时追问** |
| 被说服修正 | 不可能 | **可以** |
| 官方推荐 | 否 | **是（Anthropic 最佳实践）** |

---

## 五、四维评分标准

| 维度 | 权重 | 评分重点 |
|------|------|---------|
| **产品深度** | 35% | 核心功能完整性、惊喜体验、超越预期 |
| **用户体验** | 30% | 交互流畅度、视觉一致性、异常处理 |
| **代码质量** | 20% | 可读性、架构合理性、测试覆盖 |
| **安全合规** | 15% | 输入验证、权限控制、数据保护 |

**通过标准**：总分 ≥ 8.0 且无单项 < 7.0

---

## 六、文件清单

### 6.1 Agent 文件

```
~/.claude/agents/
├── harness-coordinator.md           # 总控协调器
├── phase0-insight-challenger.md     # 需求重构洞察者
├── phase0-innovation-officer.md      # 颠覆式创新官
├── phase0-business-operator.md       # 商业闭环操盘手
└── phase0-quality-supervisor.md      # 独立质量监督官
```

### 6.2 Skill 文件

```
~/.claude/skills/
└── harness/
    └── SKILL.md                      # Snake of Mercury (水银之蛇) 入口 skill
```

### 6.3 项目源文件（Snake-of-Mercury）

```
./
├── agents/                           # Agent 定义（与 ~/.claude/agents 同步）
│   ├── harness-coordinator.md
│   ├── phase0-insight-challenger.md
│   ├── phase0-innovation-officer.md
│   ├── phase0-business-operator.md
│   └── phase0-quality-supervisor.md
├── skills/
│   └── harness/
│       └── SKILL.md
├── install.sh                        # 安装脚本
└── docs/
    └── ARCHITECTURE.md               # 本文档
```

---

## 七、使用方式

### 7.1 触发方式

```bash
# 斜杠命令
/harness 开发一个个人博客，支持文章发布、评论、标签

# 自然语言
我需要一个全自动开发流程来做一个命令行记账工具
```

### 7.2 流程自动化

1. `/harness` skill 自动调用 `harness-coordinator`
2. coordinator 自动调度 Phase 0-3 所有 Agent
3. 完全无人值守，正常轮次无需手动干预
4. 自动收敛检测，智能停止迭代

---

## 八、适用场景

### ✅ 推荐使用

- 一人公司 / 独立开发者
- 需要「产品创新」而不仅是「写代码」
- 希望自动发现产品不足并迭代
- 长周期项目需要无人值守运行

### ❌ 不推荐使用

- 只需要简单 bug 修复
- 需要人工审核每一步
- 没有可用的 Claude API 额度
- 不信任 AI 自动执行操作

---

**记住**：核心目标是「弥补产品不足、放大产品价值」，而非仅仅修复 bug。
