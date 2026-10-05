import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'

const mod = await import(pathToFileURL('lib/index.js').href)
const registered = []
const disposers = []
const ctx = {
  tools: { register: t => registered.push(t.name) },
  effect: fn => { const d = fn(); if (typeof d === 'function') disposers.push(d) },
  logger: { warn: m => console.log('WARN:', m) },
  slots: undefined,
}
const config = {
  activeMode: 'gpt-lead',
  modes: [],
  providers: { deepseek: { apiKey: 'x' } },
  gateway: { mode: 'direct', baseUrl: '', apiKey: '' },
  pricing: {},
  ui: { enabled: true, bottomBar: true, overlayPanel: true, dashboardPort: 3119 },
  memory: { digestMaxChars: 6000, summarizeOverChars: 24000 },
  budget: { monthlyCapUsd: 20, onExceed: 'warn' },
}
await mod.apply(ctx, config)
console.log('插件名:', mod.name)
console.log('注册工具数:', registered.length)
console.log('工具:', registered.join(', '))
const s = await (await fetch('http://127.0.0.1:3119/api/status')).json()
console.log('看板状态接口: activeMode=' + s.activeModeId + ', roles=' + s.roles.length + ', budgetCap=' + s.budget.cap)
const html = await (await fetch('http://127.0.0.1:3119/')).text()
console.log('看板页面:', html.includes('智能体编队') ? '正常渲染' : '异常')

/* ---------- 离线流水线测试（零 API Key） ---------- */
// 1) dsh 路由：伪造 llm 服务 + 内置 mock 适配器
const fakeLlm = {
  listProviders: () => [{ id: 'mock', name: 'Mock' }],
  listModels: async (p) => [{ provider: p, id: 'mock-fast', name: 'Mock 快速' }],
  async *stream(opts) {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: '（离线桩回复）' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '（离线桩回复）' } }
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }
    yield { type: 'finish', reason: 'stop' }
  },
  registerAdapter: () => {},
}
const ctx2 = { reflect: { get: (n) => (n === 'llm' ? fakeLlm : undefined) } }
const dsh = new mod.DshLlm(ctx2)
const gw = new mod.Gateway(config, () => {}, dsh)
const r1 = await gw.call({ role: '通用执行', kind: 'test', target: { provider: 'mock', model: 'mock-fast' }, messages: [{ role: 'user', content: '测试' }] })
console.log('dsh 路由(mock 适配器):', JSON.stringify(r1.text), '| usage', JSON.stringify(r1.usage), '| 成本 $' + r1.costUsd)

// 2) direct 路由：本地模拟 OpenAI 兼容服务器
const http = await import('node:http')
const srv = http.createServer((req, res) => {
  let b = ''
  req.on('data', (c) => (b += c))
  req.on('end', () => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: '直连桩回复' } }], usage: { prompt_tokens: 50, completion_tokens: 10 } }))
  })
})
await new Promise((ok) => srv.listen(3211, '127.0.0.1', ok))
const gw2 = new mod.Gateway({
  ...config,
  gateway: { mode: 'direct', baseUrl: '', apiKey: '' },
  providers: { directmock: { baseUrl: 'http://127.0.0.1:3211', apiKey: 'k' } },
}, () => {}, new mod.DshLlm({}))
const r2 = await gw2.call({ role: 'worker', kind: 'test', target: { provider: 'directmock', model: 'test-model' }, messages: [{ role: 'user', content: '测试' }] })
console.log('direct 路由(本地模拟服务器):', JSON.stringify(r2.text), '| usage', JSON.stringify(r2.usage), '| 成本 $' + r2.costUsd)
srv.close()

rmSync('.dsh-agent-modes', { recursive: true, force: true })
for (const d of disposers) d()
await new Promise(r => setTimeout(r, 300))
process.exit(0)
