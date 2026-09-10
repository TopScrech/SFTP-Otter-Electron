const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path')
const {TransferEngine}=require('../src/engine.cjs'),adapter=require('../src/local-adapter.cjs')
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function idle(engine){const end=Date.now()+10000;while(engine.jobs.some(j=>['queued','active'].includes(j.status))){if(Date.now()>end)throw new Error('Queue did not finish');await wait(5)}}
async function fixture(t,decision='duplicate'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tide-destination-ownership-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 for(const directory of ['a','b','target'])await fs.mkdir(path.join(root,directory))
 const prompts=[],sessions={a:{sftp:{...adapter},endpoint:'ssh:host-a:22:user'},b:{sftp:{...adapter},endpoint:'ssh:host-b:22:user'},local:{sftp:{...adapter},local:true}}
 const engine=new TransferEngine(id=>sessions[id],()=>({parallelFiles:4,concurrency:2}),async conflict=>{prompts.push(conflict);return decision})
 return {root,prompts,sessions,engine}
}
function blockRead(session){let started,release;const entered=new Promise(r=>started=r),gate=new Promise(r=>release=r),read=session.sftp.read;session.sftp.read=async(...args)=>{started();await gate;return read(...args)};return {entered,release}}
test('Downloads from different hosts serialize one local destination then ask to duplicate',async t=>{
 const {root,prompts,sessions,engine}=await fixture(t);await fs.writeFile(path.join(root,'a/tiny.txt'),'a');await fs.writeFile(path.join(root,'b/tiny.txt'),'b');const gate=blockRead(sessions.a)
 await engine.enqueue({sessionId:'a',direction:'download',sources:[path.join(root,'a/tiny.txt')],destination:path.join(root,'target')});await gate.entered
 const second=engine.enqueue({sessionId:'b',direction:'download',sources:[path.join(root,'b/tiny.txt')],destination:path.join(root,'target')});await wait(30);gate.release();await second;await idle(engine)
 assert.equal(prompts.length,1);assert.ok(engine.jobs.every(j=>j.status==='complete'),JSON.stringify(engine.snapshot()));assert.equal(await fs.readFile(path.join(root,'target/tiny.txt'),'utf8'),'a');assert.equal(await fs.readFile(path.join(root,'target/tiny (2).txt'),'utf8'),'b')
})
test('Local copies and downloads share destination ownership',async t=>{
 const {root,prompts,sessions,engine}=await fixture(t);await fs.writeFile(path.join(root,'a/tiny.txt'),'a');await fs.writeFile(path.join(root,'b/tiny.txt'),'b');const gate=blockRead(sessions.a)
 await engine.enqueue({sessionId:'a',direction:'download',sources:[path.join(root,'a/tiny.txt')],destination:path.join(root,'target')});await gate.entered
 const second=engine.enqueue({sessionId:'local',direction:'upload',sources:[path.join(root,'b/tiny.txt')],destination:path.join(root,'target')});await wait(20);gate.release();await second;await idle(engine)
 assert.equal(prompts.length,1);assert.equal(await fs.readFile(path.join(root,'target/tiny.txt'),'utf8'),'a');assert.equal(await fs.readFile(path.join(root,'target/tiny (2).txt'),'utf8'),'b')
})
test('Separate sessions to the same SSH endpoint serialize uploads',async t=>{
 const {root,prompts,sessions,engine}=await fixture(t);sessions.b.endpoint=sessions.a.endpoint;await fs.writeFile(path.join(root,'a/tiny.txt'),'a');await fs.writeFile(path.join(root,'b/tiny.txt'),'b');let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),write=sessions.a.sftp.write;sessions.a.sftp.write=async(...args)=>{enter();await gate;return write(...args)}
 await engine.enqueue({sessionId:'a',direction:'upload',sources:[path.join(root,'a/tiny.txt')],destination:path.join(root,'target')});await entered
 const second=engine.enqueue({sessionId:'b',direction:'upload',sources:[path.join(root,'b/tiny.txt')],destination:path.join(root,'target')});await wait(20);release();await second;await idle(engine)
 assert.equal(prompts.length,1);assert.ok(engine.jobs.every(j=>j.status==='complete'));assert.equal(await fs.readFile(path.join(root,'target/tiny (2).txt'),'utf8'),'b')
})
test('Concurrent Replace decisions occur after previous replacement commits',async t=>{
 const {root,prompts,sessions,engine}=await fixture(t,'replace');await fs.writeFile(path.join(root,'a/tiny.txt'),'a');await fs.writeFile(path.join(root,'b/tiny.txt'),'b');await fs.writeFile(path.join(root,'target/tiny.txt'),'o');const seen=[];engine.resolveConflict=async c=>{prompts.push(c);seen.push(await fs.readFile(c.destination,'utf8'));return 'replace'};const gate=blockRead(sessions.a)
 await engine.enqueue({sessionId:'a',direction:'download',sources:[path.join(root,'a/tiny.txt')],destination:path.join(root,'target')});await gate.entered
 const second=engine.enqueue({sessionId:'b',direction:'download',sources:[path.join(root,'b/tiny.txt')],destination:path.join(root,'target')});await wait(20);gate.release();await second;await idle(engine)
 assert.deepEqual(seen,['o','a']);assert.equal(await fs.readFile(path.join(root,'target/tiny.txt'),'utf8'),'b');assert.deepEqual(await fs.readdir(path.join(root,'target')),['tiny.txt']);assert.ok(engine.jobs.every(j=>j.status==='complete'))
})
test('Folder replacement retains ownership through finalization before child conflict is resolved',async t=>{
 const {root,prompts,sessions,engine}=await fixture(t);await fs.mkdir(path.join(root,'a/folder'));await fs.writeFile(path.join(root,'a/folder/tiny.txt'),'a');await fs.writeFile(path.join(root,'b/tiny.txt'),'b');await fs.mkdir(path.join(root,'target/folder'));await fs.writeFile(path.join(root,'target/folder/old.txt'),'o');engine.resolveConflict=async c=>{prompts.push(c);return c.directory?'replace':'duplicate'}
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),finalize=engine.finalizeFolder.bind(engine);engine.finalizeFolder=async job=>{enter();await gate;return finalize(job)}
 await engine.enqueue({sessionId:'a',direction:'download',sources:[path.join(root,'a/folder')],destination:path.join(root,'target')});await entered
 const second=engine.enqueue({sessionId:'b',direction:'download',sources:[path.join(root,'b/tiny.txt')],destination:path.join(root,'target/folder')});await wait(20);assert.equal(prompts.length,1);release();await second;await idle(engine)
 assert.equal(prompts.length,2);assert.equal(await fs.readFile(path.join(root,'target/folder/tiny.txt'),'utf8'),'a');assert.equal(await fs.readFile(path.join(root,'target/folder/tiny (2).txt'),'utf8'),'b');assert.deepEqual(await fs.readdir(path.join(root,'target')),['folder'])
})
test('Disjoint destinations still transfer while another destination is blocked',async t=>{
 const {root,sessions,engine}=await fixture(t);await fs.writeFile(path.join(root,'a/a.txt'),'a');await fs.writeFile(path.join(root,'b/b.txt'),'b');const gate=blockRead(sessions.a)
 await engine.enqueue({sessionId:'a',direction:'download',sources:[path.join(root,'a/a.txt')],destination:path.join(root,'target')});await gate.entered
 await engine.enqueue({sessionId:'b',direction:'download',sources:[path.join(root,'b/b.txt')],destination:path.join(root,'target')});const end=Date.now()+5000;while(!engine.jobs.some(j=>j.sessionId==='b'&&j.status==='complete')){if(Date.now()>end)throw new Error('Disjoint transfer was serialized');await wait(5)}
 gate.release();await idle(engine);assert.equal(await fs.readFile(path.join(root,'target/b.txt'),'utf8'),'b')
})
