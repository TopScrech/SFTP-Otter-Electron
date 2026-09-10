const {contextBridge,ipcRenderer,webUtils}=require('electron')
const invoke=name=>(...args)=>ipcRenderer.invoke(`tide:${name}`,...args)
const on=name=>callback=>{const handler=(_event,value)=>callback(value);ipcRenderer.on(`tide:${name}`,handler);return()=>ipcRenderer.removeListener(`tide:${name}`,handler)}
contextBridge.exposeInMainWorld('tide',{
 droppedPaths:files=>files.map(file=>webUtils.getPathForFile(file)).filter(Boolean),
 quit:invoke('quit'),nativeDrag:invoke('native-drag'),dragState:invoke('drag-state'),onNativeDrag:on('native-drag'),init:invoke('init'),hosts:invoke('hosts'),saveHost:invoke('save-host'),deleteHost:invoke('delete-host'),connect:invoke('connect'),disconnect:invoke('disconnect'),sessions:invoke('sessions'),list:invoke('list'),pickFolder:invoke('pick-folder'),pickFiles:invoke('pick-files'),pickKey:invoke('pick-key'),fileOperation:invoke('file-operation'),transfer:invoke('transfer'),cancel:invoke('cancel'),retry:invoke('retry'),clearTransfers:invoke('clear-transfers'),settings:invoke('settings'),workspace:invoke('workspace'),knownHosts:invoke('known-hosts'),forgetHost:invoke('forget-host'),answer:invoke('answer'),open:invoke('open'),export:invoke('export'),onTransfers:on('transfers'),onRefresh:on('refresh'),onDisconnected:on('disconnected'),onPrompt:on('prompt'),onLog:on('log'),onSessions:on('sessions'),onSettingsOpen:on('settings-open')
})
