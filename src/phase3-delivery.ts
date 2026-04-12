/**
 * Phase 3 Delivery - 交付阶段集成
 *
 * 集成 ship, canary, document-release 技能
 * 实现自动部署、监控验证、文档更新
 */

import { spawn } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { DeploymentResult, CanaryReport, HarnessState } from './types.js';

// ============= 常量 =============

const DEPLOYMENT_TIMEOUT = 300000; // 5 分钟
const CANARY_TIMEOUT = 600000; // 10 分钟
const DOCUMENT_TIMEOUT = 120000; // 2 分钟

// ============= 部署结果类型 =============

export interface DeliveryResult {
  deployment: DeploymentResult;
  canary: CanaryReport | null;
  documentation: {
    success: boolean;
    outputPath?: string;
    error?: string;
  };
}

// ============= Ship 部署 =============

/**
 * 调用 ship skill 进行部署
 */
export async function executeShip(
  projectDir: string,
  autoConfirm: boolean = true
): Promise<DeploymentResult> {
  console.log('[Phase 3] 执行 ship 部署...');

  const timestamp = new Date().toISOString();

  try {
    // 检查是否有部署配置
    const hasDeployConfig = await checkDeployConfig(projectDir);

    if (!hasDeployConfig) {
      console.log('[Phase 3] 未检测到部署配置，跳过实际部署');
      return {
        success: true,
        deployedUrl: 'local://development',
        timestamp
      };
    }

    // 调用 Claude Code CLI 执行 ship skill
    const args = [
      'skill',
      'invoke',
      'ship'
    ];

    const output = await execClaudeCodeWithTimeout(projectDir, args, DEPLOYMENT_TIMEOUT);

    // 解析部署结果
    const deployedUrl = extractDeployUrl(output);

    console.log(`[Phase 3] 部署成功: ${deployedUrl}`);

    return {
      success: true,
      deployedUrl: deployedUrl || 'deployed',
      timestamp
    };

  } catch (error) {
    console.error('[Phase 3] 部署失败:', error);

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp
    };
  }
}

/**
 * 检查部署配置
 */
async function checkDeployConfig(projectDir: string): Promise<boolean> {
  const configFiles = [
    'vercel.json',
    'netlify.toml',
    'render.yaml',
    'Dockerfile',
    'docker-compose.yml',
    'fly.toml',
    '.github/workflows/deploy.yml'
  ];

  for (const file of configFiles) {
    if (existsSync(join(projectDir, file))) {
      console.log(`[Phase 3] 检测到部署配置: ${file}`);
      return true;
    }
  }

  return false;
}

/**
 * 从输出中提取部署 URL
 */
function extractDeployUrl(output: string): string | null {
  // 匹配常见部署 URL 格式
  const patterns = [
    /https?:\/\/[^\s]+/,
    /deployed to (.+)/i,
    /deployment URL: (.+)/i,
    /preview: (.+)/i
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }

  return null;
}

// ============= Canary 监控 =============

/**
 * 调用 canary skill 进行监控验证
 */
export async function executeCanary(
  projectDir: string,
  deployedUrl: string,
  durationMinutes: number = 5
): Promise<CanaryReport> {
  console.log(`[Phase 3] 执行 canary 监控 (${durationMinutes} 分钟)...`);

  const timestamp = new Date().toISOString();

  try {
    // 如果是本地部署，跳过 canary
    if (deployedUrl.startsWith('local://')) {
      console.log('[Phase 3] 本地部署，跳过 canary 监控');
      return {
        healthy: true,
        metrics: {
          latency: 0,
          errorRate: 0,
          uptime: 100
        },
        warnings: ['本地部署，跳过外部监控'],
        timestamp
      };
    }

    // 调用 canary skill
    const output = await execClaudeCodeWithTimeout(
      projectDir,
      [
        'skill',
        'invoke',
        'canary',
        '--url', deployedUrl,
        '--duration', String(durationMinutes)
      ],
      CANARY_TIMEOUT
    );

    // 解析 canary 报告
    const report = parseCanaryOutput(output, timestamp);

    console.log(`[Phase 3] Canary 报告: healthy=${report.healthy}`);

    return report;

  } catch (error) {
    console.error('[Phase 3] Canary 监控失败:', error);

    return {
      healthy: false,
      metrics: {},
      warnings: [`监控执行失败: ${error instanceof Error ? error.message : String(error)}`],
      timestamp
    };
  }
}

/**
 * 解析 canary 输出
 */
