# 🐍 Snake-of-Mercury 原子任务清单

> 总缺口 19 项 → 拆分为 42 个原子任务
> 每个任务含 ≥3 个独立验证点

---

## Phase 1: CEO 主循环补齐 (7 tasks)

### T1.1 — CEO.run 集成 Phase0 discuss（自动需求讨论）
**依赖**: 无
**文件**: `src/agents/ceo.ts`
**改动**: 在 `run()` 开头增加：如果 REQUIREMENT.md 不存在，先调用 `discuss()`
```
CEO.run() {
  if (!exists(REQUIREMENT.md)) {
    await discuss(requirement, projectDir, engine)  // 自动生成
  }
  // 现有逻辑...
}
```
**验证点**:
- [ ] 无 REQUIREMENT.md 时，CEO.run 自动触发 Phase0 讨论（不报错）
- [ ] 生成的 REQUIREMENT.md 包含市场调研 + 多方案对比 + MVP 范围
- [ ] 已有 REQUIREMENT.md 时，跳过 Phase0 直接进入 Planner
- [ ] E2E 测试: `CEO.run('模糊需求', dir)` → 自动完成全流程

### T1.2 — CEO.run 集成 DevOps deploy（Phase 3 自动部署）
**依赖**: T1.1
**文件**: `src/agents/ceo.ts`
**改动**: 在 Ralph Loop 完成后调用 `deploy()`，将部署报告写入 `.tasks/DEPLOY.md`
```
// Phase 3: 部署
const deployResult = await deploy(projectDir, dag, memory, engine)
saveDeployReport(projectDir, deployResult)
```
**验证点**:
- [ ] 全部任务通过后，自动触发 DevOps 部署检查
- [ ] 存在失败任务时，跳过部署并记录原因
- [ ] 部署报告持久化到 `.tasks/DEPLOY.md`
- [ ] E2E: 完整项目跑完后 DEPLOY.md 存在且内容正确

### T1.3 — CEO.run 集成 Marketing（Phase 4 SEO/反馈）
**依赖**: T1.2
**文件**: `src/agents/ceo.ts`
**改动**: 部署成功后调用 `optimizeMarketing()`，结果写入 `.tasks/SEO.md`
```
// Phase 4: 营销优化
const seoResult = await optimizeMarketing(projectDir, memory, engine)
saveSEODoc(projectDir, seoResult)
```
**验证点**:
- [ ] 部署成功后自动触发 SEO 优化
- [ ] SEO 建议写入 `.tasks/SEO.md`
- [ ] marketing.ts 返回结构包含 title/description 字段
- [ ] E2E: 全流程跑完确认 SEO.md 存在且非空

### T1.4 — 反馈闭环: collectFeedbackToRequirements → 重新进入 Pipeline
**依赖**: T1.3
**文件**: `src/agents/ceo.ts`
**改动**: 新增 `handleFeedback(project, feedback)` 方法
```
handleFeedback(project, feedback) {
  const reqs = await collectFeedbackToRequirements(feedback, memory, engine)
  // 将新需求写入 TaskDAG
  for (const req of reqs) {
    dag.create(req, { impactLevel: 1 })
  }
  // 重新进入 Ralph Loop
  await this.runPhase2(project)
}
```
**验证点**:
- [ ] 用户提交反馈后自动生成新 Task
- [ ] 新 Task 进入 Ralph Loop 执行
- [ ] 反馈来源记录在 Memory 中（namespace='feedback'）
- [ ] 测试: 模拟反馈 "加载太慢" → 新 Task "性能优化" 进入 DAG

### T1.5 — Planner 生成计划后通过 ProtocolBus 发送用户确认
**依赖**: T1.1
**文件**: `src/agents/ceo.ts`
**改动**: Planner → Task DAG 后发送 `plan_approval` 请求到 user
（此功能已部分存在，需验证完整性）
**验证点**:
- [ ] Planner 完成后 CEO 发送 protocol.request('plan_approval', ...)
- [ ] 前端能通过 API 获取待审批请求列表
- [ ] 用户 approve 后 Pipeline 继续，reject 后记录原因
- [ ] 测试: protocol.getUserInbox() 包含 plan_approval 请求

