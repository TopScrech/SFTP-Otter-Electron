const path = require('node:path')
const fs = require('node:fs/promises')
const assert = require('node:assert/strict')
const { promisify } = require('node:util')
const exec = promisify(require('node:child_process').execFile)
const project = path.join(__dirname, '..')
require(path.join(project, 'src/smoke.cjs')).run = async (window, app, root) => {
  const finder = path.join(root, 'Finder one-byte folder destination')
  const source = path.join(root, 'remote', 'tiny-folder')
  const js = code => window.webContents.executeJavaScript(code)
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async predicate => {
    const deadline = Date.now() + 25000
    while (!await predicate()) {
      if (Date.now() > deadline) throw new Error('Native folder promise timed out')
      await wait(100)
    }
  }
  try {
    await fs.mkdir(finder)
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'tiny.txt'), 'x')
    await until(() => js('state.fixture'))
    await js(`tab().panes[0]=newPane({kind:'remote',hostId:'fixture-host',sessionId:'fixture-session',path:${JSON.stringify(path.dirname(source))}});navigate(0,${JSON.stringify(path.dirname(source))})`)
    await js(`browseLocal(1,${JSON.stringify(path.join(root, 'local'))})`)
    window.setBounds({x:20,y:70,width:1040,height:800})
    window.show()
    window.focus()
    await wait(500)
    await exec('/usr/bin/osascript', ['-e', `tell application "Finder"\nset fixtureWindow to make new Finder window to POSIX file ${JSON.stringify(finder)}\nset bounds of fixtureWindow to {1150, 120, 2000, 800}\nset current view of fixtureWindow to icon view\nend tell`])
    window.focus()
    await wait(400)
    const row = await js(`(()=>{const r=document.querySelector('[data-file="tiny-folder"]').getBoundingClientRect();return {x:r.x+100,y:r.y+r.height/2}})()`)
    const origin = window.getBounds()
    await exec(path.join(__dirname, 'mouse-drag'), [String(origin.x + row.x), String(origin.y + row.y), '1530', '450'])
    await until(async () => {try {return await fs.readFile(path.join(finder, 'tiny-folder', 'tiny.txt'), 'utf8') === 'x'} catch {return false}})
    assert.equal(await fs.readFile(path.join(finder, 'tiny-folder', 'tiny.txt'), 'utf8'), 'x')
    assert.equal(await fs.readFile(path.join(source, 'tiny.txt'), 'utf8'), 'x')
    await fs.writeFile(path.join(project, 'verification/native-folder-result.json'), JSON.stringify({passed:true, checks:['real global mouse drag of remote folder row into disposable Finder window','native public.directory file promise resolved recursively','one-byte nested file equals x','source one-byte file preserved'], fixtureBytes:1}, null, 2))
    console.log('Native one-byte folder promise into Finder passed')
    await exec('/usr/bin/osascript', ['-e', `tell application "Finder"\nrepeat with targetWindow in Finder windows\ntry\nif POSIX path of (target of targetWindow as alias) is ${JSON.stringify(finder + '/')} then close targetWindow\nend try\nend repeat\nend tell`])
    window.hide()
    await fs.rm(root, {recursive:true, force:true})
    await fs.rm(app.getPath('userData'), {recursive:true, force:true})
    app.exit(0)
  } catch (error) {console.error(error);app.exit(1)}
}
require(path.join(project, 'src/main.cjs'))
