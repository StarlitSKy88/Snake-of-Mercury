# Snake of Mercury — AI 创业工厂 v2.0

> GitHub: https://github.com/StarlitSKy88/Snake-of-Mercury
> 引擎: Codex CLI (DeepSeek V4 Pro) | Claude SDK (Opus 4.5+)
> 架构: Anthropic Managed Agents + Ralph Wiggum 自主循环
> 定位: 输入模糊想法 → 全自动 7×24 开发迭代 → 部署上线 → 数据驱动优化

---

## 一、核心架构

```
                          ┌──────────────────────────────────┐
                          │       👑 CEO Agent                │
                          │  多项目管理 · 进度汇报 · 审批     │
                          └──────────────┬───────────────────┘
                                         │ EventBus
          ┌──────────────────────────────┼──────────────────────────────┐
          │                              │                              │
   ┌──────▼──────┐              ┌───────▼───────┐              ┌───────▼──────┐
   │ 🔧 DevOps   │              │  📈 Marketing  │              │  🧠 Phase 0  │
   │ 7×24 监控   │              │ 数据+AiToEarn  │              │ 苏格拉底追问 │
   └─────────────┘              └───────┬───────┘              └───────┬──────┘
                                       │                              │
                              ┌────────▼──────────────────────────────▼────────┐
                              │          Anthropic Harness 三角                │
                              │  ┌──────────┐  ┌──────────┐  ┌────────────┐   │
                              │  │①Planner  │→│②Generator│→│③Evaluator  │   │
                              │  │ 需求拆解  │  │ Sprint实现│  │ 4维硬阈值  │   │
                              │  └──────────┘  └──────────┘  └─────┬──────┘   │
                              │       ↑                  ↑         │ 未通过    │
                              │       └─ 优化建议 ───────┘←────────┘ 返回修复  │
                              └──────────────────────┬────────────────────────┘
                                                     │ 全部通过
                                            ┌────────▼────────┐
                                            │   🚀 Phase 3    │
                                            │   自动部署上线   │
                                            └────────┬────────┘
                                                     │
                                            ┌────────▼────────┐
                                            │   🔄 数据收集   │
                                            │  Marketing Agent │→ AiToEarn 12平台
                                            │  优化任务回Phase0│
                                            └─────────────────┘
```

### 闭环流程

```
用户模糊想法
    ↓
Phase 0: 苏格拉底追问 → 辩论引擎 → 收敛需求文档
    ↓
Phase 1: Planner → 拆解为 Sprint Contract 列表
    ↓
Phase 2: Ralph Wiggum Loop { Generator → Evaluator → 修复 → 重验证 }
    ↓  (50次熔断, 每Sprint 3次重试)
Phase 3: 自动部署 → 金丝雀 → 上线
    ↓
数据收集 → 用户反馈 → Marketing Agent → 优化任务 → Phase 0
    ↓
🔄 无限循环（7×24）
```

---

## 二、Agent 通信协议

### EventBus（Pub/Sub + JSONL 持久化）

所有 Agent 通过 `src/event-bus.ts` 通信，**禁止 Agent 间直接调用**。

**原则**：
- **发布/订阅**：Agent 发布事件，其他 Agent 订阅感兴趣的事件类型
- **JSONL 持久化**：所有事件 append-only 写入 `event-log.jsonl`，可回溯审计
- **松耦合**：Agent 互不感知，通过事件类型解耦
- **上下文传递**：DeepSeek 无状态模式下，通过事件日志 + `.ralph-context.json` 传递上下文

**关键事件类型**：

| 事件 | 发布者 | 订阅者 | 含义 |
|------|--------|--------|------|
| `ceo:project_created` | CEO | DevOps, Marketing | 新项目启动 |
| `phase:started` / `phase:completed` | Harness | CEO | 阶段切换 |
| `sprint:contract_approved` | Evaluator | Generator | 合同评审通过 |
| `sprint:rejected` | Evaluator | Generator, RalphLoop | 需修复重试 |
| `devops:escalated` | DevOps | CEO | 需人工介入 |
| `marketing:optimization_task` | Marketing | CEO → Planner | 数据驱动的优化需求 |

