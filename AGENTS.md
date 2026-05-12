# Snake of Mercury — AI 创业工厂 v2.0

> GitHub: https://github.com/StarlitSKy88/Snake-of-Mercury
> 引擎: MiniMax M2.7 (HTTP 直连) | Anthropic SDK | OpenAI 兼容 | Ollama
> 架构: Anthropic Harness 三角 + Ralph Wiggum 自主循环
> 定位: 输入模糊想法 → 全自动 7×24 开发迭代 → 部署上线 → 数据驱动优化

---

## 一、当前架构状态（2026-05-12 审计+合并）

✅ **两条路径已合并**。
> snake-of-mercury@1.0.0 harness
> tsx src/harness-scheduler.ts


Snake of Mercury - Unified Autopilot v2.1

用法:
  npm run harness -- "你的产品需求"

模式:
  HARNESS_MODE=pipeline  Pipeline 模式 (默认，推荐)
  HARNESS_MODE=legacy    旧版硬编码模式

引擎:
  HARNESS_ENGINE=minimax   MiniMax M2.7 (默认)
  HARNESS_ENGINE=claude    Anthropic Claude
  HARNESS_ENGINE=openai    OpenAI 兼容 API
  HARNESS_ENGINE=ollama    本地 Ollama
  HARNESS_ENGINE=auto      自动选择
     默认走 Pipeline 路径（原路径 B），旧路径通过  保留。

### 统一后的 Pipeline



**新增能力**：
- SwarmCoordinator 管理全部 8 个 Agent 的生命周期（心跳、注册、任务追踪）
- DevOps Agent 在 Phase 3 部署成功后自动注册端点并启动监控
- Marketing Agent 在部署后自动发布推广内容到 12 平台 + 启动数据采集
- Ralph Loop 内嵌于 Generator/Evaluator（每 Sprint 最多重试 3 次）
- 外循环由 Convergence 中间件控制（最多 5 次全局迭代）

### PipelineContext 关键字段

| 字段 | 写入者 | 读取者 | 说明 |
|------|--------|--------|------|
|  | Phase0 | Planner | 辩论收敛后的需求 |
|  | Planner | Generator, Evaluator | 产品规格+Sprint计划 |
|  | GenEval | Convergence | Sprint执行结果 |
|  | Delivery | DevOps, Marketing | 部署URL |
|  | Convergence | Pipeline.run() | 是否停止外循环 |
|  | DevOps | Pipeline.shutdown() | 清理监控 |
|  | Marketing | Pipeline.shutdown() | 清理采集 |

## 二、Agent 通信协议

### EventBus（Pub/Sub + JSONL 持久化）

所有 Agent 通过 `src/event-bus.ts` 通信：

- **发布/订阅**：Agent 发布事件，其他 Agent 订阅感兴趣的事件类型
- **JSONL 持久化**：所有事件 append-only 写入 `event-log.jsonl`，可回溯审计
- **松耦合**：Agent 互不感知，通过事件类型解耦

**当前实际使用范围**: EventBus 仅用于 CEO 通知（sprint 通过/失败/回滚/错误），核心三角（Planner→Generator→Evaluator）走直接函数调用。

**关键事件类型**：

| 事件 | 发布者 | 订阅者 | 含义 |
|------|--------|--------|------|
| `sprint:passed` | Evaluator | CEO | Sprint 通过 |
| `sprint:rejected` | Evaluator | CEO, Generator | Sprint 未通过 |
| `sprint:rollback` | RollbackManager | CEO | 回滚执行 |
| `devops:escalated` | DevOps | CEO | 故障升级 |
| `marketing:optimization_task` | Marketing | CEO | 优化任务 |
| `system:error` | 任意 | CEO | 系统错误 |

---

## 三、Ralph Wiggum Loop

`src/ralph-loop.ts` 实现任务级自主循环：

- **当前用途**: 包装 Phase 2 的 Sprint 执行（Generator → Evaluator → 重试）
- **熔断**: 单任务最大迭代 50 次
- **无进展检测**: 连续 10 次无变动则停止并报告
- **模式**: `internal`（内存调度）/ `ralphy`（外部 CLI 调度）

---

## 四、Agent 职责

### 👑 CEO Agent (`src/ceo-agent.ts`)
- 多项目管理（创建、状态追踪、进度汇报）
- 审批断点管理（contract / deploy / pivot / critical_error）
- 跨会话记忆（AgentMemory）
- 蜂群调度（SwarmCoordinator — 已构造，待集成到主循环）

### 📋 Planner Agent (`src/planner-agent.ts`)
- 接收 Phase 0 收敛需求 → 输出 ProductSpec（含 Sprint Plan）
- MoSCoW 优先级排序
- 自动拆分为 Sprint Contract 列表

### 💻 Generator Agent (`src/generator-agent.ts`)
- 接收 Sprint Contract → 实现代码
- 自动检测项目类型并选择最佳技术栈
- 自评输出质量（8/10 以下自动重试）

### 🔍 Evaluator Agent (`src/evaluator-agent.ts`)
- 4 维硬阈值评分：
  - 产品深度 (35%) / 用户体验 (30%) / 代码质量 (20%) / 安全合规 (15%)
- 总分 < 8.0 → REJECTED + 具体修复建议

