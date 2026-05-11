# Sprint 2 开发任务

## Sprint 目标
- 添加数据持久化
- 完善边界处理

## 验收标准
1. 刷新页面后计数值保持
2. 负数计数正确处理
3. 最大值限制生效

## 技术约束


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

## 上次被否决的问题（必须修复）
1. **缺少测试文件** (-2.0)
2. **缺少 README.md 文档** (-0.5)
3. **Loading 状态简陋** (-0.5)
4. **缺少 ESLint 配置**
5. **同步机制不完整**

请务必修复以上问题后再提交。


## ⚠️ 强制输出约束（必须遵守，否则后果自负）

### 最低输出要求
1. **最少代码行数**: 不得少于 50 行实际代码
2. **最少文件数量**: 不得少于 1 个代码文件
3. **禁止空输出**: 绝对不允许输出空文件或仅含注释的文件

### 代码质量约束
4. **必须有实际逻辑**: 不能只有 import/export 而无实际逻辑
5. **必须有错误处理**: 每个函数必须包含错误处理逻辑
6. **必须可运行**: 代码必须能通过 TypeScript/JavaScript 解释器执行

### 禁止事项
- 禁止输出 "以下是代码" 然后跟一个空代码块
- 禁止只输出文件路径而不输出实际内容
- 禁止输出仅含注释的"占位"代码
- 禁止输出 {{ ... }} 这样的模板占位符

### 正确格式
✅ ```typescript:src/index.ts
export function add(a: number, b: number): number {
  return a + b;
}
```

❌ ```typescript:src/index.ts
// 代码略
```

❌ ```typescript
// 将在下一版本实现
```

如果无法完成某些功能，明确说明原因，不要输出空代码或占位符。


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
   - 测试文件命名：`*.test.ts` 或 `*.spec.ts`

2. **ID 生成** - 必须使用加密安全方法：
   - ✅ `crypto.randomUUID()`
   - ❌ `Math.random()` （禁止使用）

3. **输入边界检查** - 所有公共函数必须验证：
   - 参数类型
   - 值范围（0 ≤ x ≤ 999999）
   - NaN/Infinity 检测

**P1 必须实现：**
4. ESLint 配置（.eslintrc.json）
5. Pre-commit hook（lint-staged 或 husky）

**代码示例 - 正确的输入验证：**
```typescript
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
```

**代码示例 - 正确的 ID 生成：**
```typescript
// ✅ 正确
import { randomUUID } from 'crypto';
const id = randomUUID();

// ❌ 错误
const id = Math.random().toString(36);
```

**代码示例 - 正确的 Toast 反馈：**
```typescript
function showToast(message: string, type: 'success' | 'error' | 'warning') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
```

---

开始实现...
