// 把 dsh-agent-modes 登记进指定 profile 的 bundles 列表
// 用法: node scripts/register-bundle.mjs <profileDir>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const profileDir = process.argv[2]
if (!profileDir) throw new Error('用法: node scripts/register-bundle.mjs <profileDir>')
const file = join(profileDir, 'package.json')
const j = JSON.parse(readFileSync(file, 'utf8'))
j.dsh ??= {}
j.dsh.profile ??= {}
j.dsh.profile.bundles ??= []
if (!j.dsh.profile.bundles.includes('dsh-agent-modes')) j.dsh.profile.bundles.push('dsh-agent-modes')
writeFileSync(file, JSON.stringify(j, null, 2) + '\n')
console.log('bundles:', j.dsh.profile.bundles.join(', '))
