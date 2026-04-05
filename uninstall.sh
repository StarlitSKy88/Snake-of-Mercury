#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Snake of Mercury — Uninstaller
# 卸载 Snake of Mercury 所有 Agent 和 Skill
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

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
echo "║       🐍 Snake of Mercury — Uninstaller                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

read -p "$(echo -e ${YELLOW}Are you sure you want to uninstall Snake of Mercury? [y/N]${NC} ")" -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    info "Uninstall cancelled."
    exit 0
fi

REMOVED=0

# ── 1. 删除 Agent 文件 ────────────────────────────────────────────

info "Removing Agent files..."

AGENT_FILES=(
    "harness-coordinator.md"
    "phase0-insight-challenger.md"
    "phase0-innovation-officer.md"
    "phase0-business-operator.md"
    "phase0-quality-supervisor.md"
)

for agent in "${AGENT_FILES[@]}"; do
    if [ -f "$CLAUDE_DIR/agents/$agent" ]; then
        rm "$CLAUDE_DIR/agents/$agent"
        info "  Removed: $agent"
        REMOVED=$((REMOVED+1))
    else
        warn "  Not found: $agent (already removed)"
    fi
done

echo ""

# ── 2. 删除 Skill 文件 ────────────────────────────────────────────

info "Removing Skill files..."

if [ -d "$CLAUDE_DIR/skills/harness" ]; then
    rm -rf "$CLAUDE_DIR/skills/harness"
    info "  Removed: skills/harness/"
    REMOVED=$((REMOVED+1))
else
    warn "  skills/harness/ not found"
fi

echo ""

# ── 3. 移除 bb-browser MCP（可选）──────────────────────────────────

if command -v claude &>/dev/null; then
    MCP_LIST=$(claude mcp list 2>/dev/null || echo "")
    if echo "$MCP_LIST" | grep -q "bb-browser"; then
        read -p "$(echo -e ${YELLOW}Also remove bb-browser MCP? [y/N]${NC} ")" -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            claude mcp remove bb-browser 2>/dev/null && info "Removed bb-browser MCP" || warn "Failed to remove bb-browser MCP"
        fi
    fi
fi

echo ""

# ── 4. 完成 ────────────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                ✅ Uninstallation Complete!                      ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Removed $REMOVE item(s)                                           ║"
echo "║                                                              ║"
echo "║  Note: lenny_skills_plus was NOT removed (may be used by     ║"
echo "║  other projects). Remove manually if needed:                 ║"
echo "║    rm -rf ~/.claude/skills/lenny_skills_plus                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
