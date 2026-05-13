/**
 * Evidence Guard — 确保 Evaluator 只收到 CodeExecutor 证据而非 Generator 原始输出
 * 
 * P0-3: 上下文隔离硬编码
 * P0-5: Generator→CodeExecutor→Evaluator 强制网关
 * 
 * 借鉴:
 *   - OpenHarness Coordinator: "Verifier spawns fresh" + Worker 上下文隔离
 *   - Langroid ChatDocument parent chain 过滤
 */

// ============ 证据完整性检查 ============

export interface EvidenceCheckResult {
  valid: boolean;
  reason: string;
  hasCodeExecutorSignature: boolean;
  hasRawCodeBlocks: boolean;
  hasCriteriaEvidence: boolean;
}

/**
 * 检查证据是否合法（来自 CodeExecutor 而非 Generator 原始输出）
 * 
 * 合法证据应包含:
 * - CodeExecutor 特征标记 (文件列表、验证结果、模块评分)
 * - 不含原始代码块 (```typescript, ```html)
 */
export function validateEvidence(evidence: string): EvidenceCheckResult {
  if (!evidence || evidence.length < 50) {
    return {
      valid: false,
      reason: '证据过短 (<50字符)，疑似未通过 CodeExecutor',
      hasCodeExecutorSignature: false,
      hasRawCodeBlocks: false,
      hasCriteriaEvidence: false,
    };
  }

  // CodeExecutor 特征检测
  const hasCodeExecutorSignature = 
    /文件列表|filesExtracted|代码文件列表|模块名|模块深度|depthScore/i.test(evidence) ||
    /验证结果|verification|验收标准|criteriaCheck|test.*✅|build.*✅|typeCheck/i.test(evidence);

  // 原始代码块检测
  const codeBlockCount = (evidence.match(/```(typescript|javascript|html|python|css|jsx|tsx)/g) || []).length;
  const hasRawCodeBlocks = codeBlockCount > 2; // 少量引用可以，但 >2 可能是整个 Generator 输出

  // 验收标准证据检测
  const hasCriteriaEvidence = 
    /PASS|✅|✓|通过|FAIL|❌|✗|失败/i.test(evidence) ||
    /验收|criteria|标准|满足/i.test(evidence);

  const valid = hasCodeExecutorSignature && !hasRawCodeBlocks;

  let reason = '';
  if (!hasCodeExecutorSignature) {
    reason = '缺失 CodeExecutor 特征（文件列表/验证结果/模块评分）';
  } else if (hasRawCodeBlocks) {
    reason = `证据含 ${codeBlockCount} 个原始代码块，疑似 Generator 输出未被 CodeExecutor 过滤`;
  } else {
    reason = 'OK';
  }

  return {
    valid,
    reason,
    hasCodeExecutorSignature,
    hasRawCodeBlocks,
    hasCriteriaEvidence,
  };
}

/**
 * 从证据中剥离可能的 Generator 原始输出
 * 只保留 CodeExecutor 相关部分
 */
export function sanitizeEvidence(evidence: string): string {
  // 移除大段代码块（保留 CodeExecutor 的输出部分）
  let sanitized = evidence;
  
  // 1. 移除纯代码块（```language ... ```）但保留验证输出
  sanitized = sanitized.replace(/```[a-z]*\n[\s\S]*?```/g, (match) => {
    // 如果代码块内包含验证信息，保留
    if (/✅|❌|PASS|FAIL|测试结果|验证|build.*(success|failure)/i.test(match)) {
      return match; // 保留验证输出性质的代码块
    }
    return '[代码块已移除]';
  });

  // 2. 如果证据太短（<50），返回原始
  if (sanitized.length < 50) return evidence;

  return sanitized;
}

// ============ CodeExecutor 签名要求 ============

/** CodeExecutor 输出必须包含这些特征之一 */
export const REQUIRED_EVIDENCE_MARKERS = [
  /文件列表/,
  /验证结果/,
  /验收标准.*PASS/,
  /test.*✅/,
  /build.*✅/,
];

/**
 * 快速检查：证据中是否有 CodeExecutor 签名
 * 用于 CEO 在调用 Evaluator 前的预检查
 */
export function hasCodeExecutorSignature(evidence: string): boolean {
  return REQUIRED_EVIDENCE_MARKERS.some(p => p.test(evidence));
}
