/**
 * Developer-Supervisor Separation - 开发/监督分离机制
 *
 * 确保 developer 和 supervisor 真正分离：
 * - developer: 实现代码，不可见 supervisor
 * - supervisor: 只看输出结果，有一票否决权
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type {
  SprintContract,
  SupervisorReport,
  SupervisorVerdict,
  FourDimensionScores,
  ProductSpec
} from './types.js';
import { handleRollback, createSnapshot } from './rollback-manager.js';

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

  // 创建输出目录
  const outputDir = join(projectDir, DEV_OUTPUT_DIR, `sprint-${sprint.sprintNumber}`);
  mkdirSync(outputDir, { recursive: true });

  // 构造 Developer prompt
  const prompt = buildDeveloperPrompt(sprint, previousIssues);

  // 写入 prompt 文件
  const promptFile = join(outputDir, 'TASK.md');
  writeFileSync(promptFile, prompt, 'utf-8');

  try {
    // 使用 Claude Code 执行开发
    await execClaudeCode(
      [
        '--print',
        prompt
      ],
      600000 // 10 分钟超时
    );

    console.log(`[Sprint ${sprint.sprintNumber}] Developer 完成`);
  } catch (error) {
    console.error(`[Sprint ${sprint.sprintNumber}] Developer 执行失败:`, error);
    throw error;
  }
}

/**
 * 构建 Developer Prompt
 */
function buildDeveloperPrompt(sprint: SprintContract, previousIssues: string[]): string {
  let prompt = `# Sprint ${sprint.sprintNumber} 开发任务

## Sprint 目标
${sprint.objectives.map(o => `- ${o}`).join('\n')}

## 验收标准
${sprint.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## 技术约束
${sprint.technicalConstraints.map(c => `- ${c}`).join('\n')}

## 开发要求
1. 严格按照验收标准实现功能
2. 确保代码可运行，无编译错误
3. 包含必要的测试
4. 更新相关文档

`;

  if (previousIssues.length > 0) {
    prompt += `## 上次被否决的问题（必须修复）
${previousIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

请务必修复以上问题后再提交。
`;
  }

  prompt += `
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
 */
async function conductSupervisorReview(
  projectDir: string,
  sprint: SprintContract
): Promise<SupervisorReport> {
  // 1. 生成审查 Prompt
  const reviewPrompt = buildSupervisorPrompt(sprint);

  // 2. 执行审查
  try {
    const output = await execClaudeCode(
      [
        '--print',
        reviewPrompt
      ],
      600000 // 10 分钟超时
    );

    // 3. 解析结果
    return parseSupervisorOutput(output, sprint);

  } catch (error) {
    console.error(`[Sprint ${sprint.sprintNumber}] Supervisor 审查失败:`, error);
    return createErrorReport(sprint, error);
  }
}

/**
 * 构建 Supervisor Prompt
 */
function buildSupervisorPrompt(sprint: SprintContract): string {
  return `
# Sprint ${sprint.sprintNumber} 审查任务

你是**独立质量监督官**，负责审查 Sprint 实现的质量。

## Sprint 合同
### 目标
${sprint.objectives.map(o => `- ${o}`).join('\n')}

### 验收标准
${sprint.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## 你的审查职责

### 1. 功能完整性检查
- [ ] 每个验收标准都被实现了吗？
- [ ] 实现是否符合规格描述？

### 2. 四维评分（必须逐项评分）

**产品深度 (35%)**: 核心功能是否完整？是否有惊喜体验？
评分: X/10

**用户体验 (30%)**: 交互是否流畅？异常处理是否友好？
评分: X/10

**代码质量 (20%)**: 可读性如何？架构是否合理？是否有测试？
评分: X/10

**安全合规 (15%)**: 输入验证是否完善？是否有明显安全漏洞？
评分: X/10

### 3. 发现的问题
列出所有发现的问题（如果有）：

### 4. 裁决
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
  const verdict = extractVerdict(content);
  const issues = extractIssues(content);

  return {
    verdict,
    totalScore: calculateTotalScore(scores),
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

  // 简单的正则匹配
  const patterns: [keyof FourDimensionScores, RegExp][] = [
    ['productDepth', /产品深度.*?(\d+)\/10/i],
    ['userExperience', /用户体验.*?(\d+)\/10/i],
    ['codeQuality', /代码质量.*?(\d+)\/10/i],
    ['security', /安全.*?(\d+)\/10/i]
  ];

  for (const [key, pattern] of patterns) {
    const match = content.match(pattern);
    if (match) {
      scores[key] = parseInt(match[1], 10);
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
 * 执行 Claude Code CLI 命令
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