### T1.6 — 项目状态机完善（7 种状态全流转）
**依赖**: T1.2
**文件**: `src/agents/ceo.ts`
**改动**: 确保状态流转完整
```
created → planning → building → reviewing → deployed → (feedback → building) → paused
```
**验证点**:
- [ ] created: createProject 后立即设置
- [ ] planning: Planner 开始前设置
- [ ] building: Ralph Loop 期间
- [ ] reviewing: 全部完成但未部署
- [ ] deployed: 部署成功后
- [ ] paused: 用户暂停时
- [ ] feedback → building: 收到反馈后重新进入
- [ ] 测试: 检查 project.status 在每个阶段的值

### T1.7 — CEO.runAsync 批量项目串行执行 + 失败隔离
**依赖**: T1.1
**文件**: `src/agents/ceo.ts`
**改动**: `runAsync` 改为真正的异步队列
```
class CEO {
  private queue: Project[] = []
  
  async runAsync(project, requirement) {
    this.queue.push(project)
    // 串行执行，不阻塞返回
    while (this.queue.length > 0) {
      const p = this.queue.shift()
      await this.run(p, requirement).catch(...)
    }
  }
}
```
**验证点**:
- [ ] runAsync 立即返回 Promise（不阻塞调用者）
- [ ] 项目按提交顺序串行执行
- [ ] 单个项目失败不影响后续项目
- [ ] 测试: 提交 3 个项目，第二个失败，第三个仍然完成

---

## Phase 2: 服务化改造 (6 tasks)

### T2.1 — 统一入口：discuss-server 升级为 API Server
**依赖**: T1.1
**文件**: `src/discuss-server.ts` → 重命名为 `src/server.ts`
**改动**: 新增 API 端点
```
POST /api/projects/create   { requirement: "..." }
GET  /api/projects/list
GET  /api/projects/:id/status
POST /api/projects/:id/approve  { requestId, approved }
POST /api/projects/:id/feedback  { feedback: "..." }
GET  /api/projects/:id/handoff
```
**验证点**:
- [ ] POST /api/projects/create 接收需求，创建项目，返回 projectId
- [ ] GET /api/projects/list 返回所有项目及状态
- [ ] GET /api/projects/:id/status 返回任务进度（完成/进行中/待办数）
- [ ] POST /api/projects/:id/approve 能审批 pending 请求
- [ ] POST /api/projects/:id/feedback 触发反馈闭环
- [ ] 原有 /api/discuss 功能不受影响

### T2.2 — 异步项目执行（提交即返回，后台执行）
**依赖**: T2.1
**文件**: `src/server.ts`
**改动**: `/api/projects/create` 接收后立即返回，后台启动 CEO.runAsync
```
projects.create → 返回 { projectId, status:'created' }
  → 后台: ceo.run(project, requirement)
  → 完成: project.status = 'deployed'
```
**验证点**:
- [ ] POST /api/projects/create 在 100ms 内返回（不等待完成）
- [ ] 后台项目正常执行（日志可查）
- [ ] GET /api/projects/:id/status 在项目完成后返回 'deployed'
- [ ] 同时提交 3 个项目，各自独立执行

### T2.3 — 进程守护 (PM2 配置)
**依赖**: T2.1
**文件**: `ecosystem.config.cjs`（PM2 配置文件）
**改动**: 新增 PM2 配置，确保崩溃自动重启
```js
module.exports = {
  apps: [{
    name: 'snake-server',
    script: 'src/server.ts',
    interpreter: 'node --import tsx',
    autorestart: true,
    max_restarts: 10,
  }]
}
```
**验证点**:
- [ ] `pm2 start ecosystem.config.cjs` 启动服务
- [ ] `pm2 status` 显示 online
- [ ] 模拟进程 crash → PM2 自动重启
- [ ] `curl localhost:3100/api/health` 返回 200

