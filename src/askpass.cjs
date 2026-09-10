const net=require('node:net')
const socket=net.createConnection(process.env.TIDE_AUTH_SOCKET)
socket.on('connect',()=>socket.write(JSON.stringify({token:process.env.TIDE_AUTH_TOKEN,prompt:process.argv.slice(2).join(' ')})+'\n'))
let response=''
socket.on('data',b=>response+=b)
socket.on('end',()=>{try{const value=JSON.parse(response);if(typeof value.secret!=='string')process.exit(1);process.stdout.write(value.secret+'\n')}catch{process.exit(1)}})
socket.on('error',()=>process.exit(1))
setTimeout(()=>process.exit(1),30000).unref()
