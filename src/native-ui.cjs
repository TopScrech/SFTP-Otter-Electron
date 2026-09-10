const fs=require('node:fs/promises')
const path=require('node:path')
const {execFile}=require('node:child_process')
const {promisify}=require('node:util')
const assert=require('node:assert/strict')
const exec=promisify(execFile)
async function run(window,app,root){
 const output=process.env.TIDE_SMOKE_OUTPUT||path.join(__dirname,'..','verification'),finder=path.join(root,'Finder drop destination')
 await fs.mkdir(finder)
 const js=code=>window.webContents.executeJavaScript(code),wait=ms=>new Promise(r=>setTimeout(r,ms))
 const until=async fn=>{const limit=Date.now()+25000;while(!await fn()){if(Date.now()>limit)throw new Error('Native drag verification timed out');await wait(100)}}
 const drag=async(from,to)=>exec(path.join(__dirname,'..','scripts','mouse-drag'),[String(from.x),String(from.y),String(to.x),String(to.y)])
 await js(`tab().panes[0]=newPane({kind:'remote',hostId:'fixture-host',sessionId:'fixture-session',path:${JSON.stringify(path.join(root,'remote'))}});navigate(0,${JSON.stringify(path.join(root,'remote'))})`)
 await js(`browseLocal(1,${JSON.stringify(path.join(root,'local'))})`)
 window.setBounds({x:20,y:70,width:1040,height:800});window.show();window.focus();await wait(500)
 const windowID=window.getMediaSourceId().split(':')[1]
 await exec('/usr/sbin/screencapture',['-x','-l',windowID,path.join(output,'12-native-window-chrome.png')])
 await exec('/usr/bin/osascript',['-e',`tell application "Finder"\nset fixtureWindow to make new Finder window to POSIX file ${JSON.stringify(finder)}\nset bounds of fixtureWindow to {1150, 120, 2000, 800}\nset current view of fixtureWindow to icon view\nend tell`])
 window.focus();await wait(400)
 const source=await js("(()=>{const r=document.querySelector('[data-file=\"b28.tar.zst\"]').getBoundingClientRect();return {x:r.x+100,y:r.y+r.height/2}})()")
 const start={x:window.getBounds().x+source.x,y:window.getBounds().y+source.y}
 await drag(start,{x:1530,y:450})
 await until(async()=>{try{return await fs.readFile(path.join(finder,'b28.tar.zst'),'utf8')==='fixture b28.tar.zst'}catch{return false}})
 assert.equal(await fs.readFile(path.join(finder,'b28.tar.zst'),'utf8'),'fixture b28.tar.zst')
 window.focus();await wait(250)
 await drag(start,{x:800,y:650})
 await until(async()=>{try{return await fs.readFile(path.join(root,'local','b28.tar.zst'),'utf8')==='fixture b28.tar.zst'}catch{return false}})
 await exec('/usr/sbin/screencapture',['-x','-l',windowID,path.join(output,'13-native-drag-result.png')])
 await exec('/usr/bin/osascript',['-e',`tell application "Finder"\nrepeat with targetWindow in Finder windows\ntry\nif POSIX path of (target of targetWindow as alias) is ${JSON.stringify(finder+'/')} then close targetWindow\nend try\nend repeat\nend tell`])
 window.hide()
 await fs.writeFile(path.join(output,'native-result.json'),JSON.stringify({passed:true,checks:['real macOS chrome captured including native traffic lights','real CGEvent drag from remote row into Finder completed NSFilePromise transfer','real CGEvent drag from remote row into in-app local pane copied file']},null,2))
 console.log('Native Finder and in-app drag tests passed')
}
module.exports={run}
