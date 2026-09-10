const fs=require('node:fs/promises')
const path=require('node:path')
const crypto=require('node:crypto')
const {EventEmitter}=require('node:events')
const CHUNK=32768
function safeName(name){if(typeof name!=='string'||!name||['.','..'].includes(name)||/[\/\\\0]/.test(name))throw new Error('Enter a filename without slashes');return name}
function safePath(value){if(typeof value!=='string'||!value||value.includes('\0'))throw new Error('Invalid path');return value}
async function exists(stat,file){try{await stat(file);return true}catch(e){if(e.code==='ENOENT'||e.code===2)return false;throw e}}
async function localList(directory){const canonical=await fs.realpath(directory);const entries=await fs.readdir(canonical,{withFileTypes:true});return {path:canonical,entries:await Promise.all(entries.map(async e=>{const stat=await fs.lstat(path.join(canonical,e.name));return {name:e.name,size:stat.size,directory:stat.isDirectory(),symlink:stat.isSymbolicLink(),modified:Math.floor(stat.mtimeMs/1000),mode:stat.mode,uid:stat.uid,gid:stat.gid}}))}}
class TransferEngine extends EventEmitter {
 constructor(getSession,getSettings,resolveConflict){super();this.resolveConflict=resolveConflict;this.getSession=getSession;this.getSettings=getSettings;this.jobs=[];this.running=0;this.scheduled=false;this.lastEmit=0;this.leases=[];this.pendingLeases=[]}
 destinationNamespace(sessionId,direction){const session=this.getSession(sessionId);return direction==='download'||session.local||sessionId==='local'?'local':`remote:${session.endpoint||session.hostId||sessionId}`}
 overlaps(left,right){return left===right||left.startsWith(right.endsWith('/')?right:right+'/')||right.startsWith(left.endsWith('/')?left:left+'/')}
 blocked(namespace,roots,except){return this.leases.some(lease=>lease!==except&&lease.namespace===namespace&&[...roots].some(root=>[...lease.roots].some(other=>this.overlaps(root,other))))}
 acquire(namespace,roots){return new Promise(resolve=>{this.pendingLeases.push({namespace,roots:new Set(roots),resolve});this.drainLeases()})}
 drainLeases(){for(let index=0;index<this.pendingLeases.length;){const request=this.pendingLeases[index];const earlier=this.pendingLeases.slice(0,index).some(other=>other.namespace===request.namespace&&[...request.roots].some(root=>[...other.roots].some(candidate=>this.overlaps(root,candidate))));if(earlier||this.blocked(request.namespace,request.roots)){index++;continue}this.pendingLeases.splice(index,1);const lease={id:crypto.randomUUID(),namespace:request.namespace,roots:request.roots,jobs:null};this.leases.push(lease);request.resolve(lease)}}
 release(lease){this.leases=this.leases.filter(item=>item!==lease);this.drainLeases()}
 releaseCompleted(){for(const lease of [...this.leases])if(lease.jobs&&lease.jobs.every(job=>!['queued','active'].includes(job.status)))this.release(lease)}
 snapshot(){return this.jobs.map(({cancelled,...job})=>({...job}))}
 update(force=false){if(force||Date.now()-this.lastEmit>120){this.lastEmit=Date.now();this.emit('update',this.snapshot())}}
 async enqueue({sessionId,direction,sources,destination,targetNames}){
  if(!['upload','download'].includes(direction)||!Array.isArray(sources)||!sources.length||sources.length>10000)throw new Error('Invalid transfer request')
  const sftp=this.getSession(sessionId).sftp,uploading=direction==='upload'
  safePath(destination)
  const targetStat=uploading?sftp.lstat.bind(sftp):fs.lstat
  const base=uploading?await sftp.realpath(destination):await fs.realpath(destination)
  const namespace=this.destinationNamespace(sessionId,direction)
  const requested=sources.map((source,index)=>{safePath(source);const name=safeName(targetNames?.[index]||(uploading?path.basename(source):path.posix.basename(source)));return uploading?path.posix.join(base,name):path.join(base,name)})
  const lease=await this.acquire(namespace,requested)
  try{
  this.getSession(sessionId)
  const jobs=[],directories=[],reserved=new Set(),finalizers=[]
  let visited=0
  const unique=async target=>{const ext=path.extname(target),stem=target.slice(0,target.length-ext.length);let i=2,candidate;do{candidate=`${stem} (${i++})${ext}`}while(await exists(targetStat,candidate)||reserved.has(candidate)||lease.roots.has(candidate)||this.blocked(namespace,[candidate],lease));lease.roots.add(candidate);return candidate}
  const visit=async(source,target,depth=0,replace=false)=>{
   safePath(source);if(++visited>50000||depth>100)throw new Error('Folder transfer is too large or too deep')
   const stat=uploading?await fs.lstat(source):await sftp.lstat(source)
   const symlink=uploading?stat.isSymbolicLink():stat.symlink,directory=uploading?stat.isDirectory():stat.directory
   if(symlink)throw new Error(`Symbolic links are not transferred: ${source}`)
   if(directory){directories.push(target);const entries=uploading?(await fs.readdir(source)).map(name=>({name})):await sftp.readdir(source);for(const e of entries){safeName(e.name);await visit(uploading?path.join(source,e.name):path.posix.join(source,e.name),uploading?path.posix.join(target,e.name):path.join(target,e.name),depth+1)}}else{if(uploading&&!stat.isFile()||!uploading&&(stat.mode&0xf000)!==0x8000)throw new Error(`Only regular files and folders are supported: ${source}`);jobs.push({id:crypto.randomUUID(),sessionId,direction,source,destination:target,name:uploading?path.basename(source):path.posix.basename(source),total:stat.size,bytes:0,speed:0,status:'queued',error:'',cancelled:false,replace})}
  }
  for(const [sourceIndex,source] of sources.entries()){
   safePath(source);const name=safeName(targetNames?.[sourceIndex]||(uploading?path.basename(source):path.posix.basename(source)));let target=uploading?path.posix.join(base,name):path.join(base,name),replace=false
   const stat=uploading?await fs.lstat(source):await sftp.lstat(source),directory=uploading?stat.isDirectory():stat.directory
   const occupied=await exists(targetStat,target),planned=reserved.has(target)
   if(occupied||planned){
    if(!this.resolveConflict)throw new Error(`Destination already exists: ${target}`)
    const decision=await this.resolveConflict({name,destination:target,directory})
    if(decision==='stop')return {count:0,folders:0,jobIds:[]}
    if(decision==='skip')continue
    if(decision==='duplicate')target=await unique(target)
    else if(decision==='replace'){
     replace=true
     if(planned){const roots=[target,...finalizers.filter(job=>job.destination===target).map(job=>job.source)];const discarded=file=>roots.some(root=>file===root||file.startsWith(root+'/'));for(let index=jobs.length-1;index>=0;index--)if(discarded(jobs[index].destination))jobs.splice(index,1);for(let index=directories.length-1;index>=0;index--)if(discarded(directories[index]))directories.splice(index,1);for(let index=finalizers.length-1;index>=0;index--)if(finalizers[index].destination===target)finalizers.splice(index,1)}
     if(occupied){const existing=await targetStat(target),existingDirectory=uploading?existing.directory:existing.isDirectory();if(existingDirectory!==directory)throw new Error('A file cannot replace a folder, or a folder replace a file')}
    }else throw new Error('Invalid conflict decision')
   }
   reserved.add(target)
   if(directory&&replace&&occupied){const stage=`${target}.tide-${crypto.randomUUID()}.part`;lease.roots.add(stage);const before=jobs.length;await visit(source,stage);finalizers.push({id:crypto.randomUUID(),sessionId,direction,source:stage,destination:target,name,total:0,bytes:0,speed:0,status:'queued',error:'',cancelled:false,finalize:true,dependencies:jobs.slice(before).map(j=>j.id)})}
   else await visit(source,target,0,replace)
  }
  for(const directory of directories){if(uploading){await sftp.mkdir(directory)}else await fs.mkdir(directory,{mode:0o700})}
  lease.jobs=[...jobs,...finalizers];for(const job of lease.jobs)job.leaseId=lease.id
  this.jobs.push(...lease.jobs);this.releaseCompleted();this.update(true);this.pump();return {count:jobs.length,folders:directories.length,jobIds:lease.jobs.map(job=>job.id)}
  }finally{if(!lease.jobs)this.release(lease)}
 }
 pump(){const limit=this.getSettings().parallelFiles;while(this.running<limit){const job=this.jobs.find(j=>j.status==='queued'&&this.leases.some(lease=>lease.id===j.leaseId)&&(!j.dependencies||j.dependencies.every(id=>!this.jobs.some(dependency=>dependency.id===id&&['queued','active'].includes(dependency.status)))));if(!job)break;job.status='active';this.running++;this.run(job).then(()=>{job.status='complete';job.speed=0},e=>{job.status=job.cancelled?'cancelled':'failed';job.error=job.cancelled?'':e.message;job.speed=0}).finally(()=>{this.running--;this.releaseCompleted();this.update(true);this.emit('finished',job);this.pump()})}this.update(true)}
 async run(job){if(job.finalize)return this.finalizeFolder(job);const {sftp}=this.getSession(job.sessionId);const temporary=`${job.destination}.tide-${job.id}.part`;const uploading=job.direction==='upload';let local,remote,owned=false,success=false;const started=Date.now();let completed=0;let failure;const check=()=>{if(job.cancelled)throw new Error('Cancelled');if(failure)throw failure}
  try{check();if(!job.replace&&await exists(uploading?sftp.lstat.bind(sftp):fs.lstat,job.destination))throw new Error(`Destination already exists: ${job.destination}`)
   if(uploading){local=await fs.open(job.source,'r');const stat=await local.stat();if(!stat.isFile())throw new Error('Source is not a regular file');job.total=stat.size;remote=await sftp.open(temporary,2|8|32);owned=true}else{remote=await sftp.open(job.source,1);const stat=await sftp.fstat(remote);if((stat.mode&0xf000)!==0x8000)throw new Error('Source is not a regular file');job.total=stat.size;local=await fs.open(temporary,'wx',0o600);owned=true}
   let nextOffset=0;const worker=async()=>{while(nextOffset<job.total){check();const offset=nextOffset,length=Math.min(CHUNK,job.total-offset);nextOffset+=length;if(uploading){const buffer=Buffer.allocUnsafe(length);let filled=0;while(filled<length){check();const {bytesRead}=await local.read(buffer,filled,length-filled,offset+filled);if(!bytesRead)throw new Error('Source changed during transfer');filled+=bytesRead}check();await sftp.write(remote,offset,buffer)}else{let filled=0;while(filled<length){check();const buffer=await sftp.read(remote,offset+filled,length-filled);if(!buffer.length||buffer.length>length-filled)throw new Error('Source changed or returned invalid data');let written=0;while(written<buffer.length){const {bytesWritten}=await local.write(buffer,written,buffer.length-written,offset+filled+written);if(!bytesWritten)throw new Error('Unable to write local file');written+=bytesWritten}filled+=buffer.length}}completed+=length;job.bytes=completed;job.speed=completed/Math.max(.1,(Date.now()-started)/1000);this.update()}}
   const workers=Array.from({length:this.getSettings().concurrency},()=>worker().catch(e=>{failure=e;throw e}));const results=await Promise.allSettled(workers);const rejected=results.find(r=>r.status==='rejected');if(rejected)throw rejected.reason;check()
   const finalStat=uploading?await local.stat():await sftp.fstat(remote);if(finalStat.size!==job.total)throw new Error('Source size changed during transfer');if(!uploading)await local.sync();await local.close();local=null;await sftp.closeHandle(remote);remote=null;check()
   if(job.replace){const backup=`${job.destination}.tide-${job.id}.backup`;const move=uploading?sftp.rename.bind(sftp):fs.rename;const remove=uploading?sftp.remove.bind(sftp):fs.unlink;let backedUp=false;try{if(await exists(uploading?sftp.lstat.bind(sftp):fs.lstat,job.destination)){const targetStat=uploading?await sftp.lstat(job.destination):await fs.lstat(job.destination);if(uploading?targetStat.directory:targetStat.isDirectory())throw new Error('Cannot replace a folder with a file');await move(job.destination,backup);backedUp=true}await move(temporary,job.destination)}catch(error){if(backedUp)await move(backup,job.destination);throw error}if(backedUp)await remove(backup)}else if(uploading){await sftp.rename(temporary,job.destination)}else{await fs.link(temporary,job.destination);await fs.unlink(temporary)}success=true
  }finally{await Promise.allSettled([local?.close(),remote?sftp.closeHandle(remote):null]);if(owned&&!success){try{if(uploading)await sftp.remove(temporary);else await fs.unlink(temporary)}catch{/* A disconnected server can retain a uniquely named partial file */}}}
 }
 async finalizeFolder(job){
  const sftp=this.getSession(job.sessionId).sftp,uploading=job.direction==='upload'
  const move=uploading?sftp.rename.bind(sftp):fs.rename
  const remove=async file=>{if(uploading){const stat=await sftp.lstat(file);if(stat.directory&&!stat.symlink){for(const entry of await sftp.readdir(file))await remove(path.posix.join(file,entry.name));await sftp.rmdir(file)}else await sftp.remove(file)}else await fs.rm(file,{recursive:true,force:true})}
  if(job.cancelled||job.dependencies.some(id=>this.jobs.find(j=>j.id===id)?.status!=='complete')){await remove(job.source);throw new Error('Folder replacement cancelled because a transfer did not complete')}
  const backup=`${job.destination}.tide-${job.id}.backup`;let backedUp=false
  try{await move(job.destination,backup);backedUp=true;await move(job.source,job.destination)}catch(error){if(backedUp)await move(backup,job.destination);throw error}
  await remove(backup)
 }
 cancel(id){const job=this.jobs.find(j=>j.id===id);if(!job)throw new Error('Transfer not found');if(['complete','failed','cancelled'].includes(job.status))return;job.cancelled=true;if(job.status==='queued'&&!job.finalize)job.status='cancelled';this.releaseCompleted();this.update(true);if(job.finalize)this.pump()}
 cancelSession(id){for(const job of this.jobs.filter(j=>j.sessionId===id&&['queued','active'].includes(j.status)))this.cancel(job.id)}
 async retry(id){const job=this.jobs.find(j=>j.id===id);if(!job||!['failed','cancelled'].includes(job.status))throw new Error('Transfer cannot be retried');this.getSession(job.sessionId);job.cancelled=false;job.bytes=0;job.speed=0;job.error='';job.status='queued';job.leaseId=null;this.update(true);const lease=await this.acquire(this.destinationNamespace(job.sessionId,job.direction),[job.destination]);lease.jobs=[job];job.leaseId=lease.id;this.releaseCompleted();this.pump()}
 clear(){const needed=new Set(this.jobs.filter(j=>j.finalize&&['queued','active'].includes(j.status)).flatMap(j=>j.dependencies));this.jobs=this.jobs.filter(j=>['queued','active'].includes(j.status)||needed.has(j.id));this.update(true)}
}
module.exports={TransferEngine,safeName,safePath,localList,exists}
