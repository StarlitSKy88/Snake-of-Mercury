/**
 * Phase 0 追问收敛模块测试
 *
 * Sprint 1 验收标准：
 * 1. 用户输入任意模糊念头，系统第一轮必须问'颠覆式还是渐进式'
 * 2. 未问创新类型判断问题，系统拒绝输出任何分析结论
 * 3. 决策卡点定位后，能根据卡点类型选择对应追问模板
 */

import { describe, it, expect } from 'vitest';
import {
  createInitialQuestionnaireState,
  canOutputAnalysis,
  getNextQuestion,
  processUserResponse,
  generateProblemDefinition,
  getBlockerSpecificTemplate,
  isQuestionnaireComplete,
  getQuestionnaireProgress,
  formatScoreWithStandardLine
} from '../phase0-questionnaire.js';

describe('Phase 0 追问收敛模块', () => {
  describe('createInitialQuestionnaireState', () => {
    it('should create initial state with correct defaults', () => {
      const requirement = '我想做个聊天app';
      const state = createInitialQuestionnaireState(requirement);

      expect(state.originalRequirement).toBe(requirement);
      expect(state.currentRound).toBe(1);
      expect(state.maxRounds).toBe(3);
      expect(state.innovationTypeAsked).toBe(false);
      expect(state.decisionBlockerAsked).toBe(false);
      expect(state.sixFields.innovationType).toBe('empty');
      expect(state.sixFields.decisionBlocker).toBe('empty');
    });
  });

  describe('验收标准 1: 第一轮必须问创新类型', () => {
    it('第一轮问题必须是创新类型选择', () => {
      const state = createInitialQuestionnaireState('我想做个聊天app');
      const question = getNextQuestion(state);

      expect(question.question).toContain('创新类型');
      expect(question.options).toContain('颠覆式改变游戏规则');
      expect(question.options).toContain('渐进式改进现有方案');
      expect(question.fieldUpdated).toBe('innovationType');
    });

    it('用户输入任意模糊念头，系统第一轮必须问创新类型', () => {
      const vagueRequirements = [
        '我想做个聊天app',
        '帮我做个能赚钱的东西',
        '搞个项目管理系统吧',
        '来个大数据平台'
      ];

      for (const req of vagueRequirements) {
        const state = createInitialQuestionnaireState(req);
        const question = getNextQuestion(state);
        expect(question.options).toContain('颠覆式改变游戏规则');
        expect(question.options).toContain('渐进式改进现有方案');
      }
    });
  });

  describe('验收标准 2: 未问创新类型问题，系统拒绝输出', () => {
    it('未问创新类型时应拒绝输出分析结论', () => {
      const state = createInitialQuestionnaireState('测试需求');
      const result = canOutputAnalysis(state);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('颠覆式还是渐进式');
    });

    it('已问创新类型但未问决策卡点时应拒绝输出', () => {
      let state = createInitialQuestionnaireState('测试需求');
      state = processUserResponse(state, '颠覆式改变游戏规则');
      state.innovationTypeAsked = true; // 模拟已问
      state.sixFields.innovationType = 'completed';

      const result = canOutputAnalysis(state);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('最大的卡点');
    });

    it('已问两个问题后应允许输出', () => {
      let state = createInitialQuestionnaireState('测试需求');
      state = processUserResponse(state, '颠覆式改变游戏规则');
      state = processUserResponse(state, '技术方案不确定，不知道怎么实现');

      const result = canOutputAnalysis(state);
      expect(result.allowed).toBe(true);
    });
  });

  describe('验收标准 3: 决策卡点定位后选择对应追问模板', () => {
    it('需求卡点应返回需求澄清模板', () => {
      const template = getBlockerSpecificTemplate('requirement');
      expect(template.focus).toBe('需求澄清');
      expect(template.questions.length).toBeGreaterThan(0);
    });

    it('技术卡点应返回技术方案模板', () => {
      const template = getBlockerSpecificTemplate('technology');
      expect(template.focus).toBe('技术方案探索');
    });

    it('商业卡点应返回商业模式模板', () => {
      const template = getBlockerSpecificTemplate('business');
      expect(template.focus).toBe('商业模式验证');
    });

    it('规模化卡点应返回规模化路径模板', () => {
      const template = getBlockerSpecificTemplate('scaling');
      expect(template.focus).toBe('规模化路径');
    });
  });

  describe('processUserResponse', () => {
    it('应正确处理颠覆式选择', () => {
      let state = createInitialQuestionnaireState('测试需求');
      state = processUserResponse(state, '颠覆式改变游戏规则');

      expect(state.innovationType).toBe('disruptive');
      expect(state.innovationTypeAsked).toBe(true);
      expect(state.sixFields.innovationType).toBe('completed');
    });

    it('应正确处理渐进式选择', () => {
      let state = createInitialQuestionnaireState('测试需求');
      state = processUserResponse(state, '渐进式改进现有方案');

      expect(state.innovationType).toBe('incremental');
    });

    it('应正确处理需求卡点选择', () => {
      let state = createInitialQuestionnaireState('测试需求');
      state = processUserResponse(state, '颠覆式改变游戏规则');
      state = processUserResponse(state, '需求不清晰，不知道要做成什么样');

      expect(state.decisionBlocker).toBe('requirement');
      expect(state.decisionBlockerAsked).toBe(true);
    });

    it('应正确处理技术卡点选择', () => {
      let state = createInitialQuestionnaireState('测试需求');
      state = processUserResponse(state, '渐进式改进现有方案');
      state = processUserResponse(state, '技术方案不确定，不知道怎么实现');

      expect(state.decisionBlocker).toBe('technology');
    });
  });

  describe('generateProblemDefinition', () => {
    it('应基于收集的信息生成问题定义', () => {
      let state = createInitialQuestionnaireState('聊天app');
      state = processUserResponse(state, '颠覆式改变游戏规则');
      state = processUserResponse(state, '技术方案不确定');
      state.problemDefinition = '实时通讯';
      state.jtbd = '团队协作';

      const problemDef = generateProblemDefinition(state);

      expect(problemDef.contextSnapshot).toBe('聊天app');
      expect(problemDef.problemStatement).toBe('实时通讯');
      expect(problemDef.jtbd).toBe('团队协作');
    });

    it('应使用原始需求作为默认值', () => {
      const state = createInitialQuestionnaireState('聊天app');
      const problemDef = generateProblemDefinition(state);

      expect(problemDef.contextSnapshot).toBe('聊天app');
      expect(problemDef.problemStatement).toBe('聊天app');
      expect(problemDef.jtbd).toBe('待定义');
    });
  });

  describe('isQuestionnaireComplete', () => {
    it('初始状态应返回未完成', () => {
      const state = createInitialQuestionnaireState('测试');
      expect(isQuestionnaireComplete(state)).toBe(false);
    });

    it('完成基本字段后应返回完成', () => {
      let state = createInitialQuestionnaireState('测试');
      state.innovationTypeAsked = true;
      state.decisionBlockerAsked = true;
      state.innovationType = 'disruptive';
      state.decisionBlocker = 'requirement';
      state.sixFields.innovationType = 'completed';
      state.sixFields.decisionBlocker = 'completed';
      state.sixFields.problemDefinition = 'completed';
      state.problemDefinition = '测试问题';

      expect(isQuestionnaireComplete(state)).toBe(true);
    });
  });

  describe('getQuestionnaireProgress', () => {
    it('应正确显示进度', () => {
      const state = createInitialQuestionnaireState('聊天app');
      const progress = getQuestionnaireProgress(state);

      expect(progress).toContain('聊天app');
      expect(progress).toContain('1/3');
      expect(progress).toContain('待选择');
    });

    it('应高亮显示空白字段', () => {
      const state = createInitialQuestionnaireState('聊天app');
      const progress = getQuestionnaireProgress(state);

      expect(progress).toContain('[高亮]');
    });
  });

  describe('formatScoreWithStandardLine', () => {
    it('应包含标准线描述', () => {
      const formatted = formatScoreWithStandardLine('商业价值', 8);

      expect(formatted).toContain('8/10');
      expect(formatted).toContain('达到8分意味着');
      expect(formatted).toContain('付费意愿');
    });

    it('应处理未知维度', () => {
      const formatted = formatScoreWithStandardLine('未知维度', 5);

      expect(formatted).toContain('5/10');
      expect(formatted).toContain('达到8分意味着');
    });
  });

  describe('对话流程完整测试', () => {
    it('完整流程：模糊念头 -> 收敛结论', () => {
      // 1. 用户输入模糊念头
      let state = createInitialQuestionnaireState('我想做个聊天app');

      // 2. 第一轮：问创新类型
      let question = getNextQuestion(state);
      expect(question.options).toContain('颠覆式改变游戏规则');

      // 3. 用户选择颠覆式
      state = processUserResponse(state, '颠覆式改变游戏规则');
      expect(state.innovationType).toBe('disruptive');

      // 4. 第二轮：问决策卡点
      question = getNextQuestion(state);
      expect(question.options.some(opt => opt.includes('需求不清晰'))).toBe(true);

      // 5. 用户选择技术卡点
      state = processUserResponse(state, '技术方案不确定，不知道怎么实现');
      expect(state.decisionBlocker).toBe('technology');

      // 6. 验证可以输出分析
      const analysis = canOutputAnalysis(state);
      expect(analysis.allowed).toBe(true);

      // 7. 验证决策卡点模板
      if (state.decisionBlocker) {
        const template = getBlockerSpecificTemplate(state.decisionBlocker);
        expect(template.focus).toBe('技术方案探索');
      }
    });
  });
});
