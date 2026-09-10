const {spawn,execFile}=require('node:child_process')
const {promisify}=require('node:util')
const fs=require('node:fs/promises')
const os=require('node:os')
const path=require('node:path')
const net=require('node:net')
const crypto=require('node:crypto')
const {SFTP}=require('./sftp.cjs')
const exec=promisify(execFile)
const shellQuote=value=>`'${value.replace(/'/g,"'\\''")}'`
async function scanHost(host){let stdout;try{({stdout}=await exec('ssh-keyscan',['-T','8','-p',String(host.port),host.host],{timeout:12000,maxBuffer:1024*1024}))}catch(e){throw new Error(`Unable to reach ${host.host}:${host.port}: ${e.stderr?.trim()||e.message}`)}const keys=stdout.split('\n').filter(s=>s&&!s.startsWith('#')).map(line=>{const [,algorithm,key]=line.trim().split(/\s+/);return {algorithm,key,fingerprint:crypto.createHash('sha256').update(Buffer.from(key||'','base64')).digest('base64').replace(/=+$/,'')}}).filter(k=>k.key);if(!keys.length)throw new Error('Server returned no SSH host keys');return keys.sort((a,b)=>Number(b.algorithm==='ssh-ed25519')-Number(a.algorithm==='ssh-ed25519'))}
async function openTransport(host,trusted,{password='',passphrase='',executable=process.execPath}={}){
 if(process.platform==='win32')throw new Error('This build currently supports macOS and Linux with OpenSSH installed')
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tide-ssh-'));await fs.chmod(dir,0o700)
 const socketPath=path.join(dir,'auth.sock'),token=crypto.randomBytes(32).toString('hex')
 let server,client
 const cleanup=async()=>{server?.close();await fs.rm(dir,{recursive:true,force:true}).catch(()=>{})}
 try{
  const known=path.join(dir,'known_hosts'),helper=path.join(dir,'askpass')
  await fs.writeFile(known,`[${host.host}]:${host.port} ${trusted.algorithm} ${trusted.key}\n${host.host} ${trusted.algorithm} ${trusted.key}\n`,{mode:0o600})
  await fs.writeFile(helper,`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(executable)} ${shellQuote(path.join(__dirname,'askpass.cjs'))} "$@"\n`,{mode:0o700})
  server=net.createServer(socket=>{let buffer='';socket.setTimeout(30000,()=>socket.destroy());socket.on('error',()=>{});socket.on('data',b=>{buffer+=b;if(buffer.length>8192){socket.destroy();return}if(!buffer.includes('\n'))return;try{const request=JSON.parse(buffer);let secret;if(request.token===token){if(/passphrase/i.test(request.prompt))secret=passphrase;else if(/password/i.test(request.prompt))secret=password}socket.end(JSON.stringify({secret}))}catch{socket.destroy()}})})
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve)})
  const args=['-F','/dev/null','-T','-p',String(host.port),'-l',host.username,'-o','StrictHostKeyChecking=yes','-o',`UserKnownHostsFile=${known}`,'-o','GlobalKnownHostsFile=/dev/null','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','NumberOfPasswordPrompts=1','-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-o','Compression=no']
  if(trusted.algorithm==='ssh-rsa')args.push('-o','HostKeyAlgorithms=rsa-sha2-512,rsa-sha2-256');else args.push('-o',`HostKeyAlgorithms=${trusted.algorithm}`)
  if(host.auth==='key')args.push('-i',host.privateKeyPath,'-o','IdentitiesOnly=yes','-o','PreferredAuthentications=publickey')
  else if(host.auth==='password')args.push('-o','PubkeyAuthentication=no','-o','PreferredAuthentications=password,keyboard-interactive')
  else args.push('-o','BatchMode=yes','-o','PreferredAuthentications=publickey')
  args.push('-s',host.host,'sftp')
  const child=spawn('ssh',args,{stdio:['pipe','pipe','pipe'],env:{...process.env,SSH_ASKPASS:helper,SSH_ASKPASS_REQUIRE:'force',DISPLAY:process.env.DISPLAY||':0',TIDE_AUTH_SOCKET:socketPath,TIDE_AUTH_TOKEN:token}})
  child.once('close',cleanup)
  client=new SFTP(child);await client.ready
  // Authentication secrets are released as soon as the SSH transport is ready
  password='';passphrase='';server.close()
  return client
 }catch(e){client?.end();await cleanup();throw e}
}
module.exports={scanHost,openTransport}
