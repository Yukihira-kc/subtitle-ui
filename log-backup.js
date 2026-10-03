(function(){
'use strict';
const DATABASE='subtitle-log-backups-v1',INTERVAL=300000,$=id=>document.getElementById(id);
let dbPromise;
function database(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  if(!window.indexedDB)return reject(Error('端末内保存を利用できません'));
  const r=indexedDB.open(DATABASE,1);
  r.onupgradeneeded=()=>{for(const name of ['records','sessions']){const s=r.result.createObjectStore(name,{keyPath:'key'});s.createIndex('scope','scope');}r.result.createObjectStore('folders');};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('別の画面が保存領域を使用しています'));
 }).catch(e=>{dbPromise=null;throw e;});
 return dbPromise;
}
async function transaction(stores,write,operation){
 const db=await database();
 return new Promise((resolve,reject)=>{let tx,result;
  try{try{tx=db.transaction(stores,write?'readwrite':'readonly',{durability:'strict'});}catch(e){if(e.name!=='TypeError')throw e;tx=db.transaction(stores,write?'readwrite':'readonly');}
   operation(tx,v=>{result=v;});tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error||Error('保存処理に失敗しました'));
  }catch(e){reject(e);}
 });
}
function read(store,key){return transaction([store],false,(tx,done)=>{const r=tx.objectStore(store).get(key);r.onsuccess=()=>done(r.result);});}
function valid(item){return Number.isSafeInteger(item?.id)&&Array.isArray(item.lines)&&item.lines.length&&item.lines.every(v=>typeof v==='string');}
function entries(record){return [...(record.items instanceof Map?record.items.values():record.entries||[])].filter(valid).sort((a,b)=>a.id-b.id);}
function text(record){const lines=entries(record).flatMap(i=>i.lines);return '\ufeff'+(lines.length?lines.join('\r\n')+'\r\n':'');}
function download(record){const u=URL.createObjectURL(new Blob([text(record)],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');try{a.href=u;a.download=record.filename;a.click();}finally{setTimeout(()=>URL.revokeObjectURL(u),60000);}}
async function list(prefix){const rows=await transaction(['sessions'],false,(tx,done)=>{const r=tx.objectStore('sessions').getAll();r.onsuccess=()=>done(r.result);});return rows.filter(r=>r.scope.startsWith(prefix)).sort((a,b)=>b.startedAt-a.startedAt);}
async function removeLogs(prefix,keys){
 if(typeof prefix!=='string'||!prefix.startsWith('subtitle-v29:')||!Array.isArray(keys))throw Error('削除対象が不正です');
 return transaction(['records','sessions'],true,(tx,done)=>{
  let count=0;done(0);
  for(const key of new Set(keys)){
   const request=tx.objectStore('records').get(key);
   request.onsuccess=()=>{const r=request.result;if(!r||!r.scope?.startsWith(prefix))return;
    const deletedThrough=[...(r.entries||[]),...(r.pendingDisplays||[])].reduce((maximum,item)=>Math.max(maximum,item.id),r.deletedThrough??-1);
    tx.objectStore('records').put({key,scope:r.scope,deleted:true,deletedAt:Date.now(),deletedThrough});
    tx.objectStore('sessions').delete(key);done(++count);
   };
  }
 });
}
async function permissionStatus(){if(!navigator.storage?.persisted)return false;return navigator.storage.persisted();}
async function permission(){if(!navigator.storage?.persist)throw Error('永続保存の許可を利用できません');return navigator.storage.persist();}
function create({scope,roomId}){
 let active=null,roomName=roomId==='practice'?'練習用':roomId,persistent=false,requestingPermission=false;
 const records=new Map(),summaries=new Map();
 function renderArchives(){const select=$('log-archive'),old=select.value;select.replaceChildren(new Option('今回のログ',''));[...summaries.values()].filter(r=>r.key!==active?.key).sort((a,b)=>b.startedAt-a.startedAt).forEach(r=>select.add(new Option(new Date(r.startedAt).toLocaleString('ja-JP')+'（'+r.count+'件）',r.key)));if([...select.options].some(o=>o.value===old))select.value=old;}
 function render(){
  $('log-backup-state').textContent=active?.error?'自動保存：保存失敗':active?.savedAt?'自動保存：'+new Date(active.savedAt).toLocaleTimeString('ja-JP')+' 保存済み':'自動保存：'+(active?'保存待ち':'接続待ち');
  $('log-save-error').textContent=active?.error?'端末内に保存できませんでした。'+active.error+' 必要に応じてTXTを書き出してください。':'';
  $('log-permission-state').textContent=persistent?'ログの自動削除を防ぐ設定：有効':'ログの自動削除を防ぐ設定：未設定。ログ欄の「保存設定を許可」から設定してください';
  $('log-permission-prompt').hidden=persistent;
  $('log-permission').disabled=persistent||requestingPermission;
  $('log-export').disabled=!active&&!summaries.size;
 }
 function metadata(r){return {key:r.key,scope,roomId,roomName:r.roomName,session:r.session,filename:r.filename,startedAt:r.startedAt,updatedAt:r.updatedAt,count:r.items.size};}
 async function load(r){
  if(r.loaded)return;
  if(!r.loading)r.loading=read('records',r.key).then(saved=>{
   if(saved){r.deletedAt=saved.deletedAt||0;r.deletedThrough=saved.deletedThrough??-1;for(const i of saved.entries||[])if(valid(i)&&!r.items.has(i.id))r.items.set(i.id,i);r.startedAt=saved.startedAt||r.startedAt;r.filename=saved.filename||r.filename;r.savedAt=saved.savedAt||0;if(roomName===roomId)r.roomName=saved.roomName||roomName;}
   // Legacy pendingDisplays were unconfirmed; never promote them to displayed logs.
   r.loaded=true;
  }).finally(()=>{r.loading=null;});
  return r.loading;
 }
 function persist(r){
  r.wanted=true;if(r.saving)return r.saving;
  r.saving=(async()=>{await load(r);while(r.wanted){r.wanted=false;
   if(r.savedRevision===r.revision)continue;
   const revision=r.revision,snapshot=entries(r),savedAt=Date.now();let info;
   await transaction(['records','sessions'],true,tx=>{
    const get=tx.objectStore('records').get(r.key);
    get.onsuccess=()=>{
     const previous=get.result;
     r.deletedThrough=Math.max(r.deletedThrough??-1,previous?.deletedThrough??-1);
     r.deletedAt=Math.max(r.deletedAt||0,previous?.deletedAt||0);
     const retained=item=>item.id>r.deletedThrough&&(!r.deletedAt||((item.receivedAt||item.at||0)>r.deletedAt&&(!Number.isFinite(item.at)||item.at>r.deletedAt)));
     const kept=snapshot.filter(retained);
     for(const [id,item] of r.items)if(!retained(item))r.items.delete(id);
     info={...metadata(r),count:kept.length};
     tx.objectStore('records').put({...info,entries:kept,savedAt,deletedAt:r.deletedAt,deletedThrough:r.deletedThrough,deleted:!!r.deletedAt&&!kept.length});
     if(r.deletedAt&&!kept.length)tx.objectStore('sessions').delete(r.key);else tx.objectStore('sessions').put(info);
    };
   });
   r.savedRevision=revision;r.savedAt=savedAt;r.error='';if(r.deletedAt&&!info.count)summaries.delete(r.key);else summaries.set(r.key,info);renderArchives();render();
  }})().catch(e=>{r.error=e.message;render();}).finally(()=>{r.saving=null;});return r.saving;
 }
 function start(session){if(!session||active?.session===session)return;if(active)persist(active);const key=scope+'|'+session;
  if(!records.has(key)){const now=Date.now(),safe=v=>String(v).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,100);records.set(key,{key,session,roomName,startedAt:now,updatedAt:now,filename:'subtitle-'+safe(roomId)+'-'+now+'-'+safe(session)+'.txt',items:new Map(),revision:0,savedRevision:-1,loaded:false});}
  active=records.get(key);persist(active);renderArchives();render();
 }
 function add(item){if(!active||!valid(item)||active.items.has(item.id))return;active.items.set(item.id,{id:item.id,lines:[...item.lines],at:item.at,receivedAt:Date.now()});active.updatedAt=Date.now();active.revision++;persist(active);}
 function setRoomName(name){if(typeof name!=='string'||!name.trim())return;roomName=name;if(active&&active.roomName!==name){active.roomName=name;active.revision++;persist(active);}}
 $('log-help-open').onclick=()=>$('log-help-dialog').showModal();
 $('log-permission').onclick=async()=>{requestingPermission=true;render();$('log-permission-feedback').textContent='許可を確認中…';try{persistent=await permission();$('log-permission-feedback').textContent=persistent?'':'設定は許可されませんでした。ログの自動保存は継続します。';}catch(e){$('log-permission-feedback').textContent=e.message;}finally{requestingPermission=false;render();}};
 $('log-export').onclick=async()=>{try{const key=$('log-archive').value;if(key){const r=await read('records',key);if(!r||r.scope!==scope)throw Error('ログを読み出せません');download(r);}else if(active){try{await load(active);}catch(_){}download(active);}}catch(e){$('log-save-error').textContent='TXTを書き出せませんでした。'+e.message;}};
 const tick=()=>{if(active)persist(active);};setInterval(tick,INTERVAL);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')tick();});window.addEventListener('pagehide',tick);
 window.addEventListener('beforeunload',e=>{if(active?.items.size&&active.savedRevision!==active.revision){tick();e.preventDefault();e.returnValue='';}});
 $('log-save-help').textContent='表示した字幕は、その都度この校閲端末にのみ保存します。他のPCでは見られません。\n\n保存に失敗した場合は、5分ごとに再試行します。\n\n「TXTを生成」を押すと、選択したログをTXTファイルとしてダウンロードできます。';
 transaction(['sessions'],false,(tx,done)=>{const r=tx.objectStore('sessions').index('scope').getAll(scope);r.onsuccess=()=>done(r.result);}).then(rows=>{for(const r of rows)if(!summaries.has(r.key))summaries.set(r.key,r);renderArchives();render();}).catch(()=>{});
 permissionStatus().then(v=>{persistent=v;render();}).catch(()=>{});render();
 return Object.freeze({start,add,setRoomName});
}
window.SubtitleLogBackup=Object.freeze({create,list,read: async key=>{const r=await read('records',key);return r?.deleted?undefined:r;},remove:removeLogs,text,download,permission,permissionStatus});
})();
