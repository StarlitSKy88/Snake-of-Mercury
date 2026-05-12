/**
 * Developer-Supervisor Separation - 开发/监督分离机制
 *
 * 确保 developer 和 supervisor 真正分离：
 * - developer: 实现代码，不可见 supervisor
 * - supervisor: 只看输出结果，有一票否决权
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import type {
  SprintContract,
  SupervisorReport,
  SupervisorVerdict,
  FourDimensionScores,
  ProductSpec
} from './types.js';
import { handleRollback, createSnapshot } from './rollback-manager.js';
import { robustSDKCall, DEVELOPER_OUTPUT_CONSTRAINTS, validateDeveloperOutput } from './utils/sdk-executor.js';

// ============= 常量 =============

const DEV_OUTPUT_DIR = '.sprint-output';
const SUPERVISOR_REPORT_DIR = '.supervisor-reports';
const MAX_RETRY_PER_SPRINT = 3;

/**
 * 评分维度权重
 */
const SCORE_WEIGHTS = {
  productDepth: 0.35,
  userExperience: 0.30,
  codeQuality: 0.20,
  security: 0.15
};

/**
 * 通过/否决标准
 */
const PASS_THRESHOLD = 8.0;
const MIN_DIMENSION_THRESHOLD = 7.0;

// ============= Developer 实现 =============

/**
 * 执行 Developer Sprint 实现
 */
async function executeDeveloperSprint(
  projectDir: string,
  sprint: SprintContract,
  previousIssues: string[] = []
): Promise<void> {
  console.log(`[Sprint ${sprint.sprintNumber}] Developer 开始实现...`);

  // 创建输出目录（先清理旧文件）
  const outputDir = join(projectDir, DEV_OUTPUT_DIR, `sprint-${sprint.sprintNumber}`);
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }
  mkdirSync(outputDir, { recursive: true });

  // 构造 Developer prompt
  const prompt = buildDeveloperPrompt(sprint, previousIssues);

  // 写入 prompt 文件
  const promptFile = join(outputDir, 'TASK.md');
  writeFileSync(promptFile, prompt, 'utf-8');

  try {
    // 使用健壮的 SDK 执行器（带重试和输出验证）
    const systemPrompt = `你是一个专业的开发者，负责实现 Sprint 任务。
请严格按照给定的目标和验收标准实现代码。
确保代码可运行、无编译错误、包含必要的测试。

重要：你必须通过文件路径和内容来组织代码响应，格式如下：
\`\`\`typescript:src/index.ts
// 代码内容
\`\`\`

或者：
\`\`\`javascript:index.js
// 代码内容
\`\`\`

请为每个文件使用这种格式，确保包含文件路径前缀。`;

    const result = await robustSDKCall(
      systemPrompt,
      prompt,
      {
        maxRetries: 3,
        minOutputLines: 50,
        onRetry: (attempt, reason) => {
          console.log(`[Sprint ${sprint.sprintNumber}] Developer 重试 ${attempt}/3: ${reason}`);
        }
      }
    );

    if (!result.success) {
      throw new Error(`Developer 执行失败: ${result.error?.message || '未知错误'} (尝试 ${result.attempts} 次)`);
    }

    // 验证输出
    const validation = validateDeveloperOutput(result.output);
    if (!validation.valid) {
      console.warn(`[Sprint ${sprint.sprintNumber}] Developer 输出验证警告:`, validation.issues);
    }

    // 解析代码响应并写入文件
    const filesWritten = parseAndWriteCodeFiles(result.output, outputDir);

    console.log(`[Sprint ${sprint.sprintNumber}] Developer 完成，写入了 ${filesWritten} 个文件`);
    console.log(`[Sprint ${sprint.sprintNumber}] Developer 输出统计: ${validation.stats.codeLines} 行代码, ${validation.stats.fileCount} 个文件`);
  } catch (error) {
    console.error(`[Sprint ${sprint.sprintNumber}] Developer 执行失败:`, error);
    throw error;
  }
}

/**
 * 解析代码响应并写入文件
 */
