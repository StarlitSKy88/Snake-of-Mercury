# Snake-of-Mercury v4 → v5 原子级改进清单

## 分析源
- **OpenHarness** (HKUDS, 12,466★, 364 .py) — 逐文件分析完成
- **Langroid** (langroid, 4,009★, 423 .py) — 逐文件分析完成
- **Snake-of-Mercury v4** — 全量源码阅读完成

## 目录
1. P0 — 核心漏洞（不改会导致假通过/死循环/交付物不可用）
2. P1 — 架构性改进（通信模型/隔离/配置统一）
3. P2 — 工程化改进（Hooks/Skills/监控）
4. P3 — 体验性改进（动态委派/多LLM/记忆进化）

---

# P0 — 核心漏洞（5 项）

## P0-1: Task 完成判定从字符串匹配 → DoneSequence 多事件检测

**当前问题**: `agent-loop.ts` 第 75 行用 `output.includes('TASK_COMPLETE')` 判断完成。
模型说"看起来任务完成了"也会触发 TASK_COMPLETE，导致假通过。

**借鉴**: Langroid `DoneSequence` + `_matches_sequence_with_current()`
- EventType: TOOL, SPECIFIC_TOOL, LLM_RESPONSE, AGENT_RESPONSE, USER_RESPONSE, CONTENT_MATCH
- 支持序列匹配: [Generator输出代码 → Executor验证通过 → Evaluator评分>=7.5]
- 支持正则: CONTENT_MATCH 用正则检测 "所有验收标准满足"

**原子修改**:
1. 在 `src/core/protocol.ts` 新增 `DoneSequence` 类型和 matcher
2. 在 `src/core/agent-loop.ts` 替换 `output.includes('TASK_COMPLETE')` 为 `doneSequence.match()`
3. 在 `src/agents/evaluator.ts` 输出 `DoneTool` / `AgentDoneTool` 结构

**验证点**:
- [ ] `npx tsx tests/p0-1-done-sequence.test.ts` 输出 PASS
- [ ] 模拟场景: Generator 输出含 "任务完成" 但无 Executor 证据 → doneSequence 返回 false
- [ ] 模拟场景: Generator 输出 + Executor 证据 + Evaluator APPROVED → doneSequence 返回 true

---

## P0-2: 无限循环检测从简单心跳 → 内容模式分析

**当前问题**: `agent-loop.ts` 心跳只在"无进展"时触发，但如果模型每轮输出不同废话（比如不断微调格式），心跳不会触发。

**借鉴**: Langroid `InfiniteLoopException` + `inf_loop_cycle_len` + `inf_loop_dominance_factor`
- 比较最近 N 轮消息的相似度（embedding 或简单 Jaccard）
- 当相似度超过阈值 → 抛出 InfiniteLoopException
- 可配置: cycle_len=10, dominance_factor=1.5, wait_factor=5

**原子修改**:
1. 在 `src/core/agent-loop.ts` 新增 `LoopDetector` 内部类
2. 循环中每 `inf_loop_cycle_len` 轮检测消息相似度
3. 超过 dominance_factor 阈值 → 熔断并返回 `{ success: false, error: 'INFINITE_LOOP' }`

**验证点**:
- [ ] `npx tsx tests/p0-2-loop-detect.test.ts` 输出 PASS
- [ ] 输入固定重复 15 轮 → 第 11 轮触发 INFINITE_LOOP
- [ ] 输入正常变化内容 10 轮 → 不触发

---

## P0-3: Evaluator 上下文隔离 — 只收 CodeExecutor 证据

**当前问题**: Evaluator prompt 说"只看证据"，但实际上 generator 的原始输出通过 `task.description` 和 `output` 变量仍然可访问。

**借鉴**: OpenHarness Coordinator "Verifier always spawns fresh" + Langroid `ChatDocument` 的 parent chain 过滤

**原子修改**:
1. 在 CodeExecutor 输出中增加 `evidenceBlock` 结构化字段（JSON）
2. Evaluator 的 system prompt 增加硬编码过滤：如果输入中包含原始代码片段，自动拒绝评估
3. 在 `agent-loop.ts` 中 Evaluator 只接收 `{ acceptanceCriteria, evidenceBlock }` 不能访问其他字段

