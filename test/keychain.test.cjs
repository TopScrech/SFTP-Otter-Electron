const {test}=require('node:test')
const assert=require('node:assert/strict')
const {spawn}=require('node:child_process')
const path=require('node:path')
const crypto=require('node:crypto')
const service=`dev.tide.sftp.test-${crypto.randomUUID()}`
function keychain(action,data){return new Promise((resolve,reject)=>{const child=spawn(path.join(__dirname,'..','src','keychain-helper'),[action,service]);let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>code?reject(new Error(stderr)):resolve(stdout));child.stdin.end(data)})}
test('A disposable Keychain item round-trips host definitions, passwords and trusted fingerprints',async t=>{t.after(()=>keychain('delete'));assert.equal(await keychain('read'),'');const data=JSON.stringify({hosts:[{id:'test',host:'fixture.invalid',password:'disposable-test-password'}],knownHosts:[{fingerprint:'fixture-fingerprint'}]});await keychain('write',data);assert.equal(await keychain('read'),data);await keychain('write',JSON.stringify({hosts:[]}));assert.deepEqual(JSON.parse(await keychain('read')),{hosts:[]})})
