/**
 * Convergence Detector Tests - 收敛检测测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectConvergence,
  createSnapshot,
  hasValueImprovement,
  getNextActionAdvice,
  generateIterationSummary
} from '../convergence-detector.js';
import type { IterationSnapshot, SupervisorReport } from '../types.js';

/**
 * Helper to create snapshot with explicit valueImprovement
 */
function makeSnapshot(iteration: number, valueImprovement: boolean): IterationSnapshot {
  return createSnapshot(
    iteration,
    {
      verdict: 'APPROVED',
      totalScore: 7,
      dimensionScores: {
        productDepth: 7,
        userExperience: 7,
        codeQuality: 7,
        security: 7
      },
      issues: []
    },
    valueImprovement
  );
}

describe('Convergence Detector', () => {
  describe('detectConvergence', () => {
    it('should return STOP when user says stop', () => {
      const result = detectConvergence([], '停止', 0);

      expect(result.signal).toBe('STOP');
      expect(result.reason).toBe('用户明确要求停止');
    });

    it('should return STOP for various stop keywords', () => {
      const keywords = ['停止', '停', 'stop', '结束', 'exit', 'quit', '满意了', '够了'];

      keywords.forEach(keyword => {
        const result = detectConvergence([], keyword, 0);
        expect(result.signal).toBe('STOP');
      });
    });

    it('should return ROLLBACK when score degrades significantly', () => {
      const history: IterationSnapshot[] = [
        createSnapshot(1, { verdict: 'APPROVED', totalScore: 8, dimensionScores: { productDepth: 8, userExperience: 8, codeQuality: 8, security: 8 }, issues: [] }, true),
        createSnapshot(2, { verdict: 'REJECTED', totalScore: 5, dimensionScores: { productDepth: 5, userExperience: 5, codeQuality: 5, security: 5 }, issues: [] }, false)
      ];

      const result = detectConvergence(history, '', 0);

      expect(result.signal).toBe('ROLLBACK');
    });

    it('should return EXPLORE after 2 consecutive no improvement', () => {
      // First snapshot: valueImprovement = true (initial)
      // Second and third: valueImprovement = false (no improvement)
      const history: IterationSnapshot[] = [
        makeSnapshot(1, true),
        makeSnapshot(2, false),
        makeSnapshot(3, false)
      ];

      const result = detectConvergence(history, '', 0);

      expect(result.signal).toBe('EXPLORE');
      expect(result.consecutiveNoImprovement).toBeGreaterThanOrEqual(2);
    });

    it('should return STOP after 2 EXPLORE with no improvement', () => {
      const history: IterationSnapshot[] = [
        createSnapshot(1, { verdict: 'APPROVED', totalScore: 7, dimensionScores: { productDepth: 7, userExperience: 7, codeQuality: 7, security: 7 }, issues: [] }, false),
        createSnapshot(2, { verdict: 'APPROVED', totalScore: 7, dimensionScores: { productDepth: 7, userExperience: 7, codeQuality: 7, security: 7 }, issues: [] }, false)
      ];

      const result = detectConvergence(history, '', 2);

      expect(result.signal).toBe('STOP');
    });

    it('should return STOP when score is near perfect', () => {
      const history: IterationSnapshot[] = [
        createSnapshot(1, { verdict: 'APPROVED', totalScore: 9.6, dimensionScores: { productDepth: 9.5, userExperience: 9.5, codeQuality: 9.5, security: 9.5 }, issues: [] }, true)
      ];

      const result = detectConvergence(history, '', 0);

      expect(result.signal).toBe('STOP');
      expect(result.reason).toContain('接近完美');
    });

    it('should return CONTINUE for normal iteration', () => {
      const history: IterationSnapshot[] = [
        createSnapshot(1, { verdict: 'APPROVED', totalScore: 6, dimensionScores: { productDepth: 6, userExperience: 6, codeQuality: 6, security: 6 }, issues: [] }, true),
        createSnapshot(2, { verdict: 'APPROVED', totalScore: 7, dimensionScores: { productDepth: 7, userExperience: 7, codeQuality: 7, security: 7 }, issues: [] }, true)
      ];

      const result = detectConvergence(history, '', 0);

      expect(result.signal).toBe('CONTINUE');
    });
  });

  describe('createSnapshot', () => {
    it('should create snapshot with correct values', () => {
      const report: SupervisorReport = {
        verdict: 'APPROVED',
        totalScore: 8.5,
        dimensionScores: {
          productDepth: 9,
          userExperience: 8,
          codeQuality: 8,
          security: 8
        },
        issues: []
      };

      const snapshot = createSnapshot(1, report, true);

      expect(snapshot.iteration).toBe(1);
      expect(snapshot.totalScore).toBe(8.5);
      expect(snapshot.dimensionScores.productDepth).toBe(9);
      expect(snapshot.valueImprovement).toBe(true);
      expect(snapshot.verdict).toBe('APPROVED');
    });
  });

  describe('hasValueImprovement', () => {
    it('should return true for first snapshot', () => {
      const current = createSnapshot(1, { verdict: 'APPROVED', totalScore: 5, dimensionScores: { productDepth: 5, userExperience: 5, codeQuality: 5, security: 5 }, issues: [] }, true);
      const previous = null;

      expect(hasValueImprovement(current, previous)).toBe(true);
    });

    it('should return true when score increases', () => {
      const current = createSnapshot(2, { verdict: 'APPROVED', totalScore: 7, dimensionScores: { productDepth: 7, userExperience: 7, codeQuality: 7, security: 7 }, issues: [] }, true);
      const previous = createSnapshot(1, { verdict: 'APPROVED', totalScore: 6, dimensionScores: { productDepth: 6, userExperience: 6, codeQuality: 6, security: 6 }, issues: [] }, true);

      expect(hasValueImprovement(current, previous)).toBe(true);
    });

    it('should return true when product depth increases even if total decreases', () => {
      const current = createSnapshot(2, { verdict: 'APPROVED', totalScore: 6.5, dimensionScores: { productDepth: 8, userExperience: 5, codeQuality: 6, security: 6 }, issues: [] }, true);
      const previous = createSnapshot(1, { verdict: 'APPROVED', totalScore: 7, dimensionScores: { productDepth: 6, userExperience: 8, codeQuality: 7, security: 7 }, issues: [] }, true);

      expect(hasValueImprovement(current, previous)).toBe(true);
    });

    it('should return false when no improvement', () => {
      const current = createSnapshot(2, { verdict: 'APPROVED', totalScore: 7, dimensionScores: { productDepth: 7, userExperience: 7, codeQuality: 7, security: 7 }, issues: [] }, false);
      const previous = createSnapshot(1, { verdict: 'APPROVED', totalScore: 7, dimensionScores: { productDepth: 7, userExperience: 7, codeQuality: 7, security: 7 }, issues: [] }, true);

      expect(hasValueImprovement(current, previous)).toBe(false);
    });
  });

  describe('getNextActionAdvice', () => {
    it('should return correct advice for STOP', () => {
      const advice = getNextActionAdvice({
        signal: 'STOP',
        reason: 'test',
        consecutiveNoImprovement: 0,
        qualityTrend: 'stable',
        shouldStop: true
      });

      expect(advice).toContain('结束循环');
    });

    it('should return correct advice for ROLLBACK', () => {
      const advice = getNextActionAdvice({
        signal: 'ROLLBACK',
        reason: 'test',
        consecutiveNoImprovement: 0,
        qualityTrend: 'stable',
        shouldStop: false
      });

      expect(advice).toContain('触发回滚');
    });

    it('should return correct advice for EXPLORE', () => {
      const advice = getNextActionAdvice({
        signal: 'EXPLORE',
        reason: 'test',
        consecutiveNoImprovement: 2,
        qualityTrend: 'stable',
        shouldStop: false
      });

      expect(advice).toContain('自主挖掘');
    });
  });

  describe('generateIterationSummary', () => {
    it('should generate summary with score info', () => {
      const current = createSnapshot(1, {
        verdict: 'APPROVED',
        totalScore: 8.5,
        dimensionScores: {
          productDepth: 9,
          userExperience: 8,
          codeQuality: 8,
          security: 8
        },
        issues: []
      }, true);

      const summary = generateIterationSummary(1, current, null, {
        signal: 'CONTINUE',
        reason: 'normal',
        consecutiveNoImprovement: 0,
        qualityTrend: 'improving',
        shouldStop: false
      });

      expect(summary).toContain('迭代 1');
      expect(summary).toContain('8.5');
      expect(summary).toContain('产品深度');
      expect(summary).toContain('9');
    });

    it('should show delta when previous snapshot exists', () => {
      const current = createSnapshot(2, {
        verdict: 'APPROVED',
        totalScore: 8.5,
        dimensionScores: {
          productDepth: 9,
          userExperience: 8,
          codeQuality: 8,
          security: 8
        },
        issues: []
      }, true);

      const previous = createSnapshot(1, {
        verdict: 'APPROVED',
        totalScore: 8.0,
        dimensionScores: {
          productDepth: 8,
          userExperience: 8,
          codeQuality: 8,
          security: 8
        },
        issues: []
      }, true);

      const summary = generateIterationSummary(2, current, previous, {
        signal: 'CONTINUE',
        reason: 'normal',
        consecutiveNoImprovement: 0,
        qualityTrend: 'improving',
        shouldStop: false
      });

      expect(summary).toContain('+0.5');
    });
  });
});
