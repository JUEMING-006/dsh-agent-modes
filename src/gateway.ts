import type { AgentModesConfig } from './config'
import { calcCost, resolveEndpoint } from './pricing'
import type { CallResult, CallUsage, RoleModel } from './types'
import type { DshLlm } from './dshllm'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CallOptions {
  role: string
  kind: string
  target: RoleModel
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  json?: boolean
  signal?: AbortSignal
}

/**
 * 统一模型调用层，三级路由：
 * 1. dsh：provider 由 dsh 运行时接管（用户在设置里配过）→ ctx.llm.stream()，凭据复用 dsh 的；
 * 2. litellm：全部请求走本地 LiteLLM 网关，按角色使用虚拟 key，记账/预算由网关强化；
 * 3. direct：直连各家 OpenAI 兼容端点（DeepSeek/OpenAI/Gemini/MiniMax 均已核实兼容）。
 */
export class Gateway {
  constructor(private config: AgentModesConfig, private onCall: (r: CallResult) => void, private dsh?: DshLlm) {}

  async call(opts: CallOptions): Promise<CallResult> {
    const { provider, model } = opts.target
    if (this.dsh?.available()) {
      if (!this.dsh.knows(provider)) await this.dsh.listProviderModels().catch(() => [])
      if (this.dsh.knows(provider)) return this.callViaDsh(opts)
    }
    const g = this.config.gateway
    if (g.mode === 'litellm' && g.baseUrl) {
      return this.callHttp(opts, g.baseUrl.replace(/\/$/, ''), g.apiKey || 'sk-dsh-agent-modes')
    }
    const ep = resolveEndpoint(provider, this.config.providers)
    return this.callHttp(opts, ep.baseUrl, ep.apiKey)
  }

  private async callViaDsh(opts: CallOptions): Promise<CallResult> {
    const { provider, model } = opts.target
    const started = Date.now()
    const system = opts.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
    const prompt = opts.messages.filter(m => m.role !== 'system')
      .map(m => (m.role === 'assistant' ? `[之前的助手回复]\n${m.content}` : m.content))
      .join('\n\n')
    const r = await this.dsh!.call({
      provider,
      model,
      system: system || undefined,
      prompt,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
    })
    const result: CallResult = {
      text: r.text,
      usage: r.usage,
      costUsd: calcCost(provider, model, r.usage.prompt_tokens, r.usage.completion_tokens, this.config.pricing),
      provider,
      model,
      role: opts.role,
      durationMs: Date.now() - started,
    }
    this.onCall(result)
    return result
  }

  private async callHttp(opts: CallOptions, baseUrl: string, apiKey: string): Promise<CallResult> {
    const { provider, model } = opts.target

    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 4096,
    }
    if (opts.json) body.response_format = { type: 'json_object' }

    const started = Date.now()
    let res: Response
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: opts.signal,
      })
    } catch (err) {
      throw new Error(`[${provider}/${model}] 网络请求失败：${(err as Error).message}`)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`[${provider}/${model}] HTTP ${res.status}：${text.slice(0, 400)}`)
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: CallUsage
    }
    const text = data.choices?.[0]?.message?.content ?? ''
    const usage: CallUsage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    const result: CallResult = {
      text,
      usage,
      costUsd: calcCost(provider, model, usage.prompt_tokens, usage.completion_tokens, this.config.pricing),
      provider,
      model,
      role: opts.role,
      durationMs: Date.now() - started,
    }
    this.onCall(result)
    return result
  }

  /** 解析模型返回中的 JSON（容忍 ```json 包裹与前后杂文） */
  static parseJson<T>(text: string): T {
    const stripped = text.replace(/```json\s*|```\s*/g, '').trim()
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error(`返回内容不是 JSON：${text.slice(0, 200)}`)
    return JSON.parse(stripped.slice(start, end + 1)) as T
  }
}
