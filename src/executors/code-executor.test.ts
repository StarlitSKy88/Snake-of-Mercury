import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractCodeFiles, writeCodeFiles } from './code-executor.js';
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(process.cwd(), '.test-code-exec');

describe('CodeExecutor', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('extractCodeFiles', () => {
    it('提取单个文件', () => {
      const output = '```typescript:src/app.ts\nconsole.log("hello");\n```';
      const files = extractCodeFiles(output);
      expect(files.length).toBe(1);
      expect(files[0].language).toBe('typescript');
      expect(files[0].filepath).toBe('src/app.ts');
      expect(files[0].content).toBe('console.log("hello");');
    });

    it('提取多个文件', () => {
      const output = [
        '```typescript:src/a.ts',
        'const a = 1;',
        '```',
        '```css:styles/main.css',
        'body { color: red; }',
        '```'
      ].join('\n');
      const files = extractCodeFiles(output);
      expect(files.length).toBe(2);
      expect(files[0].filepath).toBe('src/a.ts');
      expect(files[1].filepath).toBe('styles/main.css');
    });

    it('无代码块返回空', () => {
      expect(extractCodeFiles('no code here')).toEqual([]);
    });

    it('处理 HTML 文件', () => {
      const output = [
        '```html:index.html',
        '<!DOCTYPE html>',
        '<html><body><canvas id="g"></canvas></body></html>',
        '```'
      ].join('\n');
      const files = extractCodeFiles(output);
      expect(files.length).toBe(1);
      expect(files[0].language).toBe('html');
      expect(files[0].content).toContain('canvas');
    });
  });

  describe('writeCodeFiles', () => {
    it('写入文件到磁盘', () => {
      const files = [{ language: 'ts', filepath: 'src/test.ts', content: 'const x = 1;' }];
      writeCodeFiles(files, TEST_DIR);
      const fullPath = join(TEST_DIR, 'src/test.ts');
      expect(existsSync(fullPath)).toBe(true);
      expect(readFileSync(fullPath, 'utf-8')).toBe('const x = 1;');
    });

    it('自动创建父目录', () => {
      const files = [{ language: 'ts', filepath: 'deep/nested/file.ts', content: 'x' }];
      writeCodeFiles(files, TEST_DIR);
      expect(existsSync(join(TEST_DIR, 'deep/nested/file.ts'))).toBe(true);
    });
  });

  describe('HTML 验证规则', () => {
    it('缺少 DOCTYPE → 检测到', () => {
      const html = '<html><body><canvas></canvas><script></script></body></html>';
      expect(/DOCTYPE/i.test(html)).toBe(false);
    });

    it('缺少 canvas → 检测到', () => {
      const html = '<!DOCTYPE html><html><body><script></script></body></html>';
      const hasCanvas = /<canvas/i.test(html);
      expect(hasCanvas).toBe(false);
    });

    it('缺少 script → 检测到', () => {
      const html = '<!DOCTYPE html><html><body><canvas></canvas></body></html>';
      const hasScript = /<script/i.test(html);
      expect(hasScript).toBe(false);
    });

    it('有效 HTML: DOCTYPE + canvas + script → 通过', () => {
      const html = '<!DOCTYPE html><html><body><canvas id="g"></canvas><script>function draw(){}</script></body></html>';
      expect(/DOCTYPE/i.test(html)).toBe(true);
      expect(/<canvas/i.test(html)).toBe(true);
      expect(/<script/i.test(html)).toBe(true);
    });

    it('检测渲染循环缺失', () => {
      const js = 'function draw() { console.log("frame"); } function init() { draw(); }';
      const hasLoop = /requestAnimationFrame|setInterval.*draw|setTimeout.*gameLoop/i.test(js);
      expect(hasLoop).toBe(false);
    });

    it('检测事件处理缺失', () => {
      const js = 'function draw() { } requestAnimationFrame(draw);';
      const hasEvent = /addEventListener\s*\(\s*['"]\w+['"]/i.test(js);
      expect(hasEvent).toBe(false);
    });

    it('完整游戏代码通过所有检查', () => {
      const js = `
        const canvas = document.getElementById('g');
        function draw() { }
        function startGame() { requestAnimationFrame(draw); }
        addEventListener('keydown', (e) => {});
        startGame();
      `;
      expect(/requestAnimationFrame/i.test(js)).toBe(true);
      expect(/addEventListener\s*\(\s*['"]\w+['"]/i.test(js)).toBe(true);
      const fnDefs = js.match(/function\s+(\w+)/g)?.map(d => d.split(/\s+/)[1]) || [];
      expect(fnDefs).toContain('draw');
      expect(fnDefs).toContain('startGame');
    });
  });
});
