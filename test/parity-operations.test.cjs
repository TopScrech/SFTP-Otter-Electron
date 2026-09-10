const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {TransferEngine} = require('../src/engine.cjs')
const localAdapter = require('../src/local-adapter.cjs')

async function fixture(t, decision = 'duplicate') {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-parity-operations-'))
 t.after(() => fs.rm(root, {recursive: true, force: true}))
 const source = path.join(root, 'source'), destination = path.join(root, 'destination')
 await Promise.all([source, destination].map(directory => fs.mkdir(directory)))
 const prompts = [], adapter = {...localAdapter}
 const engine = new TransferEngine(() => ({sftp: adapter}), () => ({parallelFiles: 4, concurrency: 8}), async conflict => {
  prompts.push(conflict)
  return typeof decision === 'function' ? decision(conflict) : decision
 })
 return {root, source, destination, prompts, adapter, engine}
}
async function idle(engine) {
 const deadline = Date.now() + 10000
 while (engine.jobs.some(job => ['queued', 'active'].includes(job.status))) {
  if (Date.now() > deadline) throw new Error('Transfer queue failed to settle')
  await new Promise(resolve => setTimeout(resolve, 10))
 }
}
async function upload(engine, sources, destination) {
 await engine.enqueue({sessionId: 'fixture', direction: 'upload', sources, destination})
 await idle(engine)
}

test('Local actions rename folders, change permissions, and remove only their chosen entries', async t => {
 const {source, adapter} = await fixture(t)
 const before = path.join(source, 'before'), after = path.join(source, 'after')
 await adapter.mkdir(before)
 await fs.writeFile(path.join(before, 'owned.txt'), 'fixture bytes')
 await adapter.rename(before, after)
 const file = path.join(after, 'owned.txt')
 await adapter.chmod(file, 0o640)
 assert.equal((await adapter.lstat(file)).mode & 0o777, 0o640)
 assert.equal(await fs.readFile(file, 'utf8'), 'fixture bytes')
 await adapter.remove(file)
 await adapter.rmdir(after)
 assert.deepEqual(await fs.readdir(source), [])
})

test('Stop aborts the entire pending upload batch before new files or folders are created', async t => {
 const {source, destination, engine, prompts} = await fixture(t, 'stop')
 await fs.mkdir(path.join(source, 'fresh'))
 await fs.writeFile(path.join(source, 'fresh', 'child.txt'), 'new')
 await fs.writeFile(path.join(source, 'same.txt'), 'replacement')
 await fs.writeFile(path.join(destination, 'same.txt'), 'original')
 await upload(engine, [path.join(source, 'fresh'), path.join(source, 'same.txt')], destination)
 assert.equal(prompts.length, 1)
 assert.equal(engine.jobs.length, 0)
 assert.deepEqual(await fs.readdir(destination), ['same.txt'])
 assert.equal(await fs.readFile(path.join(destination, 'same.txt'), 'utf8'), 'original')
})

test('Skip preserves conflicting file and continues the remaining batch', async t => {
 const {source, destination, engine} = await fixture(t, 'skip')
 await fs.writeFile(path.join(source, 'same.txt'), 'replacement')
 await fs.writeFile(path.join(source, 'next.txt'), 'next')
 await fs.writeFile(path.join(destination, 'same.txt'), 'original')
 await upload(engine, [path.join(source, 'same.txt'), path.join(source, 'next.txt')], destination)
 assert.equal(await fs.readFile(path.join(destination, 'same.txt'), 'utf8'), 'original')
 assert.equal(await fs.readFile(path.join(destination, 'next.txt'), 'utf8'), 'next')
 assert.equal(engine.jobs.length, 1)
 assert.equal(engine.jobs[0].status, 'complete')
})

