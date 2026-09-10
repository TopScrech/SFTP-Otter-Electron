const { EventEmitter } = require('node:events')
const u32 = n => { const b=Buffer.alloc(4); b.writeUInt32BE(n); return b }
const u64 = n => { const b=Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b }
const str = value => {const b=Buffer.isBuffer(value)?value:Buffer.from(value);return Buffer.concat([u32(b.length),b])}
class Reader {
 constructor(buffer){this.buffer=buffer;this.offset=0}
 take(n){if(n<0||this.offset+n>this.buffer.length)throw new Error('Malformed SFTP response');const b=this.buffer.subarray(this.offset,this.offset+n);this.offset+=n;return b}
 u32(){return this.take(4).readUInt32BE()}
 u64(){const n=Number(this.take(8).readBigUInt64BE());if(!Number.isSafeInteger(n))throw new Error('File exceeds safe offset range');return n}
 string(){return this.take(this.u32())}
 text(){return this.string().toString('utf8')}
 attrs(){const flags=this.u32(),a={};if(flags&1)a.size=this.u64();if(flags&2){a.uid=this.u32();a.gid=this.u32()}if(flags&4){a.mode=this.u32();a.directory=(a.mode&0xf000)===0x4000;a.symlink=(a.mode&0xf000)===0xa000}if(flags&8){a.accessed=this.u32();a.modified=this.u32()}if(flags&0x80000000){const count=this.u32();if(count>10000)throw new Error('Too many SFTP attributes');for(let i=0;i<count;i++){this.string();this.string()}}return a}
}
class SFTP extends EventEmitter {
 constructor(child,{timeout=60000}={}){super();this.child=child;this.timeout=timeout;this.nextId=1;this.pending=new Map();this.buffer=Buffer.alloc(0);this.closed=false;this.stderr='';this.ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject});this.ready.catch(()=>{});this.initTimer=setTimeout(()=>this.fail(new Error('SFTP connection timed out')),timeout);child.stdout.on('data',b=>this.consume(b));child.stderr?.on('data',b=>{this.stderr=(this.stderr+b.toString()).slice(-4000)});child.on('error',e=>this.fail(e));child.on('close',()=>this.fail(new Error(this.stderr.trim()||'SSH connection closed')));child.stdin.on('error',e=>this.fail(e));this.send(1,u32(3))}
 send(type,payload){if(this.closed)throw new Error('Connection is closed');const body=Buffer.concat([Buffer.from([type]),payload]);this.child.stdin.write(Buffer.concat([u32(body.length),body]))}
 consume(chunk){this.buffer=Buffer.concat([this.buffer,chunk]);try{while(this.buffer.length>=4){const size=this.buffer.readUInt32BE();if(size<1||size>8*1024*1024)throw new Error('Invalid SFTP packet length');if(this.buffer.length<size+4)return;const packet=this.buffer.subarray(4,4+size);this.buffer=this.buffer.subarray(4+size);const type=packet[0],r=new Reader(packet.subarray(1));if(type===2){if(r.u32()!==3)throw new Error('Server does not support SFTP version 3');clearTimeout(this.initTimer);this.readyResolve();continue}const id=r.u32(),request=this.pending.get(id);if(!request)throw new Error('Unexpected SFTP response');this.pending.delete(id);clearTimeout(request.timer);if(type===101){const code=r.u32(),message=r.text();if(code===0)request.resolve(null);else{const error=new Error(message||`SFTP error ${code}`);error.code=code;request.reject(error)}}else request.resolve({type,reader:r})}}catch(e){this.fail(e)}}
 request(type,...parts){if(this.closed)return Promise.reject(new Error('Connection is closed'));const id=this.nextId++>>>0;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail(new Error('SFTP request timed out')),this.timeout);this.pending.set(id,{resolve,reject,timer});try{this.send(type,Buffer.concat([u32(id),...parts]))}catch(e){this.fail(e)}})}
 async response(type,expected,...parts){const result=await this.request(type,...parts);if(!result||result.type!==expected)throw new Error('Unexpected SFTP response type');return result.reader}
 async realpath(path){const r=await this.response(16,104,str(path));if(r.u32()<1)throw new Error('Server returned no canonical path');return r.text()}
 async stat(path){return (await this.response(17,105,str(path))).attrs()}
 async lstat(path){return (await this.response(7,105,str(path))).attrs()}
 async fstat(handle){return (await this.response(8,105,str(handle))).attrs()}
 async open(path,flags){return (await this.response(3,102,str(path),u32(flags),u32(4),u32(0o600))).string()}
 async closeHandle(handle){await this.request(4,str(handle))}
 async read(handle,offset,length){try{return (await this.response(5,103,str(handle),u64(offset),u32(length))).string()}catch(e){if(e.code===1)return Buffer.alloc(0);throw e}}
 async write(handle,offset,buffer){await this.request(6,str(handle),u64(offset),str(buffer))}
 async mkdir(path){await this.request(14,str(path),u32(4),u32(0o700))}
 async rename(from,to){await this.request(18,str(from),str(to))}
 async chmod(path,mode){await this.request(9,str(path),u32(4),u32(mode))}
 async rmdir(path){await this.request(15,str(path))}
 async remove(path){await this.request(13,str(path))}
 async readdir(path){const handle=(await this.response(11,102,str(path))).string();const entries=[];try{while(true){let r;try{r=await this.response(12,104,str(handle))}catch(e){if(e.code===1)break;throw e}const count=r.u32();if(count===0)break;if(count>100000||entries.length+count>200000)throw new Error('Directory has too many entries');for(let i=0;i<count;i++){const name=r.text();r.text();const attrs=r.attrs();if(name!=='.'&&name!=='..'){if(!name||name.includes('/')||name.includes('\\')||name.includes('\0'))throw new Error('Unsafe filename returned by server');entries.push({name,...attrs})}}}}finally{await this.closeHandle(handle)}return entries}
 fail(error){if(this.closed)return;this.closed=true;clearTimeout(this.initTimer);this.readyReject(error);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error)}this.pending.clear();this.child.kill();this.emit('disconnected',error)}
 end(){this.fail(new Error('Disconnected'))}
}
module.exports={SFTP,Reader,u32,u64,str}
