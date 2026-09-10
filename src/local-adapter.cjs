const fs = require('node:fs/promises')
const {localList,exists} = require('./engine.cjs')
const attrs = stat => ({size:stat.size,mode:stat.mode,directory:stat.isDirectory(),symlink:stat.isSymbolicLink(),uid:stat.uid,gid:stat.gid,modified:Math.floor(stat.mtimeMs/1000)})
module.exports = {
 realpath: fs.realpath,
 lstat: async file => attrs(await fs.lstat(file)),
 fstat: async handle => attrs(await handle.stat()),
 readdir: async file => (await localList(file)).entries,
 open: (file,flags) => fs.open(file,flags&2?'wx':'r',0o600),
 closeHandle: handle=>handle.close(),
 read: async(handle,offset,length)=>{const buffer=Buffer.alloc(length);const {bytesRead}=await handle.read(buffer,0,length,offset);return buffer.subarray(0,bytesRead)},
 write: async(handle,offset,buffer)=>{let written=0;while(written<buffer.length){const result=await handle.write(buffer,written,buffer.length-written,offset+written);if(!result.bytesWritten)throw new Error('Unable to write file');written+=result.bytesWritten}},
 mkdir: file=>fs.mkdir(file,{mode:0o700}),
 rename: async(from,to)=>{if(await exists(fs.lstat,to))throw new Error('Destination already exists');await fs.rename(from,to)},
 remove:fs.unlink,rmdir:fs.rmdir,chmod:fs.chmod
}