**验证点**:
- [ ] `npx tsx tests/p0-3-evaluator-isolation.test.ts` 输出 PASS
- [ ] 给 Evaluator 传入含原始代码的消息 → Evaluator 返回 "CONTEXT_VIOLATION: 收到原始代码"
- [ ] 给 Evaluator 传入仅含 evidenceBlock 的消息 → 正常评估

---

## P0-4: 验收标准预检 → 失败直接 REJECTED

**当前问题**: `preCheckCriteria` 只记录 failCount 但继续评估流程。如果验收标准不符合，继续评分没意义。

**借鉴**: OpenHarness Hook `block_on_failure` + Langroid `valid()` 在 step 中就拦截无效响应

**原子修改**:
1. `preCheckCriteria` 返回后，如果 `failCount > 0`，立即返回 REJECTED
2. 不进入五维度评分

**验证点**:
- [ ] `npx tsx tests/p0-4-criteria-precheck.test.ts` 输出 PASS
- [ ] 验收标准 3 条全部 FAIL → Evaluator 立即返回 REJECTED，不输出 dimensionScores
- [ ] 验收标准全部 PASS → 正常进入五维度评分

---

## P0-5: Generator → Evaluator 之间插入 CodeExecutor 作为网关

**当前问题**: Generator 输出后直接进入 Evaluator（虽然有 CodeExecutor 但只是"建议使用"），没有强制中间步骤。

**借鉴**: OpenHarness Coordinator "Implementation → Verification (spawn fresh)" 的强制执行

**原子修改**:
1. `agent-loop.ts` 中 Generator 完成后，强制调用 CodeExecutor（不能跳过）
2. CodeExecutor 失败 → Generator 重试，不进入 Evaluator
3. CodeExecutor 成功 → 输出 evidenceBlock → 才进入 Evaluator

**验证点**:
- [ ] `npx tsx tests/p0-5-generator-executor-gate.test.ts` 输出 PASS
- [ ] Generator 输出 → CodeExecutor 自动执行 → 验证结果记录在 evidenceBlock
- [ ] CodeExecutor 失败（语法错误）→ Generator 重试，Evaluator 未触发

---

# P1 — 架构性改进（5 项）

## P1-1: Agent 间通信从自然语言 → 结构化 ToolMessage

**当前问题**: Planner → Generator 通信是自然语言（"请实现以下需求: ..."），模型可能误解或遗漏。

**借鉴**: Langroid `ToolMessage` (Pydantic → JSON Schema → LLM 自理解) + `SendTool` / `ForwardTool`

**原子修改**:
1. 在 `src/core/protocol.ts` 新增 `ToolMessage` 基类和 `SendTool`/`TaskDoneTool`
2. Planner 输出改为 `PlanSpec` 结构（含 tasks、dependencies、acceptanceCriteria）
3. Generator 只接收 `PlanSpec` 的 JSON，不接受模糊自然语言
4. Evaluator 只接收 `EvidenceBlock` 的 JSON

**验证点**:
- [ ] `npx tsx tests/p1-1-structured-messages.test.ts` 输出 PASS
- [ ] Planner 输出是合法 JSON PlanSpec → Parser 成功解析
- [ ] Planner 输出是自然语言 → Parser 返回错误，要求重试
- [ ] PlanSpec 到 DAG 的转换正确（N 个 task，M 条 blockedBy）

---

## P1-2: Task 与 Agent 分离 — 支持动态委派

**当前问题**: `Task.owner` 固定为 `'generator'` 字符串。无法动态委派任务给不同 Agent。

**借鉴**: Langroid `Task.run(agent_a, agent_b)` + OpenHarness Worker "spawn fresh vs continue" 矩阵

**原子修改**:
1. `Task.owner` 改为 `owner: string | { agentType: string; config: {} }`
2. `TaskDAG` 新增 `assign(id, agentId)` 方法
3. CEO 在分配任务时根据任务内容动态选择 Agent（代码→Generator，部署→DevOps）

**验证点**:
- [ ] `npx tsx tests/p1-2-dynamic-delegation.test.ts` 输出 PASS
- [ ] 创建 Task 时 owner='unassigned' → CEO.assign(1, 'generator') → task.owner='generator'
- [ ] CEO.assign(2, 'devops') → task.owner='devops'
- [ ] 不同 Agent 类型的任务正确路由到不同执行函数