function parseAndWriteCodeFiles(codeResponse: string, outputDir: string): number {
  // 匹配 ```language:path/to/file 格式的代码块
  const codeBlockPattern = /```(\w+)?:([^\n]+)\n([\s\S]*?)```/g;

  let filesWritten = 0;
  let match;

  while ((match = codeBlockPattern.exec(codeResponse)) !== null) {
    const [, language, filePath, codeContent] = match;

    // 清理文件路径
    const cleanPath = filePath.trim();

    // 确保路径安全，不允许 .. 路径遍历
    if (cleanPath.includes('..') || cleanPath.startsWith('/')) {
      console.warn(`[Developer] 跳过不安全的路径: ${cleanPath}`);
      continue;
    }

    // 构建完整路径
    const fullPath = join(outputDir, cleanPath);

    // 确保目录存在
    const dir = join(fullPath, '..');
    mkdirSync(dir, { recursive: true });

    // 写入文件
    try {
      writeFileSync(fullPath, codeContent, 'utf-8');
      console.log(`[Developer] 写入文件: ${cleanPath}`);
      filesWritten++;
    } catch (error) {
      console.error(`[Developer] 写入文件失败 ${cleanPath}:`, error);
    }
  }

  // 如果没有匹配到带路径的代码块，尝试直接写入 index 文件
  if (filesWritten === 0) {
    // 尝试提取所有 ``` ``` 包裹的代码
    const simplePattern = /```[\w]*\n([\s\S]*?)```/g;
    const codeBlocks: string[] = [];

    while ((match = simplePattern.exec(codeResponse)) !== null) {
      codeBlocks.push(match[1]);
    }

    if (codeBlocks.length > 0) {
      // 写入到 index.js 或 main.ts
      const mainFile = join(outputDir, 'index.ts');
      writeFileSync(mainFile, codeBlocks.join('\n\n'), 'utf-8');
      console.log(`[Developer] 写入文件: index.ts (共 ${codeBlocks.length} 个代码块)`);
      filesWritten = 1;
    }
  }

  return filesWritten;
}

/**
 * 构建 Developer Prompt
 *
 * 添加 Scope Guardrails 防止范围蔓延：
 * - 禁止实现 Sprint 范围外的功能
 * - 禁止引入新的技术栈或框架
 * - 禁止"过度工程化"
 *
 * 三维度强制要求（产品深度、用户体验、代码质量）
 */
