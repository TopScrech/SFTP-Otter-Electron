const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os'), net = require('node:net')
const { spawn, execFile } = require('node:child_process'), exec = require('node:util').promisify(execFile), assert = require('node:assert/strict')
const project = path.join(__dirname, '..')
require(path.join(project, 'src/smoke.cjs')).run = async (window, app, root) => {
  const servers = [], js = code => window.webContents.executeJavaScript(code), wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async test => {const end = Date.now()+25000;while(!await test()){if(Date.now()>end)throw new Error('Two remote pane test timed out');await wait(50)}}
  try {
    await until(() => js('state.fixture'))
    for (let i=0;i<2;i++) {
      const dir=path.join(root,`server-${i}`);await fs.mkdir(dir);await fs.mkdir(path.join(dir,'files'))
      await exec('ssh-keygen',['-q','-t','ed25519','-N','','-f',path.join(dir,'host')])
      await exec('ssh-keygen',['-q','-t','ed25519','-N','tiny-key-passphrase','-f',path.join(dir,'key')])
      const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r))
      await fs.writeFile(path.join(dir,'config'),`Port ${port}\nListenAddress 127.0.0.1\nHostKey ${dir}/host\nPidFile ${dir}/pid\nAuthorizedKeysFile ${dir}/key.pub\nStrictModes no\nPasswordAuthentication no\nUsePAM no\nSubsystem sftp /usr/libexec/sftp-server\n`)
      const server=spawn('/usr/sbin/sshd',['-D','-e','-f',path.join(dir,'config')]);server.stderr.resume();servers.push(server);await wait(150);assert.equal(server.exitCode,null)
      const host=await js(`api.saveHost(${JSON.stringify({id:`remote-${i}`,label:`Tiny remote ${i+1}`,host:'127.0.0.1',port,username:os.userInfo().username,auth:'key',privateKeyPath:path.join(dir,'key'),password:'tiny-key-passphrase',savePassword:true,initialPath:path.join(dir,'files')})})`)
      await js(`state.hosts.push(${JSON.stringify(host)});window.connecting=connectHost(${i},${JSON.stringify(host)});void 0`)
      await until(()=>js("document.querySelector('#modal').open&&document.querySelector('#modal h2')?.textContent==='Verify server identity'"));await js("document.querySelector('#modal [value=trust]').click()");await js('window.connecting')
    }
    assert.equal(await js("pane(0).kind==='remote'&&pane(1).kind==='remote'&&pane(0).sessionId!==pane(1).sessionId"),true)
    const source=path.join(root,'server-0/files'),target=path.join(root,'server-1/files')
    await fs.writeFile(path.join(source,'tiny.txt'),'x');await fs.mkdir(path.join(source,'tiny-folder'));await fs.writeFile(path.join(source,'tiny-folder','nested.txt'),'y')
    await js('refresh(0)')
    await js("pane(0).selected=new Set(['tiny.txt','tiny-folder']);fileMenu(0,100,200)")
    await js("document.querySelectorAll('.context-menu button')[2].click()")
    await until(async()=>{try{return await fs.readFile(path.join(target,'tiny-folder/nested.txt'),'utf8')==='y'&&await fs.readFile(path.join(target,'tiny.txt'),'utf8')==='x'}catch{return false}})
    assert.equal(await fs.readFile(path.join(source,'tiny.txt'),'utf8'),'x')
    await until(()=>js("pane(1).entries.some(e=>e.name==='tiny.txt')&&pane(1).entries.some(e=>e.name==='tiny-folder')"))
    await fs.writeFile(path.join(project,'verification/remote-panes-result.json'),JSON.stringify({passed:true,checks:['two simultaneous remote panes use different SSH servers, host keys, ports and sessions','context-menu Copy to target directory copies selected file and folder between remote hosts','one-byte file and one-byte nested file match','source preserved','destination remote listing refreshes'],fixtureBytes:2},null,2))
    console.log('Two remote panes and context-menu remote-to-remote copy passed')
    for(const server of servers)server.kill()
    await fs.rm(root,{recursive:true,force:true});await fs.rm(app.getPath('userData'),{recursive:true,force:true});app.exit(0)
  } catch(error){for(const server of servers)server.kill();console.error(error);app.exit(1)}
}
require(path.join(project,'src/main.cjs'))