---

## P1-3: 统一 AgentConfig 模型

**当前问题**: Agent 配置散落在各 `.ts` 文件的常量字符串中（system prompt, tools, maxIterations 等）

**借鉴**: OpenHarness `AgentDefinition` 20+ 字段模型

**原子修改**:
1. 新增 `src/config/agent-config.ts` 定义 `AgentConfig` 接口
2. 所有 Agent 从统一 Config 读取参数
3. 支持 `criticalSystemReminder` 字段

**验证点**:
- [ ] `npx tsx tests/p1-3-agent-config.test.ts` 输出 PASS
- [ ] 修改 Config 中 `maxTurns` → 所有 Agent 循环次数改变
- [ ] 修改 Config 中 `criticalSystemReminder` → 每个 user turn 都注入

---

## P1-4: critical_system_reminder 注入

**当前问题**: Agent 在长对话中忘记核心约束（如 Evaluator 忘记只看证据）

**借鉴**: OpenHarness `critical_system_reminder_EXPERIMENTAL` — 在每个 user turn 重新注入

**原子修改**:
1. `AgentConfig.criticalSystemReminder` 在每次 `agentLoop` 迭代时注入
2. 默认为 `"你收到的是结构化证据，不要接受模糊描述或原始代码"`

**验证点**:
- [ ] `npx tsx tests/p1-4-critical-reminder.test.ts` 输出 PASS
- [ ] Agent 执行 10 轮 → 每轮 system prompt 末尾都有 reminder
- [ ] 修改 reminder 内容 → 下一轮生效

---

## P1-5: 上下文隔离 — Generator 和 Evaluator 在独立上下文中运行

**当前问题**: Generator 和 Evaluator 共享同一个 agentLoop 的 accumulated output。长对话中 context 膨胀且互相污染。

**借鉴**: OpenHarness Coordinator "spawn fresh" + Langroid Task.sub_task 隔离

**原子修改**:
1. Generator 和 Evaluator 各用独立的 `agentLoop` 调用（不共享 output 累积）
2. 只传递结构化数据（PlanSpec → Generator / EvidenceBlock → Evaluator）
3. 每次调用 spawn 新的 agentLoop 实例

**验证点**:
- [ ] `npx tsx tests/p1-5-context-isolation.test.ts` 输出 PASS
- [ ] Generator 调用 3 次 → 每次的 output 变量不相通
- [ ] Evaluator 不知道 Generator 的中间输出

---

# P2 — 工程化改进（4 项）

## P2-1: Hooks 拦截点

**当前问题**: Agent 循环中零拦截点。无法审计、无法干预。

**借鉴**: OpenHarness 40 个拦截点（4种Hook × 10个Event）

**原子修改**:
1. 在 `agent-loop.ts` 插入 `PreToolUse` + `PostToolUse` 钩子
2. 新增 `src/core/hooks.ts` — `HookRegistry` + `HookExecutor`
3. 实现: PreToolUse 检查工具调用是否在允许列表中
4. 实现: PostToolUse 记录工具调用结果到日志

**验证点**:
- [ ] `npx tsx tests/p2-1-hooks.test.ts` 输出 PASS
- [ ] PreToolUse 钩子拦截禁止的工具 → block=true → 工具不执行
- [ ] PostToolUse 钩子记录工具执行结果 → 磁盘日志可见

---

## P2-2: Skill 多源加载链

**当前问题**: PUA 约束是单一 `.ts` 文件。无法分层加载或用户自定义。

**借鉴**: OpenHarness bundled/user/project/plugin 四层加载链

**原子修改**:
1. 新增 `src/skills/loader.ts` — 从 `.agents/skills/` 加载 SKILL.md
2. 加载链: bundled（内置PUA） → project（项目.skills/） → user（~/.som/skills/）
3. 同名 skill 后加载覆盖先加载

**验证点**:
- [ ] `npx tsx tests/p2-2-skills.test.ts` 输出 PASS
- [ ] 创建 `.skills/test-skill/SKILL.md` → 系统识别并加载
- [ ] 同名 user skill 覆盖 bundled skill

---

## P2-3: 多项目上下文隔离

