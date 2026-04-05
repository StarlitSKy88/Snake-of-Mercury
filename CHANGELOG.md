# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-05

### Added

- **Phase 0: 5-Agent Adversarial Debate** — Product innovation stage with true agent-to-agent communication via SendMessage
  - `insight-challenger`: Questions requirements, digs into pain points
  - `innovation-officer`: Proposes disruptive alternatives
  - `business-operator`: Evaluates commercial viability
  - `quality-supervisor`: Has VETO power on quality decisions
  - `planner`: Integrates all perspectives into enhanced requirements

- **Phase 1-3: Autonomous Development Loop**
  - Phase 1: Product spec + Sprint planning
  - Phase 2: Code implementation + 3-layer quality gates
  - Phase 3: Auto-deploy + documentation

- **Three-Layer Quality Gates**
  - Layer 1: E2E tests + code review + security scan
  - Layer 2: Real user scenario testing (optional, via bb-browser MCP)
  - Layer 3: Independent quality supervisor with veto power

- **Smart Convergence**
  - Auto-stops after 2 consecutive iterations without value gain
  - Auto-rollback on core feature regression
  - User can stop at any time with "stop" command

- **Installation & Verification**
  - `install.sh`: One-click installation
  - `verify.sh`: Installation verification
  - `uninstall.sh`: Clean removal

- **Documentation**
  - Bilingual README (English + Chinese)
  - Architecture documentation (`docs/ARCHITECTURE.md`)
  - Comprehensive usage guide with real-world case demonstrations
  - GitHub Issue templates (Bug Report, Feature Request, Good First Issue)

- **CI/CD**
  - GitHub Actions workflow for validation and security scanning

### Technical Details

- Built on Claude Code Agent system
- Uses `SendMessage` for direct agent-to-agent communication (no coordinator relay)
- Four-dimensional scoring: Product Depth 35%, UX 30%, Code Quality 20%, Security 15%
- Pass criteria: Total ≥ 8.0 AND no dimension < 7.0

### Security

- No hardcoded secrets or credentials
- No absolute user paths
- Security scanning in CI pipeline

---

## Future Roadmap

- [ ] Additional agent specializations
- [ ] Enhanced convergence detection
- [ ] More deployment platform integrations
- [ ] Community-contributed agent templates
- [ ] Web UI for monitoring autonomous loops
