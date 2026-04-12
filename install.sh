#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Snake of Mercury — Unified Autopilot Installer
# 安装 Claude Code 全自动闭环开发引擎
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

VERSION="1.0.0"
CLAUDE_DIR="$HOME/.claude"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       🐍 Snake of Mercury — Unified Autopilot Installer        ║"
echo "║       Version ${VERSION}                                            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── 1. 前置检查 ──────────────────────────────────────────────────────

info "Checking prerequisites..."

# Check Claude Code CLI
if command -v claude &>/dev/null; then
    info "Claude Code CLI found: $(claude --version 2>/dev/null || echo 'installed')"
else
    error "Claude Code CLI not found. Install it first: npm install -g @anthropic-ai/claude-code"
fi

# Check Node.js (for bb-browser)
if command -v node &>/dev/null; then
    info "Node.js found: $(node --version)"
else
    warn "Node.js not found. bb-browser MCP will be skipped."
fi

# Check npm (for bb-browser)
if command -v npm &>/dev/null; then
    info "npm found: $(npm --version)"
else
    warn "npm not found. bb-browser MCP will be skipped."
fi

# Check ~/.claude directory
if [ ! -d "$CLAUDE_DIR" ]; then
    error "~/.claude directory not found. Please run Claude Code at least once first."
fi

echo ""

# ── 2. 安装 Agent 文件 ───────────────────────────────────────────────

info "Installing Agent files..."
mkdir -p "$CLAUDE_DIR/agents"

AGENT_COUNT=0
for agent_file in agents/*.md; do
    if [ -f "$agent_file" ]; then
        cp "$agent_file" "$CLAUDE_DIR/agents/"
        AGENT_COUNT=$((AGENT_COUNT + 1))
        info "  Installed: $(basename "$agent_file")"
    fi
done

if [ "$AGENT_COUNT" -eq 0 ]; then
    error "No agent files found in agents/ directory. Run this script from the project root."
fi

info "Installed $AGENT_COUNT Agent files"
echo ""

# ── 3. 安装 Skill 文件 ───────────────────────────────────────────────

info "Installing Skill files..."
mkdir -p "$CLAUDE_DIR/skills/harness"

if [ -f "skills/harness/SKILL.md" ]; then
    cp "skills/harness/SKILL.md" "$CLAUDE_DIR/skills/harness/"
    info "  Installed: harness/SKILL.md"
else
    warn "  skills/harness/SKILL.md not found, skipping."
fi

echo ""

# ── 4. 配置 bb-browser MCP（可选）─────────────────────────────────────

install_bb_browser() {
    info "Configuring bb-browser MCP (global)..."

    # Install bb-browser globally
    npm install -g @dyyz1993/bb-browser 2>/dev/null && \
        info "  @dyyz1993/bb-browser installed globally" || \
        warn "  Failed to install bb-browser (non-critical)"

    # Add to Claude Code global MCP config
    claude mcp add --transport stdio bb-browser -- npx -y @dyyz1993/bb-browser mcp 2>/dev/null && \
        info "  bb-browser registered as global MCP" || \
        warn "  Failed to register bb-browser MCP. Run manually: claude mcp add --transport stdio bb-browser -- npx -y @dyyz1993/bb-browser mcp"
}

if command -v node &>/dev/null && command -v npm &>/dev/null; then
    read -p "$(echo -e ${YELLOW}Install bb-browser MCP for real user testing? [Y/n]${NC} ")" -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        install_bb_browser
    else
        info "Skipping bb-browser MCP installation."
    fi
else
    warn "Node.js/npm not available, skipping bb-browser MCP."
fi

echo ""

# ── 5. 依赖检查：lenny_skills_plus（可选）────────────────────────────────

if [ -d "$CLAUDE_DIR/skills/lenny_skills_plus/skills/problem-definition" ]; then
    info "lenny_skills_plus problem-definition skill already installed."
else
    warn "lenny_skills_plus not found. Phase 0 Step 0 (problem definition) requires it."
    warn "Install with: git clone --depth 1 https://github.com/liqiongyu/lenny_skills_plus ~/.claude/skills/lenny_skills_plus"
fi

echo ""

# ── 6. 完成 ───────────────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                  ✅ Installation Complete!                      ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                              ║"
echo "║  Agents:  $AGENT_COUNT installed                                    ║"
echo "║  Skill:   /harness (Unified Autopilot entry point)             ║"
echo "║  Usage:   /harness [your product idea in 1-4 sentences]         ║"
echo "║                                                              ║"
echo "║  Run 'bash verify.sh' to verify installation.                   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