### T2.4 — 通知系统 (Webhook + 控制台)
**依赖**: T2.1
**文件**: `src/core/notify.ts`（新建）
**改动**: 可扩展的通知接口，内置 webhook 实现
```
interface Notifier {
  notify(event: string, payload: any): Promise<void>
}
class WebhookNotifier implements Notifier { ... }
class ConsoleNotifier implements Notifier { ... }
```
**验证点**:
- [ ] 项目完成 → 触发 `project.completed` 事件
- [ ] 审批请求 → 触发 `approval.requested` 事件
- [ ] Webhook URL 可配置（环境变量 WEBHOOK_URL）
- [ ] 无 webhook 时降级到 console.log

### T2.5 — 实时进度推送 (SSE)
**依赖**: T2.1
**文件**: `src/server.ts`
**改动**: 新增 SSE 端点，推送项目实时进度
```
GET /api/projects/:id/stream
  → data: {"phase":"building","task":"3/5","message":"Task #2 完成"}
```
**验证点**:
- [ ] 浏览器 EventSource 连接成功
- [ ] Planner 完成 → 推送 "planning" 事件
- [ ] 每个 Task 完成 → 推送进度更新
- [ ] 项目完成 → 推送 "deployed" + 关闭连接

### T2.6 — 多项目上下文隔离（独立 Memory + DAG 实例）
**依赖**: T1.7
**文件**: `src/agents/ceo.ts`
**改动**: 确保每个 Project 使用独立的 Memory/TaskDAG/ProtocolBus 实例（当前已部分实现，需验证和加固）
```
每个 Project {
  独立 projectDir
  独立 memory: AgentMemory(dir + '/.memory')
  独立 dag: TaskDAG(dir)
  独立 protocol: ProtocolBus(dir)
}
```
**验证点**:
- [ ] 项目 A 的 Memory 搜索不返回项目 B 的记忆
- [ ] 项目 A 的 TaskDAG 操作不影响项目 B
- [ ] 两个项目同时运行不出现文件冲突
- [ ] 测试: 2 个项目各创建 1 个 task → 各自只有 1 个 task

---

## Phase 3: 前端仪表盘 (7 tasks)

### T3.1 — 项目仪表盘页面（/dashboard）
**依赖**: T2.1
**文件**: `discuss.html` 扩展
**改动**: 在 discuss.html 增加仪表盘视图
- 项目卡片列表（名称、状态、进度条、最后更新时间）
- 点击进入项目详情
**验证点**:
- [ ] 仪表盘显示所有项目（即使 0 个也显示空状态）
- [ ] 项目卡片显示: 名称、状态标签（颜色区分）、进度百分比
- [ ] 点击项目卡片 → 进入项目详情视图
- [ ] 新建项目按钮 → 跳转到需求输入对话框

### T3.2 — 项目详情页（任务列表 + 审批）
**依赖**: T3.1
**文件**: `discuss.html` 扩展
**改动**: 项目详情视图
- 任务列表（树形，显示依赖关系）
- 每个任务的状态 + 重试次数
- 审批请求列表 + approve/reject 按钮
**验证点**:
- [ ] 任务列表按 DAG 依赖树展示
- [ ] 已完成任务绿色，失败任务红色，进行中蓝色
- [ ] 审批请求显示描述 + 一键 approve/reject
- [ ] approve 后任务自动继续执行

### T3.3 — 需求输入 → 一键启动 Pipeline
**依赖**: T2.1
**文件**: `discuss.html` 扩展
**改动**: 需求输入框 + 提交按钮
- 用户输入需求描述
- 提交 → 调用 POST /api/projects/create
- 自动跳转到仪表盘（项目显示 "planning" 状态）
**验证点**:
- [ ] 输入需求 "帮我做一个XXX" → 点击提交
- [ ] 仪表盘立即出现新项目卡片（状态: created）
- [ ] 10 秒内状态变为 planning
- [ ] 不需要用户手动运行任何命令

