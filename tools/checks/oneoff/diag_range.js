const http=require('http');const {spawn}=require('child_process');const fs=require('fs');
const PORT=9333,CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL='file:///E:/Workspace/Workspace-Infinite-Canvas/__dlg2_demo.html';
const get=(p)=>new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path:p},(r)=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>res(b));}).on('error',rej);});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const child=spawn(CHROME,['--headless=new','--remote-debugging-port='+PORT,'--window-size=820,600','--hide-scrollbars','--user-data-dir=E:/Workspace/Workspace-Infinite-Canvas/.cache/cdp-profile',URL],{stdio:'ignore'});
 let list=null;for(let i=0;i<40&&!list;i++){await sleep(250);try{list=JSON.parse(await get('/json/list'));}catch(e){}}
 const t=(list||[]).find(x=>x.type==='page');
 const ws=new WebSocket(t.webSocketDebuggerUrl);let id=0;const pend=new Map();
 const send=(m,p={})=>new Promise((res,rej)=>{const mid=++id;pend.set(mid,{res,rej});ws.send(JSON.stringify({id:mid,method:m,params:p}));});
 ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};
 await new Promise(r=>ws.onopen=r);
 await send('Page.enable');await send('Runtime.enable');await sleep(1200);
 const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});if(r.exceptionDetails)return r.exceptionDetails.text;return r.result.value;};
 console.log(await ev(`(()=>{
   const inp=document.querySelector('.ict-field input[type=range]');
   const s=getComputedStyle(inp), tr=getComputedStyle(inp,'::-webkit-slider-runnable-track'), th=getComputedStyle(inp,'::-webkit-slider-thumb');
   return JSON.stringify({p:inp.style.getPropertyValue('--ict-p'), app:s.webkitAppearance,
     trackH:tr.height, trackBg:tr.backgroundImage.slice(0,120), trackRadius:tr.borderRadius,
     thumbW:th.width, thumbH:th.height, thumbBg:th.backgroundColor,
     h:s.height, w:s.width},null,1);
 })()`));
 const box=JSON.parse(await ev(`(()=>{const b=document.querySelector('.ict-field').getBoundingClientRect();return JSON.stringify([b.x,b.y,b.width,b.height]);})()`));
 const res=await send('Page.captureScreenshot',{format:'png',clip:{x:box[0],y:box[1],width:box[2],height:box[3],scale:4}});
 fs.writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/range-zoom.png',Buffer.from(res.data,'base64'));
 ws.close();child.kill();
})();
