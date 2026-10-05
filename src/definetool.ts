/**
 * 本地 defineTool：按 dsh 运行时（0.2.0-rc.2，@deepseek-ai/dsh-llm ToolSchema）的
 * 原生形状构造工具定义——parameters 直接是 JSON Schema 对象。
 * 不依赖 @deepseek-ai/dsh-tools npm 包：该包版本滞后于运行时，作为依赖装入 profile
 * 会被运行时当作版本不兼容的 "tools" 插件行禁用，连累本插件导入失败。
 */
export interface ParamField {
  type: 'string' | 'number' | 'boolean'
  description?: string
  required?: boolean
}

export function params(fields: Record<string, ParamField>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [name, f] of Object.entries(fields)) {
    properties[name] = { type: f.type, description: f.description }
    if (f.required) required.push(name)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => { type: 'text'; text: string }[]
  }
  execute: (args: never, exec?: unknown) => Promise<unknown>
}

export function defineTool<S extends Record<string, unknown>>(spec: {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: S, value: unknown) => { type: 'text'; text: string }[]
  }
  execute: (args: S, exec?: unknown) => Promise<unknown>
}): ToolSpec {
  return spec as ToolSpec
}

export const textOutput = {
  schema: { type: 'string' },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
}
