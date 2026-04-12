/**
 * Types Tests - 类型系统测试
 *
 * 验证核心类型定义和类型安全
 */

import { describe, it, expect } from 'vitest';
import type {
  Phase,
  PhaseState,
  HarnessState,
  ConvergenceStatus,
  ConvergenceSignal,
  SupervisorReport,
  SupervisorVerdict,
  FourDimensionScores,
  SprintContract,
  ProductSpec,
  DeploymentResult,
  CanaryReport
} from '../types.js';

describe('Core Types', () => {
  describe('Phase', () => {
    it('should have valid phase values', () => {
      const phases: Phase[] = ['phase0', 'phase1', 'phase2', 'phase3'];

      phases.forEach(phase => {
        expect(['phase0', 'phase1', 'phase2', 'phase3']).toContain(phase);
      });
    });
  });

  describe('SupervisorVerdict', () => {
    it('should have valid verdict values', () => {
      const verdicts: SupervisorVerdict[] = ['APPROVED', 'REJECTED', 'ROLLBACK'];

      verdicts.forEach(verdict => {
        expect(['APPROVED', 'REJECTED', 'ROLLBACK']).toContain(verdict);
      });
    });
  });

  describe('ConvergenceSignal', () => {
    it('should have valid signal values', () => {
      const signals: ConvergenceSignal[] = ['CONTINUE', 'STOP', 'EXPLORE', 'ROLLBACK'];

      signals.forEach(signal => {
        expect(['CONTINUE', 'STOP', 'EXPLORE', 'ROLLBACK']).toContain(signal);
      });
    });
  });

  describe('FourDimensionScores', () => {
    it('should have scores in valid range 0-10', () => {
      const scores: FourDimensionScores = {
        productDepth: 8,
        userExperience: 7.5,
        codeQuality: 9,
        security: 6
      };

      expect(scores.productDepth).toBeGreaterThanOrEqual(0);
      expect(scores.productDepth).toBeLessThanOrEqual(10);
      expect(scores.userExperience).toBeGreaterThanOrEqual(0);
      expect(scores.userExperience).toBeLessThanOrEqual(10);
      expect(scores.codeQuality).toBeGreaterThanOrEqual(0);
      expect(scores.codeQuality).toBeLessThanOrEqual(10);
      expect(scores.security).toBeGreaterThanOrEqual(0);
      expect(scores.security).toBeLessThanOrEqual(10);
    });

    it('should have weights that sum to 1', () => {
      const weights = {
        productDepth: 0.35,
        userExperience: 0.30,
        codeQuality: 0.20,
        security: 0.15
      };

      const sum = weights.productDepth + weights.userExperience + weights.codeQuality + weights.security;
      expect(sum).toBeCloseTo(1.0, 2);
    });
  });

  describe('SupervisorReport', () => {
    it('should have valid report structure', () => {
      const report: SupervisorReport = {
        verdict: 'APPROVED',
        totalScore: 8.5,
        dimensionScores: {
          productDepth: 9,
          userExperience: 8,
          codeQuality: 8,
          security: 8
        },
        issues: [],
        修复建议: ['fix this', 'fix that'],
        evaluatorBiasWarnings: ['warning1']
      };

      expect(report.verdict).toBe('APPROVED');
      expect(report.totalScore).toBeGreaterThan(0);
      expect(report.totalScore).toBeLessThanOrEqual(10);
      expect(report.dimensionScores).toBeDefined();
      expect(report.issues).toBeInstanceOf(Array);
    });
  });

  describe('SprintContract', () => {
    it('should have valid sprint contract structure', () => {
      const sprint: SprintContract = {
        sprintNumber: 1,
        objectives: ['Implement login', 'Implement logout'],
        acceptanceCriteria: ['User can login', 'User sees dashboard after login'],
        estimatedDuration: '2 hours',
        technicalConstraints: ['Must use HTTPS', 'Must hash passwords']
      };

      expect(sprint.sprintNumber).toBe(1);
      expect(sprint.objectives).toHaveLength(2);
      expect(sprint.acceptanceCriteria).toHaveLength(2);
      expect(sprint.estimatedDuration).toBeTruthy();
      expect(sprint.technicalConstraints).toHaveLength(2);
    });
  });

  describe('ProductSpec', () => {
    it('should have valid product spec structure', () => {
      const spec: ProductSpec = {
        overview: 'A modern blog platform',
        featureList: {
          must: ['user auth', 'create posts'],
          should: ['comments', 'categories'],
          could: ['dark mode', 'analytics']
        },
        sprintPlan: [],
        technicalDirection: 'React + Node.js',
        acceptanceStandards: ['All features working', 'Tests passing']
      };

      expect(spec.overview).toBeTruthy();
      expect(spec.featureList.must).toBeDefined();
      expect(spec.featureList.should).toBeDefined();
      expect(spec.featureList.could).toBeDefined();
      expect(spec.sprintPlan).toBeInstanceOf(Array);
    });
  });

  describe('DeploymentResult', () => {
    it('should have success state with url or error', () => {
      const successResult: DeploymentResult = {
        success: true,
        deployedUrl: 'https://example.com',
        timestamp: new Date().toISOString()
      };

      expect(successResult.success).toBe(true);
      expect(successResult.deployedUrl).toBeTruthy();

      const failedResult: DeploymentResult = {
        success: false,
        error: 'Deployment failed',
        timestamp: new Date().toISOString()
      };

      expect(failedResult.success).toBe(false);
      expect(failedResult.error).toBeTruthy();
    });
  });

  describe('CanaryReport', () => {
    it('should have valid canary report structure', () => {
      const report: CanaryReport = {
        healthy: true,
        metrics: {
          latency: 150,
          errorRate: 0.5,
          uptime: 99.9
        },
        warnings: [],
        timestamp: new Date().toISOString()
      };

      expect(typeof report.healthy).toBe('boolean');
      expect(report.metrics).toBeDefined();
      expect(report.warnings).toBeInstanceOf(Array);
    });

    it('should allow optional metrics', () => {
      const minimalReport: CanaryReport = {
        healthy: true,
        metrics: {},
        warnings: [],
        timestamp: new Date().toISOString()
      };

      expect(minimalReport.healthy).toBe(true);
      expect(minimalReport.metrics.latency).toBeUndefined();
    });
  });

  describe('ConvergenceStatus', () => {
    it('should have valid convergence status structure', () => {
      const status: ConvergenceStatus = {
        signal: 'CONTINUE',
        reason: 'normal iteration',
        consecutiveNoImprovement: 0,
        qualityTrend: 'improving',
        shouldStop: false
      };

      expect(status.signal).toBe('CONTINUE');
      expect(status.reason).toBeTruthy();
      expect(status.shouldStop).toBe(false);
      expect(['improving', 'stable', 'degrading']).toContain(status.qualityTrend);
    });

    it('should set shouldStop based on signal', () => {
      const stopStatus: ConvergenceStatus = {
        signal: 'STOP',
        reason: 'user requested',
        consecutiveNoImprovement: 0,
        qualityTrend: 'stable',
        shouldStop: true
      };

      expect(stopStatus.shouldStop).toBe(true);
    });
  });

  describe('HarnessState', () => {
    it('should have valid harness state structure', () => {
      const state: HarnessState = {
        version: '2.0',
        projectName: 'test-project',
        originalRequirement: 'build a blog',
        currentPhase: 'phase0',
        iterationCount: 1,
        convergenceStatus: {
          signal: 'CONTINUE',
          reason: 'initial',
          consecutiveNoImprovement: 0,
          qualityTrend: 'stable',
          shouldStop: false
        },
        pivotHistory: [],
        lastUpdated: new Date().toISOString()
      };

      expect(state.version).toBeTruthy();
      expect(state.projectName).toBeTruthy();
      expect(state.originalRequirement).toBeTruthy();
      expect(state.iterationCount).toBeGreaterThan(0);
      expect(state.convergenceStatus).toBeDefined();
      expect(state.pivotHistory).toBeInstanceOf(Array);
    });

    it('should allow optional phase outputs', () => {
      const partialState: HarnessState = {
        version: '2.0',
        projectName: 'test',
        originalRequirement: 'test',
        currentPhase: 'phase0',
        iterationCount: 1,
        convergenceStatus: {
          signal: 'CONTINUE',
          reason: '',
          consecutiveNoImprovement: 0,
          qualityTrend: 'stable',
          shouldStop: false
        },
        pivotHistory: [],
        lastUpdated: new Date().toISOString()
      };

      expect(partialState.phase0Output).toBeUndefined();
      expect(partialState.phase1Output).toBeUndefined();
      expect(partialState.phase2Output).toBeUndefined();
      expect(partialState.phase3Output).toBeUndefined();
    });
  });
});