function buildDeveloperPrompt(sprint: SprintContract, previousIssues: string[]): string {
  let prompt = `# Sprint ${sprint.sprintNumber} 开发任务

## Sprint 目标
${sprint.objectives.map(o => `- ${o}`).join('\n')}

## 验收标准
${sprint.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## 技术约束
${sprint.technicalConstraints.map(c => `- ${c}`).join('\n')}

## ⚠️ 范围守护规则（必须严格遵守）

### 禁止事项
1. **禁止实现验收标准之外的功能** - 不要添加"以后可能用到"的功能
2. **禁止引入新框架** - 不要因为"觉得这个框架更好"就引入
3. **禁止过度工程化** - 不要创建抽象层、接口、多态架构
4. **禁止实现与现有代码的"集成"或"兼容"** - 只做功能实现，不做架构级别的改动
5. **禁止创建以下文件/模块**:
   - multi-agent-debate 相关
   - LogHub、DecisionBlockerLocator、InquiryEngine
   - 任何与当前 Sprint 目标无关的工具类或服务类

### 正确做法
- 只实现验收标准中列出的功能
- 代码应该简洁、直接、易读
- 如果不确定某功能是否在范围内，**不要实现**

### 违规案例（绝对不要这样做）
❌ "Phase 0 状态集成（与现有 state-machine.ts 兼容）"
❌ "添加多代理通信机制"
❌ "实现决策阻止点定位器"
✅ "实现计数器 +1 功能"

`;

  if (previousIssues.length > 0) {
    prompt += `## 上次被否决的问题（必须修复）
${previousIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

请务必修复以上问题后再提交。
`;
  }

  prompt += `
${DEVELOPER_OUTPUT_CONSTRAINTS}

---

## 🏛️ 三维度强制要求（必须全部满足）

### 一、产品深度 (35%) — 核心功能完整性

**P0 必须实现：**
1. **输入验证** - 所有数值操作必须验证：
   - NaN 和 Infinity 检测
   - 负数检测（计数器不能为负）
   - 最大值限制（建议 999999，超出提示错误）

2. **数据导出** - 如果涉及数据，必须提供：
   - CSV 导出功能（含 UI 入口按钮）
   - JSON 导出功能

3. **离线/同步** - 如果涉及网络操作：
   - 客户端同步调度器（串联网络监控、离线存储、重试队列）
   - 冲突解决机制（Last-Write-Wins 或手动合并）

4. **历史记录** - 如果涉及历史：
   - LRU 容量限制（建议最大 1000 条）
   - 自动清理机制

### 二、用户体验 (30%) — 交互友好度

**P0 必须实现：**
1. **操作反馈** - 所有用户操作必须有反馈：
   - Toast 通知（成功/失败/警告三种样式）
   - 加载状态（loading indicator）
   - 错误恢复选项（重试按钮）

2. **键盘导航** - 基础快捷键支持：
   - +/- 或方向键增减
   - R 重置
   - Esc 取消

3. **状态可见性** - 异步操作必须显示：
   - 进度指示器
   - 同步状态提示
   - 上次同步时间

**P1 建议实现：**
4. 亮/暗主题切换
5. 动画过渡效果

### 三、代码质量 (20%) — 可维护性

**P0 必须实现：**
1. **测试文件** - 每个功能模块必须有对应测试：
   - 单元测试（覆盖率 ≥ 80%）
   - 边界条件测试（0、负数、最大值、NaN、Infinity）
   - 测试文件命名：\`*.test.ts\` 或 \`*.spec.ts\`

2. **ID 生成** - 必须使用加密安全方法：
   - ✅ \`crypto.randomUUID()\`
   - ❌ \`Math.random()\` （禁止使用）

3. **输入边界检查** - 所有公共函数必须验证：
   - 参数类型
   - 值范围（0 ≤ x ≤ 999999）
   - NaN/Infinity 检测

**P1 必须实现：**
4. ESLint 配置（.eslintrc.json）
5. Pre-commit hook（lint-staged 或 husky）

**代码示例 - 正确的输入验证：**
\`\`\`typescript
function increment(value: number, step: number = 1): number {
  // 类型验证
  if (typeof value !== 'number' || typeof step !== 'number') {
    throw new Error('Invalid type: value and step must be numbers');
  }
  // NaN/Infinity 检测
  if (!Number.isFinite(value) || !Number.isFinite(step)) {
    throw new Error('Invalid value: must be finite number');
  }
  // 负数检测
  if (value < 0) {
    throw new Error('Invalid value: cannot be negative');
  }
  // 最大值限制
  const MAX_VALUE = 999999;
  const result = value + step;
  return Math.min(result, MAX_VALUE);
}
\`\`\`

**代码示例 - 正确的 ID 生成：**
\`\`\`typescript
// ✅ 正确
import { randomUUID } from 'crypto';
const id = randomUUID();

// ❌ 错误
const id = Math.random().toString(36);
\`\`\`

**代码示例 - 正确的 Toast 反馈：**
\`\`\`typescript
function showToast(message: string, type: 'success' | 'error' | 'warning') {
  const toast = document.createElement('div');
  toast.className = \`toast toast-\${type}\`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
\`\`\`

---

开始实现...
`;

  return prompt;
}

// ============= Supervisor 审查 =============

/**
 * 执行 Supervisor 审查
 */
async function executeSupervisorReview(
  projectDir: string,
  sprint: SprintContract
): Promise<SupervisorReport> {
  console.log(`[Sprint ${sprint.sprintNumber}] Supervisor 开始审查...`);

  const report = await conductSupervisorReview(projectDir, sprint);

  // 保存报告
  const reportDir = join(projectDir, SUPERVISOR_REPORT_DIR);
  mkdirSync(reportDir, { recursive: true });
  const reportFile = join(reportDir, `sprint-${sprint.sprintNumber}-report.json`);
  writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');

  return report;
}

/**
 * 执行完整的 Supervisor 审查流程
 *
 * 添加范围违规检测：
 * - 检测评分与历史评分的异常波动
 * - 防止评分从低分跳到高分（>2分差异）
 * - 防止评分从高分跌到低分（>2分差异）
 */
