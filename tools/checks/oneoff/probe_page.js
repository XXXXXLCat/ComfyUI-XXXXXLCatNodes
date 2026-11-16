const http=require('http');const {spawn}=require('child_process');
const PORT=9333, CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe', URL='http://127.0.0.1:8188/';
const get=(p)=>new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path:p},(r)=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>res(b));}).on('error',rej);});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const child=spawn(CHROME,['--headless=new','--remote-debugging-port='+PORT,'--window-size=1400,900','--hide-scrollbars','--user-data-dir=E:/Workspace/Workspace-Infinite-Canvas/.cache/cdp-profile',URL],{stdio:'ignore'});
 let list=null;for(let i=0;i<60&&!list;i++){await sleep(300);try{list=JSON.parse(await get('/json/list'));}catch(e){}}
 const t=(list||[]).find(x=>x.type==='page'&&x.url.includes('8188'));
 if(!t){console.log('no target');child.kill();return;}
 const ws=new WebSocket(t.webSocketDebuggerUrl);let id=0;const pend=new Map();
 const send=(m,p={})=>new Promise((res,rej)=>{const mid=++id;pend.set(mid,{res,rej});ws.send(JSON.stringify({id:mid,method:m,params:p}));});
 ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};
 await new Promise(r=>ws.onopen=r);await send('Page.enable');await send('Runtime.enable');
 const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});if(r.exceptionDetails)return 'ERR '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 for (const ms of [2000,6000,12000]) {
   await sleep(ms);
   console.log(ms, await ev(`JSON.stringify({title:document.title, keys:Object.keys(window.InfCanvas||{}), app:!!window.app, vue:!!document.getElementById('vue-app'), tools:!!(window.InfCanvas&&window.InfCanvas.tools)})`));
 }
 ws.close();child.kill();
})();
