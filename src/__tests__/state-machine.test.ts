/**
 * State Machine Tests - 状态机测试
 */

import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  getNextPhase,
  getPhaseLabel,
  getPhaseEstimatedDuration,
  validateState,
  formatStateSummary,
  shouldAdvanceToNextIteration
} from '../state-machine.js';
import type { HarnessConfig } from '../types.js';

describe('State Machine', () => {
  describe('createInitialState', () => {
    it('should create initial state with correct defaults', () => {
      const config: HarnessConfig = {
        requirement: 'build a blog',
        projectDir: '/test/project',
        maxIterations: 10
      };

      const state = createInitialState(config);

      expect(state.version).toBe('2.0');
      expect(state.projectName).toBe('project');
      expect(state.originalRequirement).toBe('build a blog');
      expect(state.currentPhase).toBe('phase0');
      expect(state.iterationCount).toBe(1);
      expect(state.convergenceStatus.signal).toBe('CONTINUE');
      expect(state.convergenceStatus.shouldStop).toBe(false);
    });

    it('should use projectDir basename as projectName', () => {
      const config: HarnessConfig = {
        requirement: 'test',
        projectDir: '/path/to/my-awesome-project',
        maxIterations: 5
      };

      const state = createInitialState(config);

      expect(state.projectName).toBe('my-awesome-project');
    });
  });

  describe('getNextPhase', () => {
    it('should return phase1 after phase0', () => {
      expect(getNextPhase('phase0')).toBe('phase1');
    });

    it('should return phase2 after phase1', () => {
      expect(getNextPhase('phase1')).toBe('phase2');
    });

    it('should return phase3 after phase2', () => {
      expect(getNextPhase('phase2')).toBe('phase3');
    });

    it('should return phase0 after phase3 (loop)', () => {
      expect(getNextPhase('phase3')).toBe('phase0');
    });
  });

  describe('getPhaseLabel', () => {
    it('should return correct labels for each phase', () => {
      expect(getPhaseLabel('phase0')).toBe('产品创新');
      expect(getPhaseLabel('phase1')).toBe('Harness 规划');
      expect(getPhaseLabel('phase2')).toBe('Harness 开发');
      expect(getPhaseLabel('phase3')).toBe('交付阶段');
    });
  });

  describe('getPhaseEstimatedDuration', () => {
    it('should return estimated durations', () => {
      expect(getPhaseEstimatedDuration('phase0')).toBe('5-10 分钟');
      expect(getPhaseEstimatedDuration('phase1')).toBe('2-3 分钟');
      expect(getPhaseEstimatedDuration('phase2')).toBe('10-30 分钟');
      expect(getPhaseEstimatedDuration('phase3')).toBe('3-5 分钟');
    });
  });

  describe('shouldAdvanceToNextIteration', () => {
    it('should return true only for phase3', () => {
      expect(shouldAdvanceToNextIteration('phase0')).toBe(false);
      expect(shouldAdvanceToNextIteration('phase1')).toBe(false);
      expect(shouldAdvanceToNextIteration('phase2')).toBe(false);
      expect(shouldAdvanceToNextIteration('phase3')).toBe(true);
    });
  });

  describe('validateState', () => {
    it('should return no errors for valid state', () => {
      const state = createInitialState({
        requirement: 'test',
        projectDir: '/test',
        maxIterations: 10
      });

      const errors = validateState(state);

      expect(errors).toHaveLength(0);
    });

    it('should return error for missing version', () => {
      const state = createInitialState({
        requirement: 'test',
        projectDir: '/test',
        maxIterations: 10
      });
      state.version = '';

      const errors = validateState(state);

      expect(errors).toContain('Missing version');
    });

    it('should return error for invalid phase', () => {
      const state = createInitialState({
        requirement: 'test',
        projectDir: '/test',
        maxIterations: 10
      });
      (state as any).currentPhase = 'invalid';

      const errors = validateState(state);

      expect(errors).toContain('Invalid current phase: invalid');
    });

    it('should return error for invalid iteration count', () => {
      const state = createInitialState({
        requirement: 'test',
        projectDir: '/test',
        maxIterations: 10
      });
      state.iterationCount = 0;

      const errors = validateState(state);

      expect(errors).toContain('Invalid iteration count');
    });
  });

  describe('formatStateSummary', () => {
    it('should format state summary correctly', () => {
      const state = createInitialState({
        requirement: 'build a blog',
        projectDir: '/test/project',
        maxIterations: 10
      });

      const summary = formatStateSummary(state);

      expect(summary).toContain('项目: project');
      expect(summary).toContain('需求: build a blog');
      expect(summary).toContain('当前阶段: 产品创新');
      expect(summary).toContain('收敛状态: CONTINUE');
    });
  });
});
