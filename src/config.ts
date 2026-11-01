import z from '@deepseek-ai/schemastery';
export interface PlatoConfig {
  pythonPath: string;
  javaPath: string;
  plantumlJarPath: string;
  startupTimeoutMs: number;
}
export const Config: z<PlatoConfig> = z.object({
  pythonPath: z.string().default('python').description('服务端 Python 解释器绝对路径，推荐独立虚拟环境。'),
  javaPath: z.string().default('java').description('Java 绝对路径或 PATH 中的 java。'),
  plantumlJarPath: z.string().required().description('服务端 PlantUML JAR 的绝对路径。'),
  startupTimeoutMs: z.number().min(1000).max(120000).default(30000).description('等待 Python 确认任务目录可写的毫秒数。'),
});
