/**
 * 内置模拟 LLM 适配器：config.mock.enabled=true 时注册为 provider "mock"。
 * 目的：不配任何 API Key 也能跑通完整编队流水线（规划→执行→验证→汇总），
 * 用于上线前的自测与演示。回复是确定性的、按提示词角色区分的桩内容。
 * 注册方式为鸭子类型（运行时只调用 providerInfo/listModels/stream 等方法）。
 */
import type { ChatMessage } from './gateway'

export const MOCK_PROVIDER = 'mock'

/** 等服务就绪后把 mock 适配器注册进 dsh 运行时（幂等） */
export function registerMockAdapter(ctx: unknown) {
  const attempt = (left: number): void => {
    try {
      const reflect = (ctx as { reflect?: { get?: (name: string, strict?: boolean) => unknown } }).reflect
      const logger = (ctx as { logger?: { info?: (m: string) => void; warn?: (m: string) => void } }).logger
      const llm = reflect?.get?.('llm', false) as {
        registerAdapter?: (providers: string[], adapter: unknown) => unknown
        listProviders?: () => { id: string }[]
      } | undefined
      if (!llm?.registerAdapter || !llm.listProviders) {
        if (left > 0) setTimeout(() => attempt(left - 1), 500)
        else logger?.warn?.('[agent-modes] llm 服务未就绪，mock 适配器未注册')
        return
      }
      if ((llm.listProviders() ?? []).some(p => p.id === MOCK_PROVIDER)) return
      llm.registerAdapter([MOCK_PROVIDER], new MockAdapter())
      logger?.info?.('[agent-modes] mock 适配器已注册（provider=mock，零 API Key 自测用）')
    } catch (err) {
      (ctx as { logger?: { warn?: (m: string) => void } }).logger?.warn?.(`[agent-modes] mock 适配器注册失败：${(err as Error).message}`)
    }
  }
  attempt(20)
}

export class MockAdapter {
  providerInfo(provider: string) {
    return { id: provider, name: '模拟模型（无需 API Key）' }
  }

  async listModels(provider: string) {
    return [
      { provider, id: 'mock-fast', name: 'Mock 快速（模拟）' },
      { provider, id: 'mock-smart', name: 'Mock 智能（模拟）' },
    ]
  }

  async resolveModel(provider: string, model: string) {
    return { provider, model }
  }

  async *stream(options: {
    system?: string
    messages?: ChatMessage[]
    model?: string
  }): AsyncIterable<{ type: string; index?: number; blockType?: string; text?: string; block?: { type: string; text: string }; usage?: { inputTokens: number; outputTokens: number; totalTokens: number }; reason?: string }> {
    const all = (options.system ? options.system + '\n' : '') +
      (options.messages ?? []).map(m => m.content).join('\n')
    const reply = mockReply(options.model ?? 'mock-fast', all)

    // 模拟流式：按 24 字符切片
    yield { type: 'block-start', index: 0, blockType: 'text' }
    for (let i = 0; i < reply.length; i += 24) {
      yield { type: 'text-delta', index: 0, text: reply.slice(i, i + 24) }
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    const inputTokens = Math.max(1, Math.round(all.length / 3))
    const outputTokens = Math.max(1, Math.round(reply.length / 2))
    yield { type: 'usage', usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } }
    yield { type: 'finish', reason: 'stop' }
  }
}

/** 按提示词特征返回确定性桩回复 */
function mockReply(model: string, prompt: string): string {
  if (prompt.includes('"subtasks"') && prompt.includes('主控')) {
    // 规划器：从提示词里解析可用执行角色，生成合法计划
    const roles = [...prompt.matchAll(/- ([^\n（]+)（/g)].map(m => m[1].trim())
    const task = prompt.split('# 任务\n')[1]?.trim() ?? '（未识别任务）'
    const picked = roles.length ? roles : ['通用执行']
    const subtasks = picked.slice(0, 2).map((role, i) => ({
      worker: role,
      task: `（模拟）${i === 0 ? '要点整理' : '补充说明'}：${task.slice(0, 60)}`,
    }))
    return JSON.stringify({ subtasks, note: 'mock planner' })
  }
  if (prompt.includes('独立验证员')) {
    return JSON.stringify({ pass: true, issues: [], revised: null })
  }
  if (prompt.includes('压缩成要点摘要') || prompt.includes('记录员')) {
    return '（模拟摘要）团队记录已压缩。'
  }
  const taskLine = prompt.split('# 你的子任务\n')[1]?.split('\n')[0] ?? ''
  return [
    `（Mock ${model} 模拟执行）`,
    taskLine ? `任务：${taskLine.slice(0, 80)}` : '',
    '这是内置模拟适配器的确定性回复，用于在不配置任何 API Key 的情况下验证编队流水线、',
    '面板展示与记账链路。接入真实模型前，请勿将本模式的产出用于生产。',
  ].filter(Boolean).join('\n')
}
