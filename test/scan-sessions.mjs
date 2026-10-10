/**
 * 解压所有 DSH session 日志（zstd，多帧拼接）并查证：
 *   1. 有没有任何一次会话调用过 jev_decide、或出现过 dsh-jev；
 *   2. 会话日志的完整大小，确认多帧真的被解开了。
 * 只读，不写任何东西。
 */
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createZstdDecompress } from 'node:zlib'

const root = join(process.env.USERPROFILE, '.dsh', 'sessions')

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.endsWith('.zstd')) yield full
  }
}

/** 流式解压：多帧拼接的 zstd 也能一次读完。 */
function decompressAll(file) {
  return new Promise((settle, fail) => {
    const chunks = []
    const decoder = createZstdDecompress()
    decoder.on('data', (chunk) => chunks.push(chunk))
    decoder.on('end', () => settle(Buffer.concat(chunks).toString('utf8')))
    decoder.on('error', fail)
    createReadStream(file).on('error', fail).pipe(decoder)
  })
}

const rows = []
for (const file of walk(root)) {
  try {
    const text = await decompressAll(file)
    rows.push({
      file,
      mtime: statSync(file).mtime,
      bytes: text.length,
      jev: (text.match(/jev/gi) ?? []).length,
      jevDecide: (text.match(/jev_decide/g) ?? []).length,
      dshJev: (text.match(/dsh-jev/g) ?? []).length,
    })
  } catch (error) {
    rows.push({ file, error: error.message })
  }
}

rows.sort((a, b) => (b.mtime?.getTime() ?? 0) - (a.mtime?.getTime() ?? 0))

console.log('=== session 日志（按时间倒序，前 12）===')
for (const row of rows.slice(0, 12)) {
  if (row.error) { console.log(`  [解压失败] ${row.file}: ${row.error}`); continue }
  console.log(
    `  ${row.mtime.toISOString().slice(0, 19)}  ${String(row.bytes).padStart(9)}B  `
    + `jev=${row.jev} jev_decide=${row.jevDecide} dsh-jev=${row.dshJev}  ${row.file.replace(root, '')}`,
  )
}

const ok = rows.filter((r) => !r.error)
console.log('')
console.log(`可解压会话总数:          ${ok.length} / ${rows.length}`)
console.log(`解压后总字节:            ${ok.reduce((sum, r) => sum + r.bytes, 0)}`)
console.log(`含 jev_decide 的会话数:  ${ok.filter((r) => r.jevDecide > 0).length}`)
console.log(`含 dsh-jev 字样的会话数: ${ok.filter((r) => r.dshJev > 0).length}`)
console.log(`含 jev 字样的会话数:     ${ok.filter((r) => r.jev > 0).length}`)