function parseCanaryOutput(output: string, timestamp: string): CanaryReport {
  const report: CanaryReport = {
    healthy: true,
    metrics: {},
    warnings: [],
    timestamp
  };

  // 提取延迟
  const latencyMatch = output.match(/latency[:\s]+(\d+)/i);
  if (latencyMatch) {
    report.metrics.latency = parseInt(latencyMatch[1], 10);
  }

  // 提取错误率
  const errorMatch = output.match(/error[_\s]rate[:\s]+(\d+(?:\.\d+)?)/i);
  if (errorMatch) {
    report.metrics.errorRate = parseFloat(errorMatch[1]);
  }

  // 提取可用性
  const uptimeMatch = output.match(/uptime[:\s]+(\d+(?:\.\d+)?)/i);
  if (uptimeMatch) {
    report.metrics.uptime = parseFloat(uptimeMatch[1]);
  }

  // 检测警告
  if (output.includes('warning') || output.includes(' WARN ')) {
    report.warnings.push('监控发现潜在问题');
  }

  if (output.includes('error') || output.includes(' ERROR ')) {
    report.healthy = false;
    report.warnings.push('监控发现错误');
  }

  // 判断健康状态
  if (report.metrics.errorRate && report.metrics.errorRate > 5) {
    report.healthy = false;
    report.warnings.push('错误率超过 5%');
  }

  if (report.metrics.latency && report.metrics.latency > 2000) {
    report.warnings.push('延迟超过 2 秒');
  }

  return report;
}

// ============= Document Release =============

/**
 * 调用 document-release skill 更新文档
 */
export async function executeDocumentRelease(
  projectDir: string
): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  console.log('[Phase 3] 执行 document-release...');

  try {
    // 检查是否有文档需要更新
    const hasDocs = await checkDocumentation(projectDir);

    if (!hasDocs) {
      console.log('[Phase 3] 未检测到需要更新的文档');
      return { success: true };
    }

    // 调用 document-release skill
    const output = await execClaudeCodeWithTimeout(
      projectDir,
      [
        'skill',
        'invoke',
        'document-release'
      ],
      DOCUMENT_TIMEOUT
    );

    // 提取文档路径
    const outputPath = extractDocPath(output);

    console.log(`[Phase 3] 文档更新成功: ${outputPath || '已完成'}`);

    return {
      success: true,
      outputPath: outputPath || join(projectDir, 'README.md')
    };

  } catch (error) {
    console.error('[Phase 3] 文档更新失败:', error);

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 检查文档
 */
async function checkDocumentation(projectDir: string): Promise<boolean> {
  const docFiles = [
    'README.md',
    'CHANGELOG.md',
    'docs/',
    'CONTRIBUTING.md'
  ];

  for (const file of docFiles) {
    if (existsSync(join(projectDir, file))) {
      return true;
    }
  }

  return false;
}

/**
 * 从输出中提取文档路径
 */
function extractDocPath(output: string): string | null {
  const match = output.match(/documentation[:\s]+(.+)/i) ||
                 output.match(/updated[:\s]+(.+\.md)/i);

  return match ? match[1].trim() : null;
}

// ============= 完整交付流程 =============

/**
 * 执行完整 Phase 3 交付流程
 */
export async function executePhase3Delivery(
  state: HarnessState,
  projectDir: string
): Promise<DeliveryResult> {
  console.log(`\n${'='.repeat(50)}`);
  console.log('Phase 3: 交付阶段');
  console.log(`${'='.repeat(50)}\n`);

  // 确保输出目录存在
  const outputDir = join(projectDir, '.phase3-output');
  mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString();

  // 1. 部署
  const deployment = await executeShip(projectDir, state.convergenceStatus.shouldStop === false);

  // 保存部署结果
  writeFileSync(
    join(outputDir, 'deployment.json'),
    JSON.stringify(deployment, null, 2),
    'utf-8'
  );

  // 2. Canary 监控
  let canaryReport: CanaryReport | null = null;
  if (deployment.success && deployment.deployedUrl) {
    canaryReport = await executeCanary(
      projectDir,
      deployment.deployedUrl,
      5 // 默认 5 分钟监控
    );

    // 保存 canary 结果
    writeFileSync(
      join(outputDir, 'canary.json'),
      JSON.stringify(canaryReport, null, 2),
      'utf-8'
    );
  }

  // 3. 文档更新
  const documentation = await executeDocumentRelease(projectDir);

  // 保存文档结果
  writeFileSync(
    join(outputDir, 'documentation.json'),
    JSON.stringify(documentation, null, 2),
    'utf-8'
  );

  // 生成最终报告
  const result: DeliveryResult = {
    deployment,
    canary: canaryReport,
    documentation
  };

  writeFileSync(
    join(outputDir, 'delivery-result.json'),
    JSON.stringify(result, null, 2),
    'utf-8'
  );

  console.log(`\n${'='.repeat(50)}`);
  console.log('Phase 3 交付完成');
  console.log(`部署状态: ${deployment.success ? '成功' : '失败'}`);
  if (canaryReport) {
    console.log(`健康状态: ${canaryReport.healthy ? '健康' : '异常'}`);
  }
  console.log(`文档更新: ${documentation.success ? '成功' : '失败'}`);
  console.log(`${'='.repeat(50)}\n`);

  return result;
}

// ============= 工具函数 =============

/**
 * 执行 Claude Code CLI 命令（带超时）
 */
async function execClaudeCodeWithTimeout(
  cwd: string,
  args: string[],
  timeout: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd // 在正确的目录执行
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
      reject(new Error(`Command timed out after ${timeout}ms: claude ${args.join(' ')}`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || stdout.includes('completed successfully')) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