async function conductSupervisorReview(
  projectDir: string,
  sprint: SprintContract
): Promise<SupervisorReport> {
  // 1. 读取 Developer 创建的文件
  const outputDir = join(projectDir, DEV_OUTPUT_DIR, `sprint-${sprint.sprintNumber}`);
  const fileContents = readCodeFiles(outputDir);

  // 2. 生成审查 Prompt
  const reviewPrompt = buildSupervisorPrompt(sprint, fileContents);

  // 3. 执行审查
  try {
    const systemPrompt = `你是一个**独立质量监督官**，负责审查 Sprint 实现的质量。
请严格按照四维评分标准进行评估，并给出明确的裁决。
评分标准：
- 产品深度 (35%): 核心功能是否完整？是否有惊喜体验？
- 用户体验 (30%): 交互是否流畅？异常处理是否友好？
- 代码质量 (20%): 可读性如何？架构是否合理？是否有测试？
- 安全合规 (15%): 输入验证是否完善？是否有明显安全漏洞？

通过标准：总分 ≥ 8.0 且无单项 < 7.0
否决标准：总分 < 8.0 或任一单项 < 7.0

重要：你审查的是实际代码文件，请给出客观评分，不要默认满分。`;

    const result = await robustSDKCall(
      systemPrompt,
      reviewPrompt,
      {
        maxRetries: 3,
        minOutputLines: 30, // Supervisor 需要足够的分析内容
        onRetry: (attempt, reason) => {
          console.log(`[Sprint ${sprint.sprintNumber}] Supervisor 重试 ${attempt}/3: ${reason}`);
        }
      }
    );

    const output = result.success ? result.output : `审查执行失败: ${result.error?.message || '未知错误'}`;

    // 4. 解析结果
    const report = parseSupervisorOutput(output, sprint);

    // 5. 检测范围违规（评分异常波动）
    const rangeViolationWarnings = detectRangeViolations(report, sprint);
    report.evaluatorBiasWarnings = [
      ...(report.evaluatorBiasWarnings || []),
      ...rangeViolationWarnings
    ];

    return report;

  } catch (error) {
    console.error(`[Sprint ${sprint.sprintNumber}] Supervisor 审查失败:`, error);
    return createErrorReport(sprint, error);
  }
}

/**
 * 检测范围违规 - 评分异常波动检测
 *
 * 防止：
 * - 评分从低分跳到高分（虚假通过）
 * - 评分从高分跌到低分（过度惩罚）
 * - 单项评分超过合理范围（0-10）
 */
function detectRangeViolations(report: SupervisorReport, sprint: SprintContract): string[] {
  const warnings: string[] = [];

  // 读取上次的评分历史
  const historyFile = join(process.cwd(), '.supervisor-reports', 'score-history.json');
  let lastScores: FourDimensionScores | null = null;

  try {
    if (existsSync(historyFile)) {
      const history = JSON.parse(readFileSync(historyFile, 'utf-8'));
      lastScores = history.lastScores;
    }
  } catch {
    // 忽略历史读取失败
  }

  // 检查单项评分范围
  const dimensions: (keyof FourDimensionScores)[] = ['productDepth', 'userExperience', 'codeQuality', 'security'];
  for (const dim of dimensions) {
    const score = report.dimensionScores[dim];
    if (score < 0 || score > 10) {
      warnings.push(`[范围违规] ${dim} 评分 ${score} 超出合理范围 [0-10]`);
    }
  }

  // 检查评分波动
  if (lastScores) {
    for (const dim of dimensions) {
      const current = report.dimensionScores[dim];
      const previous = lastScores[dim];
      const diff = Math.abs(current - previous);

      if (diff > 2.0) {
        warnings.push(`[范围违规] ${dim} 评分波动 ${diff.toFixed(1)} 分（${previous} → ${current}），超过 2 分阈值`);
      }
    }
  }

  // 保存当前评分到历史
  try {
    const historyDir = join(process.cwd(), '.supervisor-reports');
    mkdirSync(historyDir, { recursive: true });
    writeFileSync(historyFile, JSON.stringify({
      lastScores: report.dimensionScores,
      timestamp: new Date().toISOString()
    }, null, 2), 'utf-8');
  } catch {
    // 忽略历史写入失败
  }

  return warnings;
}

