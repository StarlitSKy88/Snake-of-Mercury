/**
 * 计数器逻辑单元测试
 */

import { CounterLogic, ValidationError } from './counterLogic';

describe('CounterLogic', () => {
  let logic: CounterLogic;

  beforeEach(() => {
    logic = new CounterLogic(999999, 0);
  });

  describe('increment', () => {
    it('应该正确增加计数', () => {
      expect(logic.increment(5)).toBe(6);
      expect(logic.increment(100)).toBe(101);
    });

    it('应该使用自定义步长', () => {
      expect(logic.increment(5, 10)).toBe(15);
      expect(logic.increment(0, 100)).toBe(100);
    });

    it('应该抛出负数验证错误', () => {
      expect(() => logic.increment(-1)).toThrow(ValidationError);
      expect(() => logic.increment(-100)).toThrow(ValidationError);
    });

    it('应该抛出超出最大值错误', () => {
      expect(() => logic.increment(999999)).toThrow(ValidationError);
      expect(() => logic.increment(999998, 2)).toThrow(ValidationError);
    });

    it('应该抛出 NaN 错误', () => {
      expect(() => logic.increment(NaN)).toThrow(ValidationError);
    });

    it('应该抛出 Infinity 错误', () => {
      expect(() => logic.increment(Infinity)).toThrow(ValidationError);
      expect(() => logic.increment(-Infinity)).toThrow(ValidationError);
    });

    it('应该抛出非数字类型错误', () => {
      expect(() => logic.increment('5' as any)).toThrow(ValidationError);
      expect(() => logic.increment(null as any)).toThrow(ValidationError);
      expect(() => logic.increment(undefined as any)).toThrow(ValidationError);
    });

    it('应该抛出无效步长错误', () => {
      expect(() => logic.increment(5, 0)).toThrow(ValidationError);
      expect(() => logic.increment(5, -1)).toThrow(ValidationError);
      expect(() => logic.increment(5, NaN)).toThrow(ValidationError);
    });
  });

  describe('decrement', () => {
    it('应该正确减少计数', () => {
      expect(logic.decrement(5)).toBe(4);
      expect(logic.decrement(100)).toBe(99);
    });

    it('应该使用自定义步长', () => {
      expect(logic.decrement(15, 10)).toBe(5);
      expect(logic.decrement(100, 50)).toBe(50);
    });

    it('应该抛出超出最小值错误', () => {
      expect(() => logic.decrement(0)).toThrow(ValidationError);
      expect(() => logic.decrement(1, 2)).toThrow(ValidationError);
    });

    it('应该抛出负数验证错误', () => {
      expect(() => logic.decrement(-1)).toThrow(ValidationError);
    });
  });

  describe('reset', () => {
    it('应该返回最小值', () => {
      expect(logic.reset()).toBe(0);
    });
  });

  describe('setValue', () => {
    it('应该设置有效值', () => {
      expect(logic.setValue(500)).toBe(500);
      expect(logic.setValue(0)).toBe(0);
      expect(logic.setValue(999999)).toBe(999999);
    });

    it('应该抛出无效值错误', () => {
      expect(() => logic.setValue(-1)).toThrow(ValidationError);
      expect(() => logic.setValue(1000000)).toThrow(ValidationError);
    });
  });

  describe('isInRange', () => {
    it('应该正确判断范围', () => {
      expect(logic.isInRange(0)).toBe(true);
      expect(logic.isInRange(500)).toBe(true);
      expect(logic.isInRange(999999)).toBe(true);
      expect(logic.isInRange(-1)).toBe(false);
      expect(logic.isInRange(1000000)).toBe(false);
      expect(logic.isInRange(NaN)).toBe(false);
    });
  });

  describe('边界条件', () => {
    it('应该处理 0 值', () => {
      expect(logic.increment(0)).toBe(1);
      expect(logic.decrement(1)).toBe(0);
    });

    it('应该处理最大值', () => {
      expect(logic.increment(999998)).toBe(999999);
      expect(() => logic.increment(999999)).toThrow();
    });

    it('应该处理极大步长', () => {
      expect(logic.increment(999990, 9)).toBe(999999);
      expect(logic.increment(999985, 10)).toBe(999995);
    });
  });

  describe('构造函数', () => {
    it('应该使用自定义配置', () => {
      const customLogic = new CounterLogic(100, 10);
      expect(customLogic.increment(10)).toBe(11);
      expect(() => customLogic.decrement(10)).toThrow();
      expect(() => customLogic.increment(100)).toThrow();
    });

    it('应该限制最大值为 999999', () => {
      const customLogic = new CounterLogic(10000000, 0);
      expect(customLogic.getConfig().maxValue).toBe(999999);
    });

    it('应该拒绝无效配置', () => {
      expect(() => new CounterLogic(-1, 0)).toThrow(ValidationError);
      expect(() => new CounterLogic(100, -1)).toThrow(ValidationError);
      expect(() => new CounterLogic(NaN, 0)).toThrow(ValidationError);
    });
  });
});
