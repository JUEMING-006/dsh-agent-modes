import assert from 'node:assert'
import { rmSync } from 'node:fs'
import { Gateway } from '../src/gateway'
import { ModeRegistry } from '../src/modes'
import { DashboardServer } from '../src/server'
import { Store } from '../src/store'
import { UsageLedger } from '../src/usage'
import { calcCost } from '../src/pricing'
import type { AgentModesConfig } from '../src/config'

const dataDir = '.tmp/smoke-data'
rmSync(dataDir, { recursive: true, force: true })

const config = {
  activeMode: 'gpt-lead',
  modes: [{
    id: 'custom-mode', name: '自定义模式', lead: { provider: 'deepseek', model: 'deepseek-v4-pro' },
    leadSource: 'mode', workers: [{ role: '通用执行', provider: 'deepseek', model: 'deepseek-flash' }],
    verifier: { provider: 'deepseek', model: 'deepseek-flash' },
    memory: { shared: true, digestMaxChars: 6000 }, budget: { monthlyCapUsd: 1, onExceed: 'block' },
  }],
  providers: { deepseek: { apiKey: 'test-key' } },
  gateway: { mode: 'direct', baseUrl: '', apiKey: '' },
  pricing: {},
  ui: { enabled: true, bottomBar: true, overlayPanel: true, dashboardPort: 3118 },
  memory: { digestMaxChars: 6000, summarizeOverChars: 24000 },
  budget: { monthlyCapUsd: 5, onExceed: 'warn' },
} as unknown as AgentModesConfig

// 1) 模式注册表：内置+自定义合并、切换、角色微调
const modes = new ModeRegistry(config, () => {}, undefined)
assert.equal(modes.list().length, 4, '内置 3 + 自定义 1')
const switched = modes.switch('custom-mode')
assert.equal(switched.lead.model, 'deepseek-v4-pro')
modes.setRole('通用执行', 'openai', 'gpt-5-nano')
assert.equal(modes.active.workers[0].model, 'gpt-5-nano')
console.log('✅ ModeRegistry：合并/切换/角色微调')

// 2) 记账台账：记录、按角色聚合、预算
const ledger = new UsageLedger(config, dataDir)
ledger.record({ ts: Date.now(), role: '通用执行', provider: 'openai', model: 'gpt-5-nano', promptTokens: 1e6, completionTokens: 1e6, costUsd: calcCost('openai', 'gpt-5-nano', 1e6, 1e6, config.pricing), durationMs: 100, kind: 'api' })
const today = ledger.today()
assert.equal(today.total.calls, 1)
assert.equal(today.total.costUsd, 0.45, 'nano 1M+1M = $0.45')
assert.equal(today.byRole['通用执行'].calls, 1)
assert.ok(ledger.reportText().includes('gpt-5-nano'))
console.log('✅ UsageLedger：记账/聚合/价格计算（$0.45/1M+1M）')

// 3) JSON 解析容错
assert.deepEqual(Gateway.parseJson('前置说明```json\n{"pass":true}\n```'), { pass: true })
console.log('✅ Gateway.parseJson：容忍代码块包裹')

// 4) 看板服务器：状态/模式/切换/改角色接口
const store = new Store(modes.active.id, modes.roles())
const dash = new DashboardServer({
  config, modes, store, ledger,
  onSwitch: id => { modes.switch(id); store.setActiveMode(id); store.setRoles(modes.roles()) },
  onSetRole: (role, provider, model) => { modes.setRole(role, provider, model); store.setRoles(modes.roles()) },
})
const port = await dash.start()
const get = async (p: string) => (await fetch(`http://127.0.0.1:${port}${p}`)).json() as any
const post = async (p: string, body: any) => (await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as any

const status = await get('/api/status')
assert.equal(status.activeModeId, 'custom-mode')
assert.equal(status.roles.length, 3)
assert.ok(status.budget.cap === 5)
const ms = await get('/api/modes')
assert.equal(ms.length, 4)
await post('/api/mode/switch', { id: 'gpt-lead' })
assert.equal((await get('/api/status')).activeModeId, 'gpt-lead')
await post('/api/role', { role: 'verifier', provider: 'google', model: 'gemini-2.5-flash-lite' })
const st2 = await get('/api/status')
assert.equal(st2.roles.find((r: any) => r.role === 'verifier').model, 'gemini-2.5-flash-lite')
const usage = await get('/api/usage')
assert.ok(String(usage.text).includes('gpt-5-nano'))
const html = await (await fetch(`http://127.0.0.1:${port}/`)).text()
assert.ok(html.includes('智能体编队'))
dash.stop()
console.log('✅ DashboardServer：状态/模式切换/角色调整/用量/首页 HTML')

// 5) 预算拦截（block 模式，上限 $1，已花 $0.45 → 未拦截；模拟超限）
const ledger2 = new UsageLedger({ ...config, budget: { monthlyCapUsd: 0.1, onExceed: 'block' } }, dataDir)
assert.match(ledger2.checkBudget() ?? '', /达到预算上限/)
console.log('✅ 预算拦截：block 模式生效')

rmSync(dataDir, { recursive: true, force: true })
console.log('\n全部冒烟测试通过 🎉')