/**
 * 读取输出目录中的代码文件
 */
function readCodeFiles(outputDir: string): string {
  if (!existsSync(outputDir)) {
    return '// 无代码文件';
  }

  const files: string[] = [];

  // 递归读取所有 TypeScript 和 JavaScript 文件
  function walkDir(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // 跳过 node_modules 和 .git
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          walkDir(fullPath);
        }
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || entry.name.endsWith('.json')) {
        // 跳过 TASK.md
        if (entry.name === 'TASK.md') continue;

        try {
          const content = readFileSync(fullPath, 'utf-8');
          const relativePath = fullPath.replace(outputDir + '/', '');
          files.push(`=== ${relativePath} ===\n${content}`);
        } catch {
          // 忽略读取失败
        }
      }
    }
  }

  walkDir(outputDir);

  if (files.length === 0) {
    return '// 无代码文件';
  }

  return files.join('\n\n');
}

/**
 * 构建 Supervisor Prompt
 */
function buildSupervisorPrompt(sprint: SprintContract, fileContents: string): string {
  return `
# Sprint ${sprint.sprintNumber} 审查任务

你是**独立质量监督官**，负责审查 Sprint 实现的质量。

## Sprint 合同
### 目标
${sprint.objectives.map(o => `- ${o}`).join('\n')}

### 验收标准
${sprint.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## 实际代码文件

以下是 Developer 实现的实际代码文件，请仔细审查：

${fileContents}

## 你的审查职责

### 1. 功能完整性检查
- [ ] 每个验收标准都被实现了吗？
- [ ] 实现是否符合规格描述？

### 2. 四维评分（必须逐项评分）

**产品深度 (35%)**: 核心功能是否完整？是否有惊喜体验？
- 输入验证（NaN/Infinity/负数/最大值）是否完善？
- 数据导出功能是否有 UI 入口？
- 离线/同步功能是否有冲突解决机制？
- 历史记录是否有容量限制？
评分: X/10

**用户体验 (30%)**: 交互是否流畅？异常处理是否友好？
- 是否有 Toast 通知（成功/失败/警告）？
- 异步操作是否有 loading 状态？
- 是否有错误恢复选项（重试按钮）？
- 是否支持键盘快捷键？
评分: X/10

**代码质量 (20%)**: 可读性如何？架构是否合理？是否有测试？
- 是否有测试文件（*.test.ts 或 *.spec.ts）？
- 测试覆盖率是否 ≥ 80%？
- 是否使用 crypto.randomUUID() 而非 Math.random()？
- 是否有 ESLint 配置？
- 是否有 pre-commit hook？
评分: X/10

**安全合规 (15%)**: 输入验证是否完善？是否有明显安全漏洞？
- CORS 配置是否合理（禁止 *）？
- 是否有硬编码密钥（JWT_SECRET 等）？
- 是否有 SQL/XSS 注入风险？
评分: X/10

### 3. 发现的问题
列出所有发现的问题（如果有）：

### 4. 强制检查清单（任一项不满足直接扣分）

| 检查项 | 要求 | 扣分 |
|--------|------|------|
| 输入验证 | 必须有 NaN/Infinity/负数/最大值检测 | -1.0/项 |
| Toast 反馈 | 必须有成功/失败/警告三种通知 | -1.0 |
| Loading 状态 | 异步操作必须有加载指示器 | -0.5 |
| 测试覆盖 | 必须有测试文件，覆盖率 ≥ 80% | -2.0 |
| 安全 ID | 必须使用 crypto.randomUUID() | -1.0 |
| 文档 | 必须有 README.md 或使用说明 | -0.5 |

### 5. 裁决
- 总分 = 产品深度×0.35 + 用户体验×0.30 + 代码质量×0.20 + 安全×0.15
- **通过**: 总分 ≥ 8.0 且无单项 < 7.0
- **否决**: 总分 < 8.0 或任一单项 < 7.0
- **回滚**: 核心功能严重劣化

裁决: [APPROVED / REJECTED / ROLLBACK]

请严格按照以上标准评分，不要过度宽容。
`;
}

