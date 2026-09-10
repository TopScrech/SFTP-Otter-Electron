const fs=require('node:fs/promises')
const path=require('node:path')
const os=require('node:os')
const crypto=require('node:crypto')
const net=require('node:net')
const {spawn,execFile}=require('node:child_process')
const {promisify}=require('node:util')
const {openTransport,scanHost}=require('../src/transport.cjs')
const {TransferEngine}=require('../src/engine.cjs')
const exec=promisify(execFile)
async function main(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tide-benchmark-'));let server,client;try{
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
 await exec('ssh-keygen',['-q','-t','ed25519','-N','','-f',path.join(dir,'host')]);await exec('ssh-keygen',['-q','-t','ed25519','-N','','-f',path.join(dir,'key')])
 const subsystem=process.platform==='darwin'?'/usr/libexec/sftp-server':'/usr/lib/openssh/sftp-server'
 await fs.writeFile(path.join(dir,'config'),`Port ${port}\nListenAddress 127.0.0.1\nHostKey ${dir}/host\nPidFile ${dir}/pid\nAuthorizedKeysFile ${dir}/key.pub\nStrictModes no\nPasswordAuthentication no\nUsePAM no\nSubsystem sftp ${subsystem}\n`)
 server=spawn('/usr/sbin/sshd',['-D','-e','-f',path.join(dir,'config')]);let error='';server.stderr.on('data',b=>error+=b);await new Promise(r=>setTimeout(r,200));if(server.exitCode!==null)throw new Error(error)
 const host={host:'127.0.0.1',port,username:os.userInfo().username,auth:'key',privateKeyPath:path.join(dir,'key')};client=await openTransport(host,(await scanHost(host))[0]);const sources=[],hashes=[]
 for(let i=0;i<4;i++){const data=crypto.randomBytes(16*1024*1024);const source=path.join(dir,`file-${i}.bin`);await fs.writeFile(source,data);sources.push(source);hashes.push(crypto.createHash('sha256').update(data).digest('hex'))}
 const results=[]
 for(const settings of [{parallelFiles:1,concurrency:1},{parallelFiles:4,concurrency:32}]){const target=path.join(dir,`remote-${settings.parallelFiles}`),download=path.join(dir,`download-${settings.parallelFiles}`);await fs.mkdir(target);await fs.mkdir(download);const engine=new TransferEngine(()=>({sftp:client}),()=>settings)
  for(const direction of ['upload','download']){const started=performance.now();await engine.enqueue({sessionId:'benchmark',direction,sources:direction==='upload'?sources:sources.map(s=>path.join(target,path.basename(s))),destination:direction==='upload'?target:download});while(engine.jobs.some(j=>['queued','active'].includes(j.status)))await new Promise(r=>setTimeout(r,5));const seconds=(performance.now()-started)/1000;if(engine.jobs.some(j=>j.status!=='complete'))throw new Error(JSON.stringify(engine.snapshot()));for(let i=0;i<sources.length;i++){const file=path.join(direction==='upload'?target:download,path.basename(sources[i]));const checksum=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');if(checksum!==hashes[i])throw new Error('Checksum mismatch')}results.push({direction,...settings,totalMiB:64,seconds:Number(seconds.toFixed(3)),MiBPerSecond:Number((64/seconds).toFixed(1)),sha256Verified:true})}
 }
 console.log(JSON.stringify({date:new Date().toISOString(),platform:process.platform,architecture:process.arch,transport:'OpenSSH over loopback TCP; 4 × 16 MiB random files; 32 KiB requests',note:'Local benchmark, not a WAN speed guarantee; disk cache and run order affect results',results},null,2))
}finally{client?.end();server?.kill();await fs.rm(dir,{recursive:true,force:true})}}
main().catch(e=>{console.error(e);process.exitCode=1})
