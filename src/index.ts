import type { Context } from '@deepseek-ai/cordis';
import { registerRunTool } from '@software-factory/runtime-sdk';
import { runPlato, type PlatoInput } from './business.js';
import type { PlatoConfig } from './config.js';
export { Config } from './config.js';
import '@deepseek-ai/dsh-subprocess';

export const inject = ['tools', 'sfRuntime', 'subprocess'];

export function apply(ctx: Context, config: PlatoConfig): void {
  registerRunTool<PlatoInput>(ctx, {
    toolId: 'sf_plato_activity',
    description: '根据自然语言需求生成 UML 活动图，交付 PlantUML 源码和 PNG 图片，保留分析材料。需要 Python、Java、PlantUML JAR 和已配置的文本模型。',
    inputSchema: {
      type: 'object',
      properties: {
        requirement_text: {
          type: 'string',
          description: 'Natural-language requirements for an activity diagram.',
        },
      },
      required: ['requirement_text'],
      additionalProperties: false,
    },
    execute: (input, execution) => runPlato(input, execution, ctx.subprocess, config),
  });
}
