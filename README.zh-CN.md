# Snake of Mercury (水银之蛇)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-1.000-blue)](https://docs.anthropic.com/en/docs/claude-code)
[![GitHub Stars](https://img.shields.io/github/stars/StarlitSKy88/Snake-of-Mercury?style=social)](https://github.com/StarlitSKy88/Snake-of-Mercury/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/StarlitSKy88/Snake-of-Mercury?style=social)](https://github.com/StarlitSKy88/Snake-of-Mercury/fork)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/StarlitSKy88/Snake-of-Mercury/pulls)

**[English](./README.md) | [中文](#)**

---

> **只需 1-4 句话描述你的产品想法，就能得到完整可运行的产品——全自动、无人值守。**

## 这是什么？

**Snake of Mercury (水银之蛇)** 是基于 Claude Code Agent 系统的**全自动化闭环开发引擎**。它远不止是一个代码生成器：

### 它有什么不同？

| 特性 | 传统 AI 编程 | Snake of Mercury (水银之蛇) |
|------|-------------|-----------------|
| **产品创新** | ❌ 直接写代码 | ✅ Phase 0：5 Agent 真对抗辩论 |
| **Agent 通信** | ❌ 协调器中转 | ✅ SendMessage 直接通信 |
| **质量把关** | ❌ 单层评估 | ✅ 三层（测试 + 真实用户 + 独立裁决） |
| **商业评估** | ❌ 没有 | ✅ 内置商业闭环评估 |
| **收敛逻辑** | ❌ 无限循环 | ✅ 智能自动停止 |

## 核心架构

### Phase 0：真对抗辩论（5 个 Agent）

```
Step 1: 5 个 Agent 并行独立洞察（互相看不到对方输出）
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ 需求重构     │ │ 颠覆式创新   │ │ 商业闭环     │ │ 质量风险     │
│ 洞察者       │ │ 官           │ │ 操盘手       │ │ 监督官       │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
      ┌──────────────┐
      │ 规划收敛者   │  ← 第 5 个视角
      └──────────────┘

Step 2: TeamCreate + SendMessage 真对抗辩论
  Round 1: 每个 Agent 用 SendMessage 直接质疑其他 4 个（不经协调器中转）
  Round 2: 每个 Agent 直接回应质疑（可以被说服后修正观点）
  Round 3: planner 整合收敛 → 增强版产品需求
```

**核心创新**：Agent 之间通过 `SendMessage` **直接通信**，不经过协调器中转。这意味着：
- 信息零损耗
- 可以即时追问
- 被说服后可以动态修正观点

### Phase 2：三层质量把关

| 层级 | 角色 | 权力 |
|------|------|------|
| 第 1 层 | qa-evaluator + vibcoding-checkpoint | E2E 测试 + 代码审查 + 安全检查 |
| 第 2 层 | bb-browser（可选） | 真实用户场景测试 |
| **第 3 层** | **独立质量监督官** | **一票否决权 + 收敛触发权** |

### 智能收敛

- 连续 2 轮无价值提升 → 自主挖掘模式（不停，找新方向）
- 核心功能劣化 → 自动回滚
- 用户说"停止" → 结束循环

## 快速开始

### 前置要求

- 已安装并登录 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- Node.js & npm（可选，用于 bb-browser MCP）

### 安装

```bash
# 克隆仓库
git clone https://github.com/StarlitSKy88/Snake-of-Mercury.git
cd Snake-of-Mercury

# 运行安装脚本
bash install.sh

# 验证安装
bash verify.sh
```

安装脚本会自动完成：
1. ✅ 检查 Claude Code CLI 是否可用
2. ✅ 安装 5 个 Agent 文件到 `~/.claude/agents/`
3. ✅ 安装 `/harness` skill 到 `~/.claude/skills/harness/`
4. ✅ 可选：配置 bb-browser MCP（真实用户测试）

### 基础用法

```bash
# 在 Claude Code 中输入：
/harness 开发一个个人博客，支持文章发布、评论、标签

# 或者用自然语言描述：
/harness 做一个命令行记账工具，支持分类统计和导出
```

### 进阶用法

```bash
# 指定技术栈
/harness 用 Express.js 和 PostgreSQL 构建一个 REST API

# 指定部署目标
/harness 做一个 React 应用，完成后部署到 Vercel

# 随时停止迭代
/harness ...（满意后直接说「停止」或「满意了」）
```

### 输入 /harness 后会发生什么？

1. **Phase 0**（2-5 分钟）：5 个 Agent 辩论你的想法 → 生成增强版需求
2. **Phase 1**（1-2 分钟）：生成产品规格文档 + Sprint 计划
3. **Phase 2**（视项目规模）：代码实现 + 三层质量把关
4. **Phase 3**（1-2 分钟）：自动部署 + 文档更新
5. **循环**：自动返回 Phase 0，发现产品不足并改进

## Agent 阵容

| # | Agent | 职责 | 特殊权力 |
|---|-------|------|----------|
| 1 | insight-challenger | 质疑需求、挖掘痛点 | 3 个核心质疑 |
| 2 | innovation-officer | 颠覆式创新 | 推翻现有框架 |
| 3 | business-operator | 商业闭环评估 | 商业评分 |
| 4 | quality-supervisor | 质量裁决 | **一票否决权** |
| 5 | planner | 规划收敛 | 需求决策权 |
| 6 | harness-coordinator | 总控调度 | 全局调度权 |

## 四维评分标准

| 维度 | 权重 | 评分重点 |
|------|------|---------|
| 产品深度 | 35% | 功能完整性、惊喜体验 |
| 用户体验 | 30% | 交互流畅、异常处理 |
| 代码质量 | 20% | 可读性、测试覆盖 |
| 安全合规 | 15% | 输入验证、权限控制 |

**通过标准**：总分 ≥ 8.0 且无单项 < 7.0

## 项目结构

```
Snake-of-Mercury/
├── agents/
│   ├── harness-coordinator.md       # 总控协调器
│   ├── phase0-insight-challenger.md # 需求重构洞察者
│   ├── phase0-innovation-officer.md  # 颠覆式创新官
│   ├── phase0-business-operator.md   # 商业闭环操盘手
│   └── phase0-quality-supervisor.md  # 独立质量监督官（一票否决权）
├── skills/
│   └── harness/
│       └── SKILL.md                  # /harness 入口 skill
├── docs/
│   └── ARCHITECTURE.md               # 架构文档
├── install.sh                        # 安装脚本
├── verify.sh                         # 验证脚本
├── uninstall.sh                      # 卸载脚本
├── LICENSE                           # MIT 协议
└── README.zh-CN.md                    # 本文件
```

## 与其他方案的对比

| 维度 | Anthropic Harness | 其他 AI 工具 | Snake of Mercury (水银之蛇) |
|------|-----------------|-------------|-----------------|
| 产品创新 | ❌ 无 | ❌ 无 | ✅ Phase 0 五视角辩论 |
| Agent 通信 | ⚠️ 协调器中转 | ❌ 无 | ✅ SendMessage 直接通信 |
| 质量把关 | ⚠️ 单层 | ⚠️ 单层 | ✅ 三层 |
| 商业评估 | ❌ 无 | ❌ 无 | ✅ 内置 |
| 收敛逻辑 | ⚠️ 手动 | ❌ 无 | ✅ 智能自动停止 |

## 适用场景

### ✅ 推荐

- **一人公司 / 独立开发者** — 最大化产出效率
- **需要产品创新** — 不只是写代码，还要思考产品
- **长周期项目** — 无人值守持续迭代
- **MVP 到产品化** — 从想法到部署的完整自动化

### ❌ 不推荐

- 只需要简单 bug 修复（直接用 Claude Code 即可）
- 需要人工审核每一步
- 没有 Claude API 预算
- 不信任 AI 自动执行

## 许可证

[MIT License](LICENSE)

---

> 如果您喜欢这个项目，请考虑给一个 ⭐️ — 这对我们真的很有帮助！

<p align="center">
  <strong>Made with Claude Code</strong>
</p>