/**
 * 解析 Supervisor 输出
 */
function parseSupervisorOutput(output: string, sprint: SprintContract): SupervisorReport {
  // 尝试从输出中提取内容
  let content = output.trim();

  // 如果输出是 JSON 数组，尝试提取 result
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed)) {
        // 找到最后一个有 result 字段的消息
        for (let i = parsed.length - 1; i >= 0; i--) {
          if (parsed[i].result) {
            content = String(parsed[i].result);
            break;
          }
          if (parsed[i].content) {
            if (typeof parsed[i].content === 'string') {
              content = parsed[i].content;
            } else if (Array.isArray(parsed[i].content)) {
              // 找到 text 类型的内容
              for (const block of parsed[i].content) {
                if (block.type === 'text') {
                  content = block.text;
                  break;
                }
              }
            }
            break;
          }
        }
      } else if (parsed.content) {
        content = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content);
      } else if (parsed.result) {
        content = String(parsed.result);
      }
    }
  } catch {
    // 不是 JSON，使用原始输出
    content = output.trim();
  }

  // 简单解析 - 提取评分和裁决
  const scores = extractScores(content);
  const issues = extractIssues(content);

  // 根据分数计算裁决（强制覆盖文本提取的裁决）
  const totalScore = calculateTotalScore(scores);
  const minDimensionScore = Math.min(
    scores.productDepth,
    scores.userExperience,
    scores.codeQuality,
    scores.security
  );

  let verdict: SupervisorVerdict;
  if (totalScore >= PASS_THRESHOLD && minDimensionScore >= MIN_DIMENSION_THRESHOLD) {
    verdict = 'APPROVED';
  } else if (totalScore < 3.0 || minDimensionScore < 3.0) {
    // 分数过低，可能是严重退化，执行回滚
    verdict = 'ROLLBACK';
  } else {
    verdict = 'REJECTED';
  }

  return {
    verdict,
    totalScore,
    dimensionScores: scores,
    issues,
    evaluatorBiasWarnings: detectBiasWarnings(content)
  };
}

/**
 * 提取评分
 */
function extractScores(content: string): FourDimensionScores {
  const scores: FourDimensionScores = {
    productDepth: 0,
    userExperience: 0,
    codeQuality: 0,
    security: 0
  };

  // 如果明确说"所有单项均 ≥ 7.0"或类似表述，给 7 分
  if (/所有单项均\s*[≥>=]\s*7/.test(content)) {
    return {
      productDepth: 7,
      userExperience: 7,
      codeQuality: 7,
      security: 7
    };
  }

  // 尝试多种匹配模式（支持中文冒号、全角冒号、直接冒号等）
  const dimensionPatterns: [keyof FourDimensionScores, RegExp][] = [
    ['productDepth', /(?:产品深度|Product Depth)[：:\s]*(\d+(?:\.\d+)?)\s*[/\／]\s*10/i],
    ['userExperience', /(?:用户体验|User Experience)[：:\s]*(\d+(?:\.\d+)?)\s*[/\／]\s*10/i],
    ['codeQuality', /(?:代码质量|Code Quality)[：:\s]*(\d+(?:\.\d+)?)\s*[/\／]\s*10/i],
    ['security', /(?:安全|Security)[：:\s]*(\d+(?:\.\d+)?)\s*[/\／]\s*10/i]
  ];

  for (const [key, pattern] of dimensionPatterns) {
    const match = content.match(pattern);
    if (match) {
      scores[key] = parseFloat(match[1]);
    }
  }

  // 如果所有分数都是 0，尝试直接从 "X/10" 模式提取（兜底）
  if (scores.productDepth === 0 && scores.userExperience === 0 &&
      scores.codeQuality === 0 && scores.security === 0) {
    const allScores = content.matchAll(/(\d+(?:\.\d+)?)\s*[/\／]\s*10/g);
    const foundScores = Array.from(allScores).map(m => parseFloat(m[1]));
    if (foundScores.length >= 4) {
      // 按出现顺序分配
      scores.productDepth = foundScores[0];
      scores.userExperience = foundScores[1];
      scores.codeQuality = foundScores[2];
      scores.security = foundScores[3];
    }
  }

  // 默认值（如果解析失败）
  if (scores.productDepth === 0) scores.productDepth = 5;
  if (scores.userExperience === 0) scores.userExperience = 5;
  if (scores.codeQuality === 0) scores.codeQuality = 5;
  if (scores.security === 0) scores.security = 5;

  return scores;
}

