/**
 * Skill 加载器 — 多源分层加载 (P2-2: OpenHarness)
 * 
 * 加载链: bundled → project → user
 * 后加载覆盖先加载 (同名 skill)
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface SkillDefinition {
  name: string;
  description: string;
  content: string;
  source: 'bundled' | 'project' | 'user';
  path?: string;
}

/** 内置 skills (bundled) */
const BUNDLED_SKILLS: SkillDefinition[] = [
  {
    name: 'pua-constraints',
    description: '三条红线 + 反合理化检测 + Red Flags',
    content: '',
    source: 'bundled',
  },
  {
    name: 'tdd-workflow',
    description: 'RED→GREEN→REFACTOR TDD 循环',
    content: '先写测试(预期失败) → 写最小代码(通过) → 重构(仍然通过)',
    source: 'bundled',
  },
];

/** 从目录加载 SKILL.md 文件 */
function loadFromDir(dir: string, source: 'project' | 'user'): SkillDefinition[] {
  if (!existsSync(dir)) return [];
  const skills: SkillDefinition[] = [];
  for (const child of readdirSync(dir, { withFileTypes: true })) {
    if (!child.isDirectory()) continue;
    const skillMd = join(dir, child.name, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    const content = readFileSync(skillMd, 'utf-8');
    const descMatch = content.match(/^#\s+(.+)/m);
    skills.push({
      name: child.name,
      description: descMatch ? descMatch[1] : child.name,
      content,
      source,
      path: skillMd,
    });
  }
  return skills;
}

/** 加载所有 skills (合并覆盖) */
export function loadAllSkills(projectDir?: string): SkillDefinition[] {
  const map = new Map<string, SkillDefinition>();

  // 1. Bundled (最低优先级)
  for (const s of BUNDLED_SKILLS) map.set(s.name, s);

  // 2. Project (项目目录 .skills/)
  if (projectDir) {
    for (const s of loadFromDir(join(projectDir, '.skills'), 'project')) {
      map.set(s.name, s);
    }
  }

  // 3. User (全局 ~/.som/skills/)
  const home = process.env.HOME || '~';
  for (const s of loadFromDir(join(home, '.som', 'skills'), 'user')) {
    map.set(s.name, s);
  }

  return [...map.values()];
}

/** 获取单个 skill */
export function getSkill(name: string, projectDir?: string): SkillDefinition | undefined {
  return loadAllSkills(projectDir).find(s => s.name === name);
}