test('Replace installs selected bytes and removes its temporary backup after success', async t => {
 const {source, destination, engine} = await fixture(t, 'replace')
 await fs.writeFile(path.join(source, 'same.txt'), 'replacement')
 await fs.writeFile(path.join(destination, 'same.txt'), 'original')
 await upload(engine, [path.join(source, 'same.txt')], destination)
 assert.equal(engine.jobs[0].status, 'complete')
 assert.equal(await fs.readFile(path.join(destination, 'same.txt'), 'utf8'), 'replacement')
 assert.deepEqual(await fs.readdir(destination), ['same.txt'])
})

test('Duplicate skips occupied numbered filenames and preserves them', async t => {
 const {source, destination, engine} = await fixture(t, 'duplicate')
 await fs.writeFile(path.join(source, 'same.txt'), 'new')
 await fs.writeFile(path.join(destination, 'same.txt'), 'original')
 await fs.writeFile(path.join(destination, 'same (2).txt'), 'second original')
 await upload(engine, [path.join(source, 'same.txt')], destination)
 assert.equal(await fs.readFile(path.join(destination, 'same.txt'), 'utf8'), 'original')
 assert.equal(await fs.readFile(path.join(destination, 'same (2).txt'), 'utf8'), 'second original')
 assert.equal(await fs.readFile(path.join(destination, 'same (3).txt'), 'utf8'), 'new')
})

test('A failed replacement install rolls back the old file', async t => {
 const {source, destination, engine, adapter} = await fixture(t, 'replace')
 await fs.writeFile(path.join(source, 'same.txt'), 'replacement')
 await fs.writeFile(path.join(destination, 'same.txt'), 'original')
 const rename = adapter.rename
 adapter.rename = async (from, to) => {
  if (from.endsWith('.part')) throw new Error('Injected installation failure')
  return rename(from, to)
 }
 await upload(engine, [path.join(source, 'same.txt')], destination)
 assert.equal(engine.jobs[0].status, 'failed')
 assert.match(engine.jobs[0].error, /Injected installation failure/)
 assert.equal(await fs.readFile(path.join(destination, 'same.txt'), 'utf8'), 'original')
 assert.deepEqual(await fs.readdir(destination), ['same.txt'])
})

test('Cancellation while writing a replacement preserves existing file bytes', async t => {
 const {source, destination, engine, adapter} = await fixture(t, 'replace')
 await fs.writeFile(path.join(source, 'same.bin'), Buffer.alloc(1024 * 1024, 7))
 await fs.writeFile(path.join(destination, 'same.bin'), 'original')
 const write = adapter.write
 let cancelled = false
 adapter.write = async (...arguments) => {
  const result = await write(...arguments)
  if (!cancelled) {
   cancelled = true
   engine.cancel(engine.jobs[0].id)
  }
  return result
 }
 await upload(engine, [path.join(source, 'same.bin')], destination)
 assert.equal(engine.jobs[0].status, 'cancelled')
 assert.equal(await fs.readFile(path.join(destination, 'same.bin'), 'utf8'), 'original')
 assert.deepEqual(await fs.readdir(destination), ['same.bin'])
})

test('Replacing twice in one batch installs the last selected folder deterministically', async t => {
 const {source, destination, root, engine} = await fixture(t, 'replace')
 const second = path.join(root, 'second')
 await fs.mkdir(second)
 for (const parent of [source, second, destination]) await fs.mkdir(path.join(parent, 'folder'))
 await fs.writeFile(path.join(source, 'folder', 'first.txt'), 'first')
 await fs.writeFile(path.join(second, 'folder', 'last.txt'), 'last')
 await fs.writeFile(path.join(destination, 'folder', 'original.txt'), 'original')
 await upload(engine, [path.join(source, 'folder'), path.join(second, 'folder')], destination)
 assert.ok(engine.jobs.every(job => job.status === 'complete'), JSON.stringify(engine.snapshot()))
 assert.deepEqual(await fs.readdir(path.join(destination, 'folder')), ['last.txt'])
 assert.deepEqual(await fs.readdir(destination), ['folder'])
})
