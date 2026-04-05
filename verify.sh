#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Snake of Mercury — Installation Verification
# 验证 Snake of Mercury 安装是否正确
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

PASS=0
FAIL=0
WARN=0
CLAUDE_DIR="$HOME/.claude"

green()  { echo -e "\033[0;32m[✅ PASS]\033[0m $1"; PASS=$((PASS+1)); }
red()    { echo -e "\033[0;31m[❌ FAIL]\033[0m $1"; FAIL=$((FAIL+1)); }
yellow() { echo -e "\033[1;33m[⚠️  WARN]\033[0m $1"; WARN=$((WARN+1)); }

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       🐍 Snake of Mercury — Installation Verification         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── 1. 前置工具检查 ──────────────────────────────────────────────

echo "━━━ 1. Prerequisites ━━━"

if command -v claude &>/dev/null; then
    green "Claude Code CLI: $(claude --version 2>/dev/null || echo 'installed')"
else
    red "Claude Code CLI: not found"
fi

if command -v node &>/dev/null; then
    green "Node.js: $(node --version)"
else
    yellow "Node.js: not found (bb-browser MCP will be unavailable)"
fi

if command -v npm &>/dev/null; then
    green "npm: $(npm --version)"
else
    yellow "npm: not found (bb-browser MCP will be unavailable)"
fi

echo ""

# ── 2. Agent 文件检查 ────────────────────────────────────────────

echo "━━━ 2. Agent Files ━━━"

REQUIRED_AGENTS=(
    "harness-coordinator.md"
    "phase0-insight-challenger.md"
    "phase0-innovation-officer.md"
    "phase0-business-operator.md"
    "phase0-quality-supervisor.md"
)

for agent in "${REQUIRED_AGENTS[@]}"; do
    if [ -f "$CLAUDE_DIR/agents/$agent" ]; then
        # 检查 tools 字段是否包含 SendMessage
        if grep -q "SendMessage" "$CLAUDE_DIR/agents/$agent"; then
            green "$agent (with SendMessage support)"
        else
            yellow "$agent (missing SendMessage - may need reinstall)"
        fi
    else
        red "$agent: not found in $CLAUDE_DIR/agents/"
    fi
done

echo ""

# ── 3. Skill 文件检查 ────────────────────────────────────────────

echo "━━━ 3. Skill Files ━━━"

if [ -f "$CLAUDE_DIR/skills/harness/SKILL.md" ]; then
    green "harness/SKILL.md exists"
    # 检查是否包含 TeamCreate
    if grep -q "TeamCreate" "$CLAUDE_DIR/skills/harness/SKILL.md"; then
        green "SKILL.md references TeamCreate (correct architecture)"
    else
        yellow "SKILL.md missing TeamCreate reference"
    fi
else
    red "harness/SKILL.md: not found"
fi

echo ""

# ── 4. MCP 服务器检查 ────────────────────────────────────────────

echo "━━━ 4. MCP Servers ━━━"

if command -v claude &>/dev/null; then
    MCP_LIST=$(claude mcp list 2>/dev/null || echo "")
    if echo "$MCP_LIST" | grep -q "bb-browser"; then
        green "bb-browser MCP: registered"
    else
        yellow "bb-browser MCP: not registered (optional, for real user testing)"
    fi
else
    yellow "Cannot check MCP servers (Claude CLI not found)"
fi

echo ""

# ── 5. 可选依赖检查 ──────────────────────────────────────────────

echo "━━━ 5. Optional Dependencies ━━━"

if [ -d "$CLAUDE_DIR/skills/lenny_skills_plus/skills/problem-definition" ]; then
    green "lenny_skills_plus problem-definition: installed"
else
    yellow "lenny_skills_plus: not found (Phase 0 Step 0 requires it)"
    yellow "  Install: git clone --depth 1 https://github.com/liqiongyu/lenny_skills_plus ~/.claude/skills/lenny_skills_plus"
fi

echo ""

# ── 6. 安全扫描 ──────────────────────────────────────────────────

echo "━━━ 6. Security Scan ━━━"

# 检查 Agent 文件中是否有硬编码密钥
SECRET_FOUND=false
for agent in "${REQUIRED_AGENTS[@]}"; do
    if [ -f "$CLAUDE_DIR/agents/$agent" ]; then
        if grep -qE "(sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36})" "$CLAUDE_DIR/agents/$agent" 2>/dev/null; then
            red "SECURITY: Hardcoded secret found in $agent!"
            SECRET_FOUND=true
        fi
    fi
done

if [ "$SECRET_FOUND" = false ]; then
    green "No hardcoded secrets in Agent files"
fi

echo ""

# ── 结果汇总 ──────────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                  Verification Results                         ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  ✅ Passed: $PASS                                             ║"
echo "║  ⚠️  Warnings: $WARN                                            ║"
echo "║  ❌ Failed: $FAIL                                              ║"
echo "╠══════════════════════════════════════════════════════════════╣"

if [ "$FAIL" -eq 0 ]; then
    echo "║  🎉 All critical checks passed!                                ║"
    echo "║  Usage: /harness [your product idea in 1-4 sentences]         ║"
else
    echo "║  ⚠️  Some checks failed. Re-run install.sh to fix.             ║"
fi

echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
