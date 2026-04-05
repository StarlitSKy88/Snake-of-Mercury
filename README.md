# Snake of Mercury (水银之蛇)

> **Unified Autopilot** — Claude Code 全自动闭环开发引擎

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Agent%20System-blue)](https://docs.anthropic.com/en/docs/claude-code)

**从 1-4 句话的产品想法，到完整可运行的产品——全自动、无人值守。**

## 这是什么？

Snake of Mercury 是一个基于 Claude Code Agent 系统的**全自动化闭环开发引擎**。它不只是一个代码生成器——它会：

1. **质疑你的需求**（Phase 0：5 个 Agent 真对抗辩论）
2. **规划产品架构**（Phase 1：自动生成规格文档）
3. **编写代码 + 三层质量把关**（Phase 2：测试 + 真实用户测试 + 独立裁决）
4. **自动部署 + 文档**（Phase 3：ship → canary → release）
5. **持续迭代**（自动回到 Phase 0，发现产品不足并改进）

核心目标：**「弥补产品不足、放大产品价值」**，而非仅仅修复 bug。

## 架构亮点

### TeamCreate 真对抗辩论（Phase 0）

```
Step 1: 5 Agent 并行洞察（互相不可见）
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │ 需求重构      │  │ 颠覆式创新    │  │ 商业闭环      │  │ 质量风险      │
  │ 洞察者        │  │ 官           │  │ 操盘手        │  │ 监督官        │
  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
  ┌──────────────┐
  │ 规划收敛者    │  ← 第 5 个视角
  └──────────────┘

Step 2: TeamCreate + SendMessage 真对抗
  Round 1: 每个 Agent 直接质疑其他 4 个（SendMessage 直接通信）
  Round 2: 每个 Agent 直接回应质疑（可被说服后修正观点）
  Round 3: planner 整合收敛 → 增强版产品需求
```

这不是"coordinator 中转模拟对抗"——Agent 之间通过 `SendMessage` **直接通信**，信息无损，可以动态追问和被说服后修正观点。

### 三层质量把关（Phase 2）

| 层级 | 角色 | 职责 |
|------|------|------|
| 第一层 | qa-evaluator + vibcoding-checkpoint | E2E 测试 + 代码审查 + 安全检查 |
| 第二层 | bb-browser（可选） | 真实用户场景测试 |
| **第三层** | **独立质量监督官** | **一票否决权 + 收敛触发权** |

### 智能收敛

- 连续 2 轮无价值提升 → 自主挖掘模式（不停，找新方向）
- 核心功能劣化 → 自动回滚
- 用户说"停止" → 结束

## 快速开始

### 前置要求

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 已安装并登录
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

安装脚本会自动：
1. 检查 Claude Code CLI
2. 安装 5 个 Agent 文件到 `~/.claude/agents/`
3. 安装 /harness skill 到 `~/.claude/skills/harness/`
4. 可选：配置 bb-browser MCP（真实用户测试）

### 使用

```bash
# 在 Claude Code 中输入
/harness 开发一个个人博客，支持文章发布、评论、标签

# 或者
/harness 做一个命令行记账工具，支持分类统计和导出

# 停止迭代
直接说「停止」或「满意了」
```

## Agent 阵容

| # | Agent | 职责 | 特殊权力 |
|---|-------|------|----------|
| 1 | insight-challenger | 质疑需求、挖痛点 | 3 个核心质疑 |
| 2 | innovation-officer | 颠覆式创新 | 推翻现有框架 |
| 3 | business-operator | 商业闭环评估 | 商业评分 |
| 4 | quality-supervisor | 质量裁决 | **一票否决权** |
| 5 | planner | 规划收敛 | 需求决策权 |
| 6 | harness-coordinator | 总控调度 | 全局调度权 |

## 四维评分

| 维度 | 权重 | 重点 |
|------|------|------|
| 产品深度 | 35% | 功能完整性、惊喜体验 |
| 用户体验 | 30% | 交互流畅、异常处理 |
| 代码质量 | 20% | 可读性、测试覆盖 |
| 安全合规 | 15% | 输入验证、权限控制 |

通过标准：总分 ≥ 8.0 且无单项 < 7.0

## 项目结构

```
Snake-of-Mercury/
├── agents/
│   ├── harness-coordinator.md       # 总控协调器
│   ├── phase0-insight-challenger.md # 需求重构洞察者
│   ├── phase0-innovation-officer.md  # 颠覆式创新官
│   ├── phase0-business-operator.md   # 商业闭环操盘手
│   └── phase0-quality-supervisor.md  # 独立质量监督官
├── skills/
│   └── harness/
│       └── SKILL.md                  # /harness 入口 skill
├── docs/
│   ├── ARCHITECTURE.md               # 架构文档
│   └── LOTM-22-PATHWAYS.md           # 诡秘之主 22 条途径参考
├── install.sh                        # 安装脚本
├── verify.sh                         # 验证脚本
├── uninstall.sh                      # 卸载脚本
├── LICENSE                           # MIT 协议
└── README.md                         # 本文件
```

## 与其他 Harness 方案的区别

| 维度 | 其他方案 | Snake of Mercury |
|------|---------|-----------------|
| 产品创新 | 无（直接规划） | ✅ Phase 0 五视角真对抗 |
| Agent 通信 | coordinator 中转 | ✅ SendMessage 直接通信 |
| 质量把关 | 单层 Evaluator | ✅ 三层（测试+用户+裁决） |
| 商业视角 | 无 | ✅ 商业闭环操盘手 |
| 收敛逻辑 | 无限循环或手动停 | ✅ 智能收敛 + 自主挖掘 |

## 适用场景

**推荐：**
- 一人公司 / 独立开发者
- 需要产品创新而不仅是写代码
- 长周期项目无人值守运行

**不推荐：**
- 只需要简单 bug 修复
- 需要人工审核每一步
- 不信任 AI 自动执行

## 命名由来

> "Snake of Mercury"（水银之蛇）取自小说《诡秘之主》（Lord of the Mysteries）中的占卜家途径序列 1：**水银之蛇**（Snake of Mercury）。正如水银之蛇能操纵命运、洞察未来，这个引擎通过多 Agent 对抗来洞察产品的真正需求。

后续项目将按诡秘之主的 22 条成神途径命名。

## 许可证

[MIT License](LICENSE)

---

**Made with Claude Code**