### T3.4 — 实时进度展示
**依赖**: T2.5
**文件**: `discuss.html` 扩展
**改动**: 项目详情页连接 SSE，实时更新
- 进度条动画
- 当前执行阶段标签
- 最新日志滚动显示
**验证点**:
- [ ] SSE 连接建立后显示 "实时连接中"
- [ ] Generator 开始 → 进度条更新
- [ ] Evaluator 通过 → Phase 2 更新
- [ ] 连接断开 → 显示 "连接断开，重新连接中..."

### T3.5 — Handoff/Deploy 报告展示
**依赖**: T2.1
**文件**: `discuss.html` 扩展
**改动**: 项目完成后展示交付物
- HANDOFF.md 内容渲染
- DEPLOY.md 部署建议
- SEO.md 优化报告
- 一键下载/打开链接
**验证点**:
- [ ] 项目 deployed 后显示交付报告标签页
- [ ] HANDOFF.md 内容正确渲染（markdown）
- [ ] SEO 建议以卡片形式展示
- [ ] 报告内容与磁盘文件一致

### T3.6 — 反馈提交 UI
**依赖**: T1.4
**文件**: `discuss.html` 扩展
**改动**: 项目详情页增加反馈输入
- 文本输入框 + 提交按钮
- 提交后调用 POST /api/projects/:id/feedback
- 自动刷新任务列表（新 Task 出现）
**验证点**:
- [ ] 输入反馈 "加载太慢" → 提交
- [ ] 任务列表出现新 Task "性能优化"
- [ ] 新 Task 自动进入执行
- [ ] 反馈记录在 Memory 中可查

### T3.7 — 响应式 + 移动端适配
**依赖**: T3.2
**文件**: `discuss.html`
**改动**: CSS 媒体查询
- 侧边栏在小屏幕下可折叠
- 按钮和输入框适合触屏
- PWA manifest（可选）
**验证点**:
- [ ] iPhone/Android 浏览器打开可正常使用
- [ ] 侧边栏可滑出/收起
- [ ] 触摸操作响应正常

---

## Phase 4: 基础设施 (5 tasks)

### T4.1 — CodeExecutor 沙箱隔离（Docker 容器执行）
**依赖**: 无
**文件**: `src/executors/code-executor.ts`
**改动**: 可选 Docker 模式
```
executeCode(output, dir, { sandbox: 'docker' }) {
  // docker run --rm -v dir:/workspace node:alpine sh -c "cd /workspace && npm test"
}
```
**验证点**:
- [ ] 默认模式仍为本地执行（兼容无 Docker 环境）
- [ ] DOCKER_MODE=true 时使用 Docker 执行
- [ ] 容器内生成的代码无法访问宿主机文件
- [ ] 容器超时 30s 自动 kill

### T4.2 — 自动部署到 Vercel/静态服务器
**依赖**: T1.2
**文件**: `src/agents/devops.ts`
**改动**: deploy() 增加实际部署能力
```
deploy() {
  // 1. 检查
  // 2. 打包静态文件
  // 3. 上传到 Vercel (via API) 或 写入 nginx 目录
}
```
**验证点**:
- [ ] 静态 HTML 项目 → 生成可访问的 URL
- [ ] 部署失败 → 返回具体错误原因
- [ ] 部署日志写入 .tasks/deploy.log
- [ ] 环境变量 DEPLOY_TARGET=vercel|local 切换目标

### T4.3 — 持久化日志系统
**依赖**: T2.1
**文件**: `src/core/logger.ts`（新建）
**改动**: 结构化日志 + 轮转
```
logger.info('CEO.run', { projectId, phase: 'planning' })
logger.error('Generator.fail', { taskId, error })
```
**验证点**:
- [ ] 日志写入 `.tasks/logs/YYYY-MM-DD.log`
- [ ] 日志格式: `[时间] [级别] [模块] 消息 {JSON数据}`
- [ ] 超过 10MB 自动轮转
- [ ] 保留最近 7 天日志