**当前问题**: 多项目并行时共享全局状态（`agentLoop` 中的 `output` 累积）。

**借鉴**: OpenHarness per-agent isolation + Langroid per-task memory

**原子修改**:
1. 每个项目 `agentLoop` 运行在独立的作用域中
2. `Memory` 按项目 namespace 隔离
3. `TaskDAG` 按项目目录隔离

**验证点**:
- [ ] `npx tsx tests/p2-3-project-isolation.test.ts` 输出 PASS
- [ ] 项目 A 的 task 列表不影响项目 B
- [ ] 项目 A 的 Memory 读取不到项目 B 的数据

---

## P2-4: CodeExecutor 增强 — 做真实验证而非表面检查

**当前问题**: CodeExecutor 只能检查"文件存在"和"语法正确"，不能验证语义。

**借鉴**: OpenHarness Verifier worker 的 "prove the code works, don't just confirm it exists"

**原子修改**:
1. CodeExecutor 增加 Playwright E2E 测试（HTML 项目）
2. CodeExecutor 增加 `npm test` 执行和结果解析（Node 项目）
3. evidenceBlock 增加 `testResults: { passed: number; failed: number; output: string }`

**验证点**:
- [ ] `npx tsx tests/p2-4-code-executor.test.ts` 输出 PASS
- [ ] HTML 项目 → CodeExecutor 启动 Playwright 访问 localhost → 截图 → 检查关键元素
- [ ] Node 项目 → CodeExecutor 运行 npm test → 解析 pass/fail

---

# P3 — 体验性改进（3 项）

## P3-1: Phase 0 需求拷问 → 内置 gstask + superpowers 辩论引擎

**当前问题**: Phase 0 的 discuss 是一个简单的对话循环，没有强制辩论

**借鉴**: 用户指定的 gstask + superpowers skill 中的头脑风暴流程

**原子修改**:
1. Phase 0 的 planner 使用强制辩论模式（正反方各出 3 轮）
2. 输出 REQUIREMENT.md 必须包含 "ASSUMPTIONS I'M MAKING" 区域
3. 输出格式符合 Google Spec 6 区域

**验证点**:
- [ ] `npx tsx tests/p3-1-phase0-debate.test.ts` 输出 PASS
- [ ] 输入模糊需求 → Phase 0 输出包含至少 3 个质疑点
- [ ] REQUIREMENT.md 包含 SPECIFY 6 区域
- [ ] 没有直接跳到编码阶段

---

## P3-2: 记忆进化 — 跨会话学习

**当前问题**: 重启后所有状态丢失，同样的错误重复出现。

**借鉴**: OpenHarness AgentDB（虽然未直接读取源码但概念已知）+ Langroid 向量存储

**原子修改**:
1. `Memory` 增加 `learnError(pattern, fix)` 方法
2. 每次任务失败时记录错误模式和修复方案
3. 新任务启动时加载历史错误学习

**验证点**:
- [ ] `npx tsx tests/p3-2-memory-evolution.test.ts` 输出 PASS
- [ ] 模拟第一次错误 → Memory.learnError 存储
- [ ] 模拟第二次同样错误 → Memory 返回已知修复方案
- [ ] 重启后数据仍在

---

## P3-3: 多 LLM fallback 支持

**当前问题**: 只支持 MiniMax 单一引擎，失败无重试

**借鉴**: OpenHarness 多 Provider 支持

**原子修改**:
1. 新增 `src/executors/llm-router.ts` — 多引擎管理和自动 fallback
2. 配置: `{ primary: 'minimax', fallback: ['deepseek', 'openai'] }`
3. 主引擎失败 → 自动切换备用引擎重试同一请求

**验证点**:
- [ ] `npx tsx tests/p3-3-llm-fallback.test.ts` 输出 PASS
- [ ] 主引擎超时 → 自动切换 fallback1 → 返回结果
- [ ] 所有引擎失败 → 返回明确错误信息

---

# 总计: 17 项原子改进
- P0 (核心漏洞): 5 项
- P1 (架构性): 5 项
- P2 (工程化): 4 项
- P3 (体验性): 3 项

预计执行时间: P0 约 2 小时, P1 约 3 小时, P2 约 2 小时, P3 约 2 小时