### 🔧 DevOps Agent (`src/devops-agent.ts`)
- 7×24 健康检查循环
- 自动修复（重启 PM2、清理磁盘、回滚部署）
- 故障升级（无法自动修复 → CEO → 通知用户）
- **状态**: 已实现，待集成到主循环

### 📈 Marketing Agent (`src/marketing-agent.ts`)
- 数据收集与优化任务生成
- **集成 AiToEarn MCP**：跨 12 平台内容发布与变现
- 用户反馈 → 需求优化建议 → 回传 Phase 0
- **状态**: 已实现，待集成到主循环

---

## 五、引擎支持

| 引擎 | 后端模型 | 配置 |
|------|----------|------|
| **minimax** | MiniMax M2.7 | `MINIMAX_API_KEY` |
| **claude** | Anthropic SDK | `ANTHROPIC_API_KEY` |
| **openai** | OpenAI 兼容 API | `OPENAI_API_KEY` + `OPENAI_BASE_URL` |
| **ollama** | 本地模型 | `http://localhost:11434` |
| **auto** | 自动选择最佳可用 | 检测环境变量 |

**引擎选择**（`src/utils/agent-executor.ts`）：
- `HARNESS_ENGINE` 环境变量指定引擎
- 默认 `minimax`
- 所有引擎均通过纯 HTTP/SDK 调用，**不依赖任何外部 CLI**

---

## 六、编码规范

### Karpathy 编码准则
1. **Think Before Coding**：先明确假设，不确定就问
2. **Simplicity First**：只实现要求的功能，200 行能写完不要 500 行
3. **Surgical Changes**：只改必须改的代码，不"顺便"重构
4. **Goal-Driven**：TDD 先行

### 自动化 Loop 规则
1. 生成代码 → 自动验证（test/lint/build）
2. 失败 → 自动修复 → 重新验证
3. 连续循环直到通过，无人工干预

### 禁止行为
- ❌ 一次生成后停止 / 忽略验证失败 / 跳过迭代修复
- ❌ 在循环中询问确认
- ❌ 硬编码 secrets/API keys
- ❌ 引擎/模型硬编码

---

## 七、命令

```bash
# 主调度
npm run harness -- "需求描述"              # 路径 A（硬编码）
npm run pipeline -- "需求描述"             # 路径 B（中间件管道）

# 质量保证
npm run typecheck                          # tsc --noEmit
npm test                                   # vitest
npm run test:run                           # vitest run
npm run test:coverage                      # vitest run --coverage
```

---

## 八、最近清理记录（2026-05-12）

已移除的死代码（零运行时影响，全部验证通过）：
- `src/phase0-questionnaire.ts` — 467 行，无人引用
- `src/federation/federation.ts` — 无人引用
- `src/hub/` (4 文件) — Hub JSON-RPC 架构，仅被已移除的 debate-engine-hub 使用
- `src/agent/process-agent.ts` — 硬编码 `claude` CLI，不兼容当前 MiniMax 引擎
- `src/protocols/messages.ts` — JSON-RPC 2.0 协议，仅 Hub 使用

---

## 九、技术栈

| 技术 | 用途 |
|------|------|
| TypeScript (strict) | 主语言 |
| Vitest | 测试框架 |
| Zod | 运行时验证 |
| @anthropic-ai/sdk | Claude API |
| MiniMax HTTP API | 默认引擎 |
| EventBus (JSONL) | Agent 通知 |
| AgentMemory | 跨会话持久记忆 |

---

> 版本: v2.1 | 更新: 2026-05-12 (架构审计 + 死代码清理)

---

## 十一、Anthropic 四类 Agent 失败模式防御表 (Article 1.8)

| # | 失败模式 | 原文描述 | 我们的防御机制 | 对应代码 |
|---|---------|---------|--------------|---------|
| 1 | **一次性做太多** (One-shot) | Agent 试图在一个 context window 完成整个 App | Feature List (`featureList.must/should/could`) + Sprint 拆分 | `planner-agent.ts` → `ProductSpec.featureList` |
| 2 | **过早宣布完成** (Premature victory) | Agent 看到有进展就声称完成了 | 结构化自验 (`selfVerify`) + Evaluator 硬阈值 (8.0) | `generator-agent.ts::selfVerify` + `evaluator-agent.ts::PASS_THRESHOLD` |
| 3 | **留下脏状态** (Dirty state) | 代码有 bug、未文档化、不可运行 | Clean State 协议: 每个 Sprint 通过后跑 `npm test` | `builtins.ts` GenEval Middleware → Clean state check |
| 4 | **不知道如何启动** (No run instructions) | 新会话不知道如何运行项目 | `init.sh` (一行启动) + `progress.json` (进度日记) | `initializer.ts::generateInitSh` |

### 防御机制对应关系

```
Agent 失败 → 防御层
─────────────────────
One-shot  → Feature List → Sprint 拆分 (Planner)
           → 逐个 Sprint 顺序执行 (GenEval)

Premature → selfVerify (Generator 自检)
victory   → evaluateEachCriterion (Evaluator 逐条验证)
           → PASS_THRESHOLD=8.0 + MIN_DIMENSION=7.0

Dirty     → Clean state: npm test 通过才进下一 Sprint
state     → progress.json 记录每步结果
           → Pipeline 状态持久化 (.pipeline-state.json)

No run    → init.sh (自动检测技术栈生成启动命令)
instructions → progress.json (记录所有 Sprint 历史)
```