---

## 三、Ralph Wiggum Loop（自主开发引擎）

### 设计原则

```
Sprint Contract → Generator 实现 → Evaluator 评分
                      ↑                  ↓
                      └── 修复 ←── 未通过（≤3次重试）
                                       ↓
                                   全部通过 → 下一个 Sprint
```

### 核心参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `maxIterations` | 50 | 总迭代次数熔断 |
| `maxRetriesPerTask` | 3 | 单个 Sprint 最大重试 |
| `contextReset` | true (DeepSeek) | 每次新 Sprint 写入 `.ralph-context.json` |
| `contextResetInterval` | 1 | 每N个任务重置一次（DeepSeek=1，Claude=0） |

### 上下文管理（DeepSeek 专用）

DeepSeek V4 Pro **无状态**，每个 API 调用不携带历史。解决方案：
1. 每次 Sprint 前写入 `.ralph-context.json`（包含已完成任务、当前目标）
2. 通过 EventBus 的 JSONL 日志传递项目级上下文
3. 代码变更通过 Git diff 写入 Sprint Contract 描述

### 熔断规则

- 单 Sprint 连续3次 Evaluator REJECTED → 标记 `failed`，跳到下一个
- 总迭代50次 → 停止循环，通知 CEO
- 连续10次无分数提升 → 触发 `ROLLBACK`
- **仅以下情况暂停并通知用户**：不可逆风险、外部依赖完全失败、业务决策需求

---

## 四、Agent 详解

### 👑 CEO Agent (`src/ceo-agent.ts`)
- 多项目创建/追踪/汇报
- Agent Team 组建（必选 Planner+Generator+Evaluator，可选 UI/Security/Docs）
- 待审批事项管理（`pendingApprovals` 队列）
- 知识库积累（patterns、decisions、anti_patterns、fixes）
- Webhook 通知（Telegram/Discord）

### 🧠 Planner Agent (`src/planner-agent.ts`)
- 接收 Phase 0 收敛需求 → 输出 15+ Feature 产品规格
- 按 MoSCoW 分类（Must/Should/Could）
- 生成 Sprint Contract 列表
- 接收 Evaluator 优化建议 → 修正需求

### 🔨 Generator Agent (`src/generator-agent.ts`)
- 接收 Sprint Contract → 实现代码
- 通过 Codex CLI / Claude SDK 调用底层模型
- 返回改动摘要 + 文件列表

### 🔍 Evaluator Agent (`src/evaluator-agent.ts`)
- **4维硬阈值评分**（Anthropic 标准）：
  - 产品深度 (35%)
  - 用户体验 (30%)
  - 代码质量 (20%)
  - 安全合规 (15%)
- 总分 < 85 → REJECTED + 具体修复建议
- 检测 Evaluator 偏见（hallucination 检查）

### 🔧 DevOps Agent (`src/devops-agent.ts`)
- 7×24 健康检查循环
- 自动修复（重启 PM2、清理磁盘、回滚部署）
- 故障升级（无法自动修复 → CEO → 通知用户）

### 📈 Marketing Agent (`src/marketing-agent.ts`)
- 数据收集与优化任务生成
- **集成 AiToEarn MCP**：跨12平台内容发布与变现
- 用户反馈 → 需求优化建议 → 回传 Phase 0

---

## 五、引擎支持

| 引擎 | 后端模型 | 上下文 | 使用方式 |
|------|----------|--------|----------|
| **Codex CLI** | DeepSeek V4 Pro | 无状态（需显式传递） | `npm run harness:codex` |
| Claude SDK | Claude Opus 4.5 | 有状态 | `npm run harness` |

**引擎选择逻辑**（`src/utils/agent-executor.ts`）：
- 环境变量 `HARNESS_ENGINE=codex` → Codex CLI
- 默认 → Claude SDK
- 检测 `CONTEXT_RESET=true` → 启用上下文重置模式