/**
 * 提取裁决
 */
function extractVerdict(content: string): SupervisorVerdict {
  if (/APPROVED|通过|批准/i.test(content)) {
    return 'APPROVED';
  }
  if (/ROLLBACK|回滚/i.test(content)) {
    return 'ROLLBACK';
  }
  if (/REJECTED|否决|拒绝/i.test(content)) {
    return 'REJECTED';
  }
  return 'REJECTED'; // 默认否决
}

/**
 * 提取问题列表
 */
function extractIssues(content: string): string[] {
  const issues: string[] = [];
  const lines = content.split('\n');

  let inIssuesSection = false;
  for (const line of lines) {
    if (/问题|issues?|found|发现/.test(line)) {
      inIssuesSection = true;
    }
    if (inIssuesSection && /^\d+\./.test(line.trim())) {
      issues.push(line.replace(/^\d+\.\s*/, '').trim());
    }
  }

  return issues;
}

/**
 * 检测评估器偏差
 */
function detectBiasWarnings(content: string): string[] {
  const warnings: string[] = [];

  // 过度宽容偏差
  if (/\d+.*?分.*?(不错|很好|优秀|完美)/i.test(content)) {
    warnings.push('发现疑似过度宽容的评价');
  }

  // 0 问题偏差
  if (/没问题|无问题|一切正常|都很好/i.test(content) && !/但|然而/.test(content)) {
    warnings.push('评估报告未发现任何问题，可能存在偏差');
  }

  // 模糊措辞
  if (/基本正常|基本可用|大体不错/i.test(content)) {
    warnings.push('使用了模糊措辞"基本正常/基本可用"');
  }

  return warnings;
}

/**
 * 计算总分
 */
function calculateTotalScore(scores: FourDimensionScores): number {
  return (
    scores.productDepth * SCORE_WEIGHTS.productDepth +
    scores.userExperience * SCORE_WEIGHTS.userExperience +
    scores.codeQuality * SCORE_WEIGHTS.codeQuality +
    scores.security * SCORE_WEIGHTS.security
  );
}

/**
 * 创建错误报告
 */
function createErrorReport(sprint: SprintContract, error: unknown): SupervisorReport {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    verdict: 'REJECTED',
    totalScore: 0,
    dimensionScores: {
      productDepth: 0,
      userExperience: 0,
      codeQuality: 0,
      security: 0
    },
    issues: [`审查执行失败: ${errorMessage}`],
    evaluatorBiasWarnings: ['审查过程出错']
  };
}

// ============= Sprint 执行（带分离） =============

/**
 * 执行完整的 Sprint（带 Developer-Supervisor 分离）
 */
export async function executeSprintWithSeparation(
  projectDir: string,
  sprint: SprintContract,
  previousIssues: string[] = []
): Promise<SupervisorReport> {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`执行 Sprint ${sprint.sprintNumber}（带 Developer-Supervisor 分离）`);
  console.log(`${'='.repeat(50)}\n`);

  // PHASE 1: Developer 实现（Supervisor 不可见）
  await executeDeveloperSprint(projectDir, sprint, previousIssues);

  // PHASE 2: Supervisor 审查（Developer 不可见审查过程）
  const report = await executeSupervisorReview(projectDir, sprint);

  // PHASE 3: 处理裁决
  console.log(`\n[Sprint ${sprint.sprintNumber}] 裁决: ${report.verdict}`);
  console.log(`[Sprint ${sprint.sprintNumber}] 总分: ${report.totalScore.toFixed(1)}/10`);
  console.log(`[Sprint ${sprint.sprintNumber}] 产品深度: ${report.dimensionScores.productDepth}/10`);
  console.log(`[Sprint ${sprint.sprintNumber}] 用户体验: ${report.dimensionScores.userExperience}/10`);
  console.log(`[Sprint ${sprint.sprintNumber}] 代码质量: ${report.dimensionScores.codeQuality}/10`);
  console.log(`[Sprint ${sprint.sprintNumber}] 安全合规: ${report.dimensionScores.security}/10`);

  if (report.issues.length > 0) {
    console.log(`\n[Sprint ${sprint.sprintNumber}] 发现问题:`);
    report.issues.forEach((issue, i) => {
      console.log(`  ${i + 1}. ${issue}`);
    });
  }

  if (report.evaluatorBiasWarnings && report.evaluatorBiasWarnings.length > 0) {
    console.log(`\n[Sprint ${sprint.sprintNumber}] 评估偏差警告:`);
    report.evaluatorBiasWarnings.forEach((warning) => {
      console.log(`  ⚠️ ${warning}`);
    });
  }

  console.log(`${'='.repeat(50)}\n`);

  return report;
}

