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
# Step 1: Clone the repository
git clone https://github.com/StarlitSKy88/Snake-of-Mercury.git
cd Snake-of-Mercury

# Step 2: Run the installer
bash install.sh

# Step 3: Verify installation
bash verify.sh
```

The installer will:
1. ✅ Check Claude Code CLI availability
2. ✅ Install 5 Agent files to `~/.claude/agents/`
3. ✅ Install `/harness` skill to `~/.claude/skills/harness/`
4. ✅ Optionally configure bb-browser MCP (for real user testing)

---

## Usage Guide

### Command Format

```
/harness [your product idea in 1-4 sentences]
```

**Tips for better results:**
- ✅ Be specific about features you want
- ✅ Mention target platform (web, CLI, mobile)
- ✅ Specify tech stack if you have preferences
- ❌ Avoid vague descriptions like "make something cool"

### Basic Examples

```bash
# Simple web app
/harness Build a personal blog with posts, comments, and tags

# CLI tool
/harness Create a command-line todo app with priorities and due dates

# API service
/harness Build a URL shortener API with analytics and rate limiting
```

### Advanced Examples

```bash
# With specific tech stack
/harness Build a REST API with Express.js and PostgreSQL for task management

# With deployment target
/harness Create a React dashboard for sales analytics, deploy to Vercel

# Full-stack application
/harness Build a full-stack e-commerce platform with Next.js, Stripe payments, and admin panel

# With specific features
/harness Create a markdown note-taking app with local storage, search, and export to PDF
```

### Controlling the Loop

```bash
# Start the autonomous loop
/harness Build a habit tracker app

# At any point, you can say:
"stop"           # End the loop immediately
"good enough"    # Accept current state and stop
"continue"       # Force another iteration
"show progress"  # See what's been done so far
```

---

## Real-World Case Demonstrations

### Case 1: CLI Accounting Tool

**Input:**
```
/harness 做一个命令行记账工具，支持分类统计和导出CSV
```

**Phase 0 Output (Enhanced Requirements):**
- Core: Add/edit/delete transactions with categories
- Analytics: Monthly/weekly summaries with charts
- Export: CSV and JSON formats
- Innovation: Recurring transaction templates
- Quality: Input validation, data backup

**Final Deliverable:**
- Working CLI tool (`accounting-cli`)
- Commands: `add`, `list`, `stats`, `export`
- Tests with 85% coverage
- README with usage examples

---

### Case 2: REST API with Authentication

**Input:**
```
/harness Build a REST API with Express.js and PostgreSQL, include user auth and CRUD for posts
```

**Phase 0 Output:**
- Auth: JWT-based authentication with refresh tokens
- Posts: CRUD with pagination and search
- Security: Rate limiting, input validation, SQL injection prevention
- Innovation: API versioning, webhook support
- Quality: Integration tests, API documentation

**Final Deliverable:**
- Express.js server with PostgreSQL
- `/auth/*` endpoints (register, login, refresh)
- `/posts/*` endpoints (CRUD + search)
- Postman collection
- Docker Compose for local development

---

### Case 3: React Dashboard

**Input:**
```
/harness Create a React dashboard for tracking daily habits, use charts for visualization
```

**Phase 0 Output:**
- Features: Habit CRUD, streak tracking, weekly/monthly views
- Visualization: Charts for completion rates
- UX: Dark mode, mobile responsive, notifications
- Innovation: Habit templates, social sharing
- Quality: Component tests, accessibility audit

**Final Deliverable:**
- React app with TypeScript
- Chart.js visualizations
- Local storage persistence
- PWA support for offline use

---

## What Happens After `/harness`?

```
┌─────────────────────────────────────────────────────────────────┐
│  Your Input: "Build a personal blog with posts and comments"    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 0: Product Innovation (2-5 min)                          │
│  ────────────────────────────────────────────────────────────── │
│  5 agents debate your idea:                                     │
│  • Insight Challenger: "Who is the target audience?"            │
│  • Innovation Officer: "Add AI-powered writing suggestions"     │
│  • Business Operator: "Consider monetization via subscriptions" │
│  • Quality Supervisor: "Need content moderation for comments"   │
│  • Planner: Integrates all perspectives → Enhanced requirements │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: Planning (1-2 min)                                    │
│  ────────────────────────────────────────────────────────────── │
│  • Generate product specification                               │
│  • Create sprint plan with tasks                                │
│  • Output: ./harness-spec.md                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 2: Development (varies by project size)                  │
│  ────────────────────────────────────────────────────────────── │
│  • Code implementation                                          │
│  • 3-Layer Quality Gates:                                       │
│    Layer 1: E2E tests + code review + security scan             │
│    Layer 2: Real user testing (optional)                        │
│    Layer 3: Quality supervisor (veto power)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 3: Delivery (1-2 min)                                    │
│  ────────────────────────────────────────────────────────────── │
│  • Auto-deploy (if configured)                                  │
│  • Update documentation                                         │
│  • Generate changelog                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Loop Decision                                                   │
│  ────────────────────────────────────────────────────────────── │
│  • Value gain detected? → Return to Phase 0 for improvements    │
│  • 2 consecutive iterations without gain? → Auto-pivot          │
│  • User said "stop"? → End loop                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `/harness` not recognized | Run `bash install.sh` again, verify with `bash verify.sh` |
| Agents not debating | Check `~/.claude/agents/` has 5 `.md` files |
| Phase 0 takes too long | Normal for complex requirements; simplify your input |
| Quality gate failures | Check the generated test reports in project directory |
| Infinite loop | Say "stop" to end; check convergence settings |

---

## Tips for Best Results

1. **Start simple** — Begin with 1-2 sentence descriptions
2. **Be specific** — "Build a blog" < "Build a tech blog with markdown support and RSS feed"
3. **Trust the process** — Let Phase 0 run even if it seems verbose
4. **Iterate** — Say "continue" if you want more features added
5. **Review outputs** — Check `./harness-spec.md` for the enhanced requirements

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