---

## 六、编码规范（Karpathy + 蕾姆）

### 核心原则
1. **Think Before Coding**：先明确假设，不确定就问
2. **Simplicity First**：只实现要求的功能，200行能写完不要500行
3. **Surgical Changes**：只改必须改的代码，不"顺便"重构
4. **Goal-Driven**：TDD 先行（RED→GREEN→REFACTOR）

### 自动化 Loop 规则
1. 生成代码 → 自动验证（test/lint/build）
2. 失败 → 自动修复 → 重新验证
3. 连续循环直到通过，无人工干预
4. 输出 `✅ 自动化完成`

### 禁止行为
- ❌ 一次生成后停止
- ❌ 忽略验证失败
- ❌ 跳过迭代修复
- ❌ 在循环中询问确认
- ❌ 硬编码 secrets/API keys
- ❌ 引擎/模型硬编码

---

## 七、命令

```bash
# 主调度
npm run harness -- "需求描述"              # Claude 引擎
npm run harness:codex -- "需求描述"         # Codex 引擎 (DeepSeek V4 Pro)

# 质量保证
npm run typecheck                          # TypeScript 类型检查
npm test                                   # 运行测试 (95 tests)
npm run test:run                           # 单次运行
npm run test:coverage                      # 覆盖率报告

# 调试
npm run harness:debug -- "需求描述"
```

---

## 八、目录结构

```
Snake-of-Mercury/
├── AGENTS.md                   # ← 你在这里
├── src/
│   ├── harness-scheduler.ts    # 主调度器（Phase 0→1→2→3→0）
│   ├── ceo-agent.ts            # CEO 多项目管理
│   ├── planner-agent.ts        # 需求拆解 (Anthropic 三角①)
│   ├── generator-agent.ts      # Sprint 实现 (Anthropic 三角②)
│   ├── evaluator-agent.ts      # 4维评分 (Anthropic 三角③)
│   ├── devops-agent.ts         # 运维监控
│   ├── marketing-agent.ts      # 数据 + AiToEarn 变现
│   ├── event-bus.ts            # Agent 通信中枢
│   ├── ralph-loop.ts           # Ralph Wiggum 自主循环
│   ├── phase0-questionnaire.ts # 苏格拉底追问
│   ├── phase0-debate-engine.ts # 多Agent辩论
│   ├── phase3-delivery.ts      # 自动部署
│   ├── convergence-detector.ts # 收敛检测
│   ├── rollback-manager.ts     # Git回滚
│   ├── state-machine.ts        # 状态机
│   ├── types.ts                # 核心类型定义
│   ├── utils/
│   │   ├── agent-executor.ts   # 引擎抽象层
│   │   ├── codex-executor.ts   # Codex CLI 适配器
│   │   └── sdk-executor.ts     # Claude SDK 适配器
│   └── __tests__/              # 测试（95 tests）
├── archive/                    # 历史归档
│   ├── debates/                # 旧辩论日志
│   └── specs/                  # 旧规格文档
├── specs/                      # 产品规格
├── docs/                       # 文档
├── skills/                     # Codex Skills
├── agents/                     # Agent 定义
└── config/                     # 配置
```

---

## 九、技术栈

| 技术 | 用途 |
|------|------|
| TypeScript (strict) | 主语言 |
| Vitest | 测试框架 |
| Zod | 运行时验证 |
| @anthropic-ai/sdk | Claude API |
| Codex CLI | DeepSeek V4 Pro 调用 |
| EventBus (JSONL) | Agent 通信 |
| AiToEarn MCP | 跨平台内容变现 |

---

## 十、Git 工作流

```bash
# 推送（GitHub Token: 已配置）
git add . && git commit -m "feat: description" && git push

# 禁止行为
# - 不要创建新分支（统一 main）
# - 不要 squash merge
# - 不要 rebase 已推送的提交
```

---

> 版本: v2.0 | 更新: 2026-05-11
> 遵循 Anthropic Managed Agents 架构 + Karpathy 编码准则