/**
 * 执行多个 Sprint
 */
export async function executeSprintPlan(
  projectDir: string,
  spec: ProductSpec,
  maxRetries: number = MAX_RETRY_PER_SPRINT
): Promise<SupervisorReport[]> {
  const results: SupervisorReport[] = [];

  // 防御性检查：确保 sprintPlan 存在且是数组
  if (!spec?.sprintPlan || !Array.isArray(spec.sprintPlan) || spec.sprintPlan.length === 0) {
    console.error('[Phase 2] 错误: sprintPlan 为空或无效，将使用默认 Sprint');
    const defaultSprint: SprintContract = {
      sprintNumber: 1,
      objectives: ['实现基础功能'],
      acceptanceCriteria: ['功能可运行'],
      estimatedDuration: '1-2小时',
      technicalConstraints: []
    };
    const report = await executeSprintWithSeparation(projectDir, defaultSprint, []);
    results.push(report);
    return results;
  }

  for (const sprint of spec.sprintPlan) {
    let retryCount = 0;
    let lastReport: SupervisorReport | null = null;

    while (retryCount < maxRetries) {
      const previousIssues = lastReport?.issues || [];

      const report = await executeSprintWithSeparation(
        projectDir,
        sprint,
        previousIssues
      );

      lastReport = report;
      results.push(report);

      if (report.verdict === 'APPROVED') {
        console.log(`[Sprint ${sprint.sprintNumber}] ✅ 通过!\n`);
        break;
      } else if (report.verdict === 'ROLLBACK') {
        console.log(`[Sprint ${sprint.sprintNumber}] ⚠️ 需要回滚`);
        // 创建快照并执行回滚
        await createSnapshot(
          projectDir,
          sprint.sprintNumber,
          'Supervisor ROLLBACK 裁决',
          report.totalScore,
          report.issues
        );
        await handleRollback(projectDir, sprint.sprintNumber, {
          issues: report.issues,
          totalScore: report.totalScore
        });
        break;
      } else {
        retryCount++;
        if (retryCount < maxRetries) {
          console.log(`[Sprint ${sprint.sprintNumber}] ❌ 否决，修复后重试 (${retryCount}/${maxRetries})\n`);
        } else {
          console.log(`[Sprint ${sprint.sprintNumber}] ❌ 超过最大重试次数，强制结束\n`);
        }
      }
    }
  }

  return results;
}

// ============= 工具函数 =============

/**
 * 使用 Anthropic SDK 执行消息
 */
async function execClaudeSDK(
  systemPrompt: string,
  userMessage: string,
  timeout: number = 300000 // 5 分钟默认超时
): Promise<string> {
  const anthropic = new Anthropic();

  // 计算最大 token 数（留出空间给响应）
  const maxTokens = 8192;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userMessage
      }
    ]
  });

  // 提取响应文本
  const text = response.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text' || !text.text) {
    // 如果没有文本响应，尝试返回整个响应的字符串表示
    const contentStr = JSON.stringify(response.content);
    if (contentStr && contentStr !== '[{"type":"text","text":""}]') {
      return contentStr;
    }
    throw new Error('No text response received');
  }

  return text.text;
}

/**
 * 执行 Claude Code CLI 命令（仅用于简单回退）
 */
async function execClaudeCode(args: string[], timeout: number = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
