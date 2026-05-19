# 🐍 Snake of Mercury — AI 创业工厂 v5

## 项目概述

多 Agent 协作的 AI 创业工厂。用户输入模糊想法 → Phase 0 需求辩论 → CEO Agent 组建 Agent Team → Planner→Generator→Evaluator Harness 三角循环 → 自动部署上线。

## 架构

```
Phase 0: 需求讨论 → CEO → Planner → Generator → Evaluator → DevOps → Marketing
         ↑                ↓         ↓           ↓            ↓         ↓
    discuss.html      ProtocolBus (磁盘持久化消息总线)
                      AgentMemory (跨会话记忆 + 反思日志)
                      Gate (审批自动化)
```

## Agent 角色

| Agent | 文件 | 职责 |
|-------|------|------|
| Phase0 Discuss | `src/agents/phase0-discuss.ts` | 需求拷问: 市场调研 → 辩论正反方 → REQUIREMENT.md |
| CEO | `src/agents/ceo.ts` | 项目管理: 创建项目/审批路由/状态汇总 |
| Planner | `src/agents/planner.ts` | SPECIFY→PLAN→TASKS: 假设+6区Spec+TaskDAG |
| Generator | `src/agents/generator.ts` | TDD循环: RED→GREEN→REFACTOR + CodeExecutor |
| Evaluator | `src/agents/evaluator.ts` | 只看证据: 上下文隔离+假成功+RedFlags |
| DevOps | `src/agents/devops.ts` | 部署检查: 失败任务拦截+配置生成 |
| Marketing | `src/agents/marketing.ts` | SEO优化+用户反馈收集 |

## 核心模块

| 模块 | 文件 | 功能 |
|------|------|------|
| Agent Loop | `src/core/agent-loop.ts` | Ralph Wiggum 循环 + DoneSequence 多事件检测 |
| Task DAG | `src/core/task-dag.ts` | 任务依赖图 + 建议路由 |
| Protocol Bus | `src/core/protocol.ts` | Agent 间通信 + 用户审批管道 |
| Agent Memory | `src/core/memory.ts` | 跨会话记忆 + ReflectionLog 闭环反思 |
| Gate | `src/core/gate.ts` | 影响级别路由 (trivial→auto, major→approval, critical→escalate) |
| Evidence Guard | `src/core/evidence-guard.ts` | 证据上下文隔离验证 |
| Done Sequence | `src/core/done-sequence.ts` | 多事件完成检测 + 假成功模式 |
| Hooks | `src/core/hooks.ts` | PreToolUse/PostToolUse 拦截 (借鉴 OpenHarness) |
| PUA | `src/constraints/pua.ts` | 3红线 + 7种Rationalizations + RedFlags + TDD强制 |

## LLM 执行器

| 执行器 | 文件 | 用途 |
|--------|------|------|
| MiniMax | `src/executors/minimax.ts` | 主引擎 (M2.7) |
| Ollama 兼容 | `src/utils/ollama-executor.ts` | 多Provider支持 (DeepSeek/Grok/Gemini/OpenAI) |
| LLM Router | `src/utils/llm-router.ts` | 自动故障转移 + 成本路由 |
| Code Executor | `src/executors/code-executor.ts` | 代码验证沙箱 |

## 命令

```bash
npm run discuss     # 启动 Phase 0 对话服务器 (port 3100)
npm run harness     # 启动主 Pipeline (自动读取 REQUIREMENT.md)
npm run v3          # 同上 (旧名，保留兼容)
npm run resume      # 恢复中断的项目
npm run test        # 运行所有测试
npm run typecheck   # TypeScript 类型检查
```

## 测试

| 测试文件 | 测试数 | 覆盖 |
|----------|--------|------|
| `src/core/task-dag.test.ts` | 15 | TaskDAG CRUD + 依赖 + 路由 |
| `src/core/protocol.test.ts` | 9 | 消息总线 + 审批管道 |
| `src/core/memory.test.ts` | 15 | 记忆 CRUD + 搜索 + 反思日志 |
| `src/core/gate.test.ts` | 11 | 审批路由 + 影响级别 |
| `src/executors/code-executor.test.ts` | 13 | 代码验证 + 测试运行 |
| `src/agents/agents.test.ts` | 17 | Agent 集成测试 (全7个Agent) |
| **总计** | **80** | |

## 键设计决策

1. **Anthropic Harness 三角**: Planner→Generator→Evaluator 是系统核心循环
2. **纯 API 驱动**: 零 CLI 依赖，完全通过 HTTP API 调用 LLM
3. **ProtocolBus 磁盘持久化**: Agent 间通信持久化到磁盘，崩溃可恢复
4. **TDD 强制**: Generator 必须走 RED→GREEN→REFACTOR，否则 Evaluator 拒绝
5. **上下文隔离**: Evaluator 只看 CodeExecutor 证据，不看原始代码
6. **Agent 间通信方式**: 同步函数调用链 (Planner→Generator→Evaluator 在同一个 scheduler 进程中)，审批类通信走 ProtocolBus
