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

const mkConfig = (overrides: Partial<AgentModesConfig> = {}): AgentModesConfig => ({
  activeMode: 'custom-mode',
  modes: [
    {
      id: 'custom-mode', name: '自定义模式', lead: { provider: 'deepseek', model: 'deepseek-v4-pro' },
      leadSource: 'mode', workers: [{ role: '通用执行', provider: 'deepseek', model: 'deepseek-flash' }],
      verifier: { provider: 'deepseek', model: 'deepseek-flash' },
      memory: { shared: true, digestMaxChars: 6000 }, budget: { monthlyCapUsd: 1, onExceed: 'block' },
      enforceSubagents: true,
    },
    {
      id: 'second-mode', name: '第二套', lead: { provider: 'openai', model: 'gpt-5.1' },
      leadSource: 'session', workers: [{ role: '轻执行', provider: 'openai', model: 'gpt-5-nano' }],
      verifier: { provider: 'openai', model: 'gpt-5-mini' },
      memory: { shared: true, digestMaxChars: 6000 }, budget: { monthlyCapUsd: 5, onExceed: 'warn' },
      enforceSubagents: true,
    },
  ],
  providers: { deepseek: { apiKey: 'test-key' } },
  gateway: { mode: 'direct', baseUrl: '', apiKey: '' },
  pricing: {},
  ui: { enabled: true, bottomBar: true, overlayPanel: true, dashboardPort: 3118, slotNames: 'shell.overlay' },
  memory: { digestMaxChars: 6000, summarizeOverChars: 24000, injectRecentSessions: 0 },
  budget: { monthlyCapUsd: 5, onExceed: 'warn' },
  verifySubagents: true,
  mock: { enabled: false },
} as unknown as AgentModesConfig)

// 1) 模式注册表：配置模式加载、切换、角色微调
const modes = new ModeRegistry(mkConfig(), () => {}, undefined)
assert.equal(modes.list().length, 2, '仅用户配置的 2 套模式（无内置）')
const switched = modes.switch('custom-mode')
assert.equal(switched.lead.model, 'deepseek-v4-pro')
modes.setRole('通用执行', 'openai', 'gpt-5-nano')
assert.equal(modes.active.workers[0].model, 'gpt-5-nano')
console.log('✅ ModeRegistry：加载/切换/角色微调（无内置模式）')

// 2) 保存/删除模式（多套保存的核心）
const saved = modes.saveMode({ name: '项目 A 编队' })
assert.equal(saved.id, '项目-a-编队')
assert.equal(modes.active.id, '项目-a-编队')
assert.equal(modes.list().length, 3)
modes.removeMode('项目-a-编队')
assert.equal(modes.list().length, 2)
assert.equal(modes.active.id, 'custom-mode')
console.log('✅ ModeRegistry：保存为新模式/删除/自动回退')

// 3) 记账台账：记录、按角色聚合、token 汇总
const ledger = new UsageLedger(mkConfig(), dataDir)
ledger.record({ ts: Date.now(), role: '通用执行', provider: 'openai', model: 'gpt-5-nano', promptTokens: 1e6, completionTokens: 1e6, costUsd: calcCost('openai', 'gpt-5-nano', 1e6, 1e6, {}), durationMs: 100, kind: 'api' })
const today = ledger.today()
assert.equal(today.total.calls, 1)
assert.equal(today.total.promptTokens, 1e6)
const month = ledger.month()
assert.equal(month.promptTokens, 1e6)
assert.ok(ledger.reportText().includes('gpt-5-nano'))
assert.ok(!ledger.reportText().includes('$'))
console.log('✅ UsageLedger：记账/聚合/token 口径（报告无美元）')

// 4) JSON 解析容错
assert.deepEqual(Gateway.parseJson('前置说明```json\n{"pass":true}\n```'), { pass: true })
console.log('✅ Gateway.parseJson：容忍代码块包裹')

// 5) 看板服务器：状态/模式切换/保存/删除/角色接口
const store = new Store(modes.active.id, modes.roles())
const dash = new DashboardServer({
  config: mkConfig(), modes, store, ledger,
  dsh: { listProviderModels: async () => [] } as never,
  sessions: { list: () => [], feed: () => ({ title: '', entries: [] }) } as never,
  onSwitch: id => { modes.switch(id); store.setActiveMode(id); store.setRoles(modes.roles()) },
  onSaveMode: (name, id) => { modes.saveMode({ name, id }); store.setActiveMode(modes.active.id); store.setRoles(modes.roles()) },
  onRemoveMode: id => { modes.removeMode(id); store.setActiveMode(modes.active.id); store.setRoles(modes.roles()) },
  onSetRole: (role, provider, model) => { modes.setRole(role, provider, model); store.setRoles(modes.roles()) },
})
const port = await dash.start()
const get = async (p: string) => (await fetch(`http://127.0.0.1:${port}${p}`)).json() as any
const post = async (p: string, body: any) => (await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as any

const status = await get('/api/status')
assert.equal(status.activeModeId, 'custom-mode')
assert.equal(status.roles.length, 3)
assert.ok(status.monthTok.calls === 1, 'status 携带本月 token')
const ms = await get('/api/modes')
assert.equal(ms.length, 2)
await post('/api/mode/save', { name: '看板保存的套' })
assert.equal((await get('/api/status')).activeModeId, '看板保存的套')
await post('/api/mode/switch', { id: 'custom-mode' })
assert.equal((await get('/api/status')).activeModeId, 'custom-mode')
await post('/api/role', { role: 'verifier', provider: 'google', model: 'gemini-2.5-flash-lite' })
const st2 = await get('/api/status')
assert.equal(st2.roles.find((r: any) => r.role === 'verifier').model, 'gemini-2.5-flash-lite')
const usage = await get('/api/usage')
assert.ok(String(usage.text).includes('gpt-5-nano'))
const html = await (await fetch(`http://127.0.0.1:${port}/`)).text()
assert.ok(html.includes('智能体编队'))
dash.stop()
console.log('✅ DashboardServer：状态/保存/切换/删除/角色调整/用量/首页')

// 6) 预算拦截（block 模式）
const ledger2 = new UsageLedger({ ...mkConfig(), budget: { monthlyCapUsd: 0.1, onExceed: 'block' } }, dataDir)
assert.match(ledger2.checkBudget() ?? '', /达到预算上限/)
console.log('✅ 预算拦截：block 模式生效')

rmSync(dataDir, { recursive: true, force: true })
console.log('\n全部冒烟测试通过 🎉')
