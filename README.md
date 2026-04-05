# Snake of Mercury (水银之蛇)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-1.000-blue)](https://docs.anthropic.com/en/docs/claude-code)
[![GitHub Stars](https://img.shields.io/github/stars/StarlitSKy88/Snake-of-Mercury?style=social)](https://github.com/StarlitSKy88/Snake-of-Mercury/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/StarlitSKy88/Snake-of-Mercury?style=social)](https://github.com/StarlitSKy88/Snake-of-Mercury/fork)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/StarlitSKy88/Snake-of-Mercury/pulls)

**[English](#) | [中文](./README.zh-CN.md)**

---

> **From 1-4 sentences of a product idea to a fully working application — 100% automated, hands-off.**

## What is this?

**Snake of Mercury (水银之蛇)** is an **autonomous closed-loop development engine** built on the Claude Code Agent system. It goes far beyond a simple code generator:

### What makes it different?

| Feature | Traditional AI Coding | Snake of Mercury (水银之蛇) |
|---------|---------------------|-------------------|
| **Product Innovation** | ❌ Direct coding | ✅ Phase 0: 5-Agent debate |
| **Agent Communication** | ❌ Coordinator relay | ✅ Direct SendMessage |
| **Quality Gates** | ❌ Single evaluator | ✅ 3-layer (test + user + verdict) |
| **Business Viability** | ❌ None | ✅ Built-in assessment |
| **Convergence Logic** | ❌ Infinite loop | ✅ Smart auto-stop |

## Core Architecture

### Phase 0: True Adversarial Debate (5 Agents)

```
Step 1: Parallel Insights (agents can't see each other)
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Insight       │  │ Innovation   │  │ Business     │  │ Quality       │
│ Challenger   │  │ Officer      │  │ Operator    │  │ Supervisor  │
└─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
      ┌─────────────┐
      │ Planner      │  ← 5th perspective
      └─────────────┘

Step 2: TeamCreate + SendMessage True Debate
  Round 1: Each agent challenges the other 4 directly (no coordinator relay)
  Round 2: Each agent responds to challenges (can be persuaded to change views)
  Round 3: Planner integrates → Enhanced requirements
```

**Key innovation**: Agents communicate **directly** via `SendMessage`, not through a coordinator. This enables:
- Zero information loss
- Real-time follow-up questions
- Dynamic opinion revision when persuaded

### Phase 2: Three-Layer Quality Gates

| Layer | Role | Power |
|-------|------|-------|
| 1 | qa-evaluator + vibcoding-checkpoint | E2E tests + code review + security scan |
| 2 | bb-browser (optional) | Real user scenario testing |
| **3** | **Quality Supervisor** | **VETO power + convergence trigger** |

### Smart Convergence

- 2 consecutive iterations without value gain → Auto-pivot to new directions
- Core feature regression → Auto-rollback
- User says "stop" → End loop

## Quick Start

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in
- Node.js & npm (optional, for bb-browser MCP)

### Installation

```bash
# Clone the repository
git clone https://github.com/StarlitSKy88/Snake-of-Mercury.git
cd Snake-of-Mercury

# Run the installer
bash install.sh

# Verify installation
bash verify.sh
```

The installer will:
1. ✅ Check Claude Code CLI
2. ✅ Install 5 Agent files to `~/.claude/agents/`
3. ✅ Install `/harness` skill to `~/.claude/skills/harness/`
4. ✅ Optionally configure bb-browser MCP (real user testing)

### Basic Usage

```bash
# In Claude Code, type:
/harness Build a personal blog with posts, comments, and tags

# Or describe naturally:
/harness Create a CLI accounting tool with category tracking and export features
```

### Advanced Usage

```bash
# With specific tech stack
/harness Build a REST API with Express.js and PostgreSQL

# With deployment target
/harness Create a React app, Deploy to Vercel when done.

# Stop iteration at any time
/harness ... (then say "stop" or "good enough" when satisfied)
```

### What Happens After You Type `/harness`?

1. **Phase 0** (2-5 min): 5 agents debate your idea → Enhanced requirements
2. **Phase 1** (1-2 min): Generate product spec + Sprint plan
3. **Phase 2** (varies): Code implementation + 3-layer quality gates
4. **Phase 3** (1-2 min): Auto-deploy + documentation
5. **Loop**: Auto-returns to Phase 0 to find improvements

## Agent Lineup

| # | Agent | Role | Special Power |
|---|-------|------|----------------|
| 1 | insight-challenger | Question requirements, dig pain points | 3 core challenges |
| 2 | innovation-officer | Disruptive innovation | Can overturn existing framework |
| 3 | business-operator | Business viability assessment | Commercial scoring |
| 4 | quality-supervisor | Quality verdict | **VETO power** |
| 5 | planner | Integrate and converge | Requirements decision |
| 6 | harness-coordinator | Orchestrate all phases | Global scheduling |

## Four-Dimensional Scoring

| Dimension | Weight | Focus |
|-----------|--------|-------|
| Product Depth | 35% | Feature completeness, delightful experiences |
| User Experience | 30% | Smooth interactions, error handling |
| Code Quality | 20% | Readability, test coverage |
| Security | 15% | Input validation, permission control |

**Pass criteria**: Total ≥ 8.0 AND no dimension < 7.0

## Project Structure

```
Snake-of-Mercury/
├── agents/
│   ├── harness-coordinator.md       # Orchestrator
│   ├── phase0-insight-challenger.md # Requirement challenger
│   ├── phase0-innovation-officer.md  # Innovation officer
│   ├── phase0-business-operator.md  # Business operator
│   └── phase0-quality-supervisor.md # Quality supervisor (VETO power)
├── skills/
│   └── harness/
│       └── SKILL.md                  # /harness entry point
├── docs/
│   └── ARCHITECTURE.md               # Architecture documentation
├── install.sh                        # Installation script
├── verify.sh                         # Verification script
├── uninstall.sh                      # Uninstallation script
├── LICENSE                           # MIT License
└── README.md                         # This file
```

## Comparison with Other Solutions

| Dimension | Anthropic Harness | Other AI Tools | Snake of Mercury (水银之蛇) |
|-----------|-------------------|-----------------|-------------------|
| Product Innovation | ❌ None | ❌ None | ✅ Phase 0 debate |
| Agent Communication | ⚠️ Coordinator relay | ❌ None | ✅ Direct SendMessage |
| Quality Gates | ⚠️ Single layer | ⚠️ Single layer | ✅ Three layers |
| Business Viability | ❌ None | ❌ None | ✅ Built-in |
| Convergence | ⚠️ Manual | ❌ None | ✅ Smart auto-stop |

## Ideal Use Cases

### ✅ Recommended For

- **Solo founders / Independent developers** — Maximize productivity
- **Product innovation needed** — Not just coding, thinking
- **Long-running projects** — Hands-off continuous improvement
- **MVP to production** — Complete automation from idea to deployment

### ❌ Not Recommended For

- Simple bug fixes (use `/fix` directly)
- Requires manual approval every step
- No Claude API budget available
- Don't trust autonomous AI execution

## License

[MIT License](LICENSE)

---

> If you like this project, please consider giving it a ⭐️ — it really helps!

<p align="center">
  <strong>Made with Claude Code</strong>
</p>