### T4.4 — 健康检查 + Agent 心跳
**依赖**: T2.1
**文件**: `src/server.ts` + `src/core/heartbeat.ts`（新建）
**改动**: 
- `/api/health` 返回服务状态
- 每个 Agent 定期写入心跳文件
- CEO 监控心跳，超时自动重启
**验证点**:
- [ ] GET /api/health → { status:'ok', agents: { planner:'alive', ... } }
- [ ] 模拟 Agent 卡死 → 心跳超时 → CEO 记录告警
- [ ] 心跳文件在 `.tasks/heartbeats/` 目录

### T4.5 — API Key 管理 + 速率限制
**依赖**: T2.1
**文件**: `src/server.ts`
**改动**: 
- Bearer token 认证
- 每个 API Key 每分钟 60 次限制
**验证点**:
- [ ] 无 token → 401
- [ ] 错误 token → 403
- [ ] 超过速率 → 429 + Retry-After header
- [ ] API keys 存储在 .env（不提交 git）

---

## Phase 5: 自进化 (3 tasks)

### T5.1 — 跨项目失败模式学习
**依赖**: T1.3
**文件**: `src/core/memory.ts` + `src/agents/ceo.ts`
**改动**: 
- ReflectionLog.getPastContext 返回跨项目教训
- CEO 在新项目 Planner 阶段注入历史教训
**验证点**:
- [ ] 项目 A 失败 → Memory 记录 anti_pattern
- [ ] 项目 B 相似任务 → prompt 包含项目 A 的教训
- [ ] 教训包含具体 "问题 → 原因 → 解决方案" 三段式
- [ ] 测试: 项目 A 的 REFLECTION_LOG 被项目 B 的 Planner 引用

### T5.2 — PUA 约束动态调整（基于失败统计）
**依赖**: T5.1
**文件**: `src/constraints/pua.ts`
**改动**: 
- 统计每种 RedFlag 触发频率
- 高频问题 → 自动升级约束优先级
- 低频问题 → 降级为 soft warning
**验证点**:
- [ ] 统计文件在 `.tasks/constraint-stats.json`
- [ ] "缺少 DOCTYPE" 触发 10 次 → 从 WARNING 升级为 P0 HARD_FAIL
- [ ] 从未触发的约束 → 降级或移除
- [ ] 手动重置统计不影响基础约束

### T5.3 — SPECIFY 模板学习（从成功项目提取最佳 Spec）
**依赖**: T5.1
**文件**: `src/core/spec-learner.ts`（新建）
**改动**: 
- 分析成功的项目 → 提取 Spec 模板
- 新项目 SPECIFY 阶段参考相似项目的 Spec
**验证点**:
- [ ] 成功项目（score ≥ 8.0）的 Spec 自动存储
- [ ] 新项目的 "类型" 如果匹配 → Planner 注入成功 Spec 摘要
- [ ] 相似度算法: 基于需求关键词匹配
- [ ] Spec 模板存储在 `.tasks/spec-templates/`

---

## 📊 执行统计

| Phase | 任务数 | 预计改动文件 | 测试增量 |
|-------|--------|-------------|----------|
| Phase 1: CEO 循环 | 7 | 3-4 | +12 tests |
| Phase 2: 服务化 | 6 | 4-5 | +10 tests |
| Phase 3: 前端 | 7 | 1-2 | +5 tests |
| Phase 4: 基础设施 | 5 | 5-6 | +8 tests |
| Phase 5: 自进化 | 3 | 3-4 | +6 tests |
| **总计** | **28** | **16-21** | **+41 tests** |

> 注: 原 19 项缺口合并/去重后为 28 个原子任务（部分缺口通过同一任务解决）
