/**
 * ToolMessage — Agent 间结构化通信协议
 * P1-1: 借鉴 Langroid ToolMessage (Pydantic → JSON Schema → LLM)
 */

import { z } from 'zod';

export const PlanTask = z.object({
  id: z.number(),
  subject: z.string().min(3).max(100),
  description: z.string().min(10).max(500),
  blockedBy: z.array(z.number()),
  acceptanceCriteria: z.array(z.string().min(5).max(200)).min(1).max(5),
  impactLevel: z.number().min(0).max(3),
  owner: z.enum(['generator', 'devops', 'unassigned']).default('unassigned'),
});

export const PlanSpec = z.object({
  projectName: z.string(),
  assumptions: z.array(z.string()).min(1),
  objective: z.string().min(10),
  techStack: z.object({
    language: z.string(),
    testFramework: z.string().default('vitest'),
  }),
  commands: z.object({ build: z.string(), test: z.string(), dev: z.string() }),
  tasks: z.array(PlanTask).min(1).max(20),
});

export type PlanSpec = z.infer<typeof PlanSpec>;

export function extractPlanSpec(output: string): { valid: boolean; parsed?: PlanSpec; error?: string } {
  const jsonMatch = output.match(/```json\s*([\s\S]*?)```/) || output.match(/(\{[\s\S]*"tasks"[\s\S]*\})/);
  if (!jsonMatch) return { valid: false, error: '未找到JSON' };
  try {
    const json = JSON.parse(jsonMatch[1]);
    const parsed = PlanSpec.parse(json);
    return { valid: true, parsed };
  } catch (e: any) { return { valid: false, error: e.message }; }
}
