const socket=SubtitleConnection.connect(),$=id=>document.getElementById(id),edit=$('edit');
let settings={columns:15,mode:'page',keyColor:'#00ff00',fontSize:32,lineCount:2,captionFont:'noto-sans-jp',textColor:'#ffffff',outline:true,fontWeight:'normal'},online={},active=null;
let throughMode=false;
const columnsStorageKey=SubtitleConnection.storageKey('columns');
const logBackup=SubtitleLogBackup.create({scope:SubtitleConnection.storageKey('log-backup'),roomId:SubtitleConnection.roomId});
function savedColumns(){try{const value=Number(localStorage.getItem(columnsStorageKey));return Number.isInteger(value)&&value>=10&&value<=40?value:null;}catch(_){return null;}}
function saveColumns(value){try{localStorage.setItem(columnsStorageKey,String(value));}catch(_){}}
let ready=false,composing=false,pending=null,blocked=false,session='',seen=new Set(),historyIds=new Set();
let deferredSettings=null,ackResult=null;
let autoTimer=null;
function operationId(){return crypto.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
const reviewerClientId=operationId();
let reviewDraft=null,inputId=0,draftChanged=false,draftGeneration=0,draftTimer=null;
// 受付確認が終わった後だけ次の先頭行を送る。新着は常に編集欄末尾へ追加する。
function scheduleThrough(){
  if(autoTimer!==null||!throughMode||!ready||pending||blocked||composing)return;
  autoTimer=setTimeout(()=>{
    autoTimer=null;
    if(throughMode&&ready&&!pending&&!blocked&&!composing)submit(1);
  },0);
}
const storageKey=SubtitleConnection.storageKey('draft');
try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved){edit.textContent=saved.draft||'';session=saved.session||'';seen=new Set(saved.seen||[]);if(saved.pending){blocked=true;$('conflict').style.display='inline-block';}}}catch(_){}
function save(){try{sessionStorage.setItem(storageKey,JSON.stringify({draft:edit.textContent,session,seen:[...seen],pending:!!pending||blocked}));}catch(_){}}
function draftPayload(){
  return {session,revision:reviewDraft.revision,inputId,text:editorText()};
}
function queueDraftSave(delay=80){
  if(!reviewDraft||!draftChanged||draftTimer!==null||!ready||pending||composing||blocked)return;
  draftTimer=setTimeout(()=>{
    draftTimer=null;
    if(!ready||!socket.connected||pending||composing||blocked)return;
    writeDraft(false);
  },delay);
}
function writeDraft(confirmed){
  const snapshot=reviewDraft,generation=draftGeneration,connection=socket.id;
  socket.timeout(4000).emit('saveReviewDraft',{...draftPayload(),confirmed},(error,result)=>{
    if(reviewDraft!==snapshot||socket.id!==connection||!ready||pending)return;
    if(error){
      if(confirmed)status('編集欄を保存できません。復旧後にもう一度再開してください。');
      else queueDraftSave(1000);
      return;
    }
    if(!result?.ok){
      requireDraftReview(result?.error||'編集欄を保存できませんでした。');
      return;
    }
    if(draftGeneration===generation)draftChanged=false;
    if(confirmed){
      blocked=false;$('conflict').style.display='none';status('送出を再開できます');
      buttons();save();scheduleThrough();
    }
    queueDraftSave();
  });
}
function draftEdited(){
  if(reviewDraft){draftChanged=true;draftGeneration++;queueDraftSave();}
  save();
}
function requireDraftReview(message){
  blocked=true;$('conflict').style.display='inline-block';status(message);buttons();save();
}
function status(text){$('status').textContent=text;}
function buttons(){['send-one','send-two','out'].forEach(id=>$(id).disabled=!ready||!!pending||blocked||composing);}
function applySettings(s){if(composing||pending){deferredSettings=s;return;}settings={...s,textColor:s.textColor||'#ffffff',outline:s.outline!==false,fontWeight:s.fontWeight==='bold'?'bold':'normal'};$('columns').value=settings.columns;$('lineCount').value=settings.lineCount;$('mode').value=settings.mode;$('keyColor').value=settings.keyColor;$('keyColorCode').value=String(settings.keyColor).toUpperCase();$('captionFont').value=settings.captionFont||'noto-sans-jp';$('textColor').value=settings.textColor;$('outline').value=settings.outline?'on':'off';$('fontWeight').value=settings.fontWeight;edit.style.width='auto';edit.style.fontFamily=CaptionLayout.font;const parent=$('edit-scroll').getBoundingClientRect(),parentStyle=getComputedStyle($('edit-scroll')),rect=edit.getBoundingClientRect(),style=getComputedStyle(edit),edge=(rect.left-parent.left)-parseFloat(parentStyle.borderLeftWidth||0)-parseFloat(style.borderLeftWidth||0)+parseFloat(style.paddingLeft);const guide=$('edit-guide');guide.style.left=edge+'px';guide.style.fontFamily=style.fontFamily;guide.style.fontSize=style.fontSize;guide.style.fontWeight=style.fontWeight;guide.innerHTML='';const marker=document.createElement('span');marker.textContent='あ'.repeat(settings.columns);guide.appendChild(marker);edit.style.backgroundImage='none';fitEditorTerminalPeriod();$('fontSize').value=settings.fontSize;CaptionView.render($('capture'),currentCaption,settings);}
for(let i=10;i<=40;i++){const o=document.createElement('option');o.value=i;o.textContent=i;$('columns').appendChild(o);}
function emitSettings(){if(ready&&!pending&&!composing)socket.emit('setSettings',{columns:Number($('columns').value),mode:$('mode').value,keyColor:$('keyColor').value,fontSize:Number($('fontSize').value),lineCount:Number($('lineCount').value),captionFont:$('captionFont').value,textColor:$('textColor').value,outline:$('outline').value==='on',fontWeight:$('fontWeight').value});}
['columns','mode','keyColor','fontSize','lineCount','captionFont','textColor','outline','fontWeight'].forEach(id=>$(id).onchange=()=>{if(id==='columns')saveColumns(Number($('columns').value));if(id==='keyColor')$('keyColorCode').value=$('keyColor').value.toUpperCase();emitSettings();});
$('keyColorCode').addEventListener('change',()=>{const value=$('keyColorCode').value.trim();if(/^#[0-9a-f]{6}$/i.test(value)){$('keyColor').value=value;$('keyColorCode').value=value.toUpperCase();emitSettings();}else $('keyColorCode').value=String(settings.keyColor).toUpperCase();});
function updateThroughMode(){const button=$('through-mode');button.textContent='スルーモード：'+(throughMode?'ON':'OFF');button.setAttribute('aria-pressed',String(throughMode));button.style.background=throughMode?'#16884b':'';}
$('through-mode').onclick=()=>{if(!ready)return;socket.emit('setThroughMode',{enabled:!throughMode},result=>{if(result&&result.ok){throughMode=!!result.enabled;updateThroughMode();status(throughMode?'スルーモード中：編集欄の先頭から自動送出します':'通常モード：新規入力を編集欄へ追加します');scheduleThrough();}});};
function receive(item){
  if(reviewDraft){
    if(item.id<=inputId)return;
    inputId=item.id;
  }else{
    if(seen.has(item.id))return;
    seen.add(item.id);
  }
  // 既存ノード、選択範囲、IME対象を一切書き換えず、別のテキストノードを末尾へ足す。
  const viewport=$('edit-scroll'),top=viewport.scrollTop,left=viewport.scrollLeft;
  const current=editorText();
  if(current&&!current.endsWith('\n'))edit.appendChild(document.createTextNode('\n'));
  const text=reviewDraft?String(item.text).replace(/\r\n?/g,'\n'):item.text;
  edit.appendChild(document.createTextNode(text));viewport.scrollTop=top;viewport.scrollLeft=left;save();scheduleThrough();
}
function monitor(){['A','B','C'].forEach(k=>{const row=$('monitor-'+k);row.classList.toggle('offline',!online[k]);row.classList.toggle('active',online[k]&&active===k);row.querySelector('label').textContent=k+'\n'+(!online[k]?'未接続':active===k?'送信担当':'接続中');if(!online[k])$('review-'+k).value='';});}
for(const k of ['A','B','C']){const row=document.createElement('div');row.id='monitor-'+k;row.className='monitor';const label=document.createElement('label');label.htmlFor='review-'+k;const field=document.createElement('textarea');field.id='review-'+k;field.readOnly=true;field.style.fontFamily=CaptionLayout.font;row.append(label,field);$('monitors').appendChild(row);}
function typing({key,value}){if(['A','B','C'].includes(key))$('review-'+key).value=value||'';}
function displayLine(text){const chars=[...String(text)];if(chars.length===settings.columns+1&&/[。、]$/.test(text))chars[chars.length-1]=chars[chars.length-1]==='。'?'｡':'､';return chars.join('');}
function displayRows(lines){return lines.flatMap(line=>CaptionLayout.wrapLine(displayLine(line),settings.columns));}
function addHistory(item){logBackup.add(item);if(historyIds.has(item.id))return;historyIds.add(item.id);const e=document.createElement('div');e.className='entry';e.textContent=item.lines.join('\n');$('sent').appendChild(e);$('sent').scrollTop=$('sent').scrollHeight;}
function renderQueue(items){
  const queue=$('queue'), previousTail=queue.lastElementChild?.dataset.captionId;
  const nextTail=items.length?String(items[items.length-1].id):null;
  const scrollTop=queue.scrollTop;
  queue.textContent='';
  items.forEach(item=>{
    const e=document.createElement('div');
    e.className='entry';
    e.dataset.captionId=String(item.id);
    e.textContent=item.lines.join('\n');
    queue.appendChild(e);
  });
  queue.scrollTop=nextTail!==null&&nextTail!==previousTail?queue.scrollHeight:scrollTop;
}
let currentCaption={id:0,lines:[]};
function display(item){currentCaption=item;CaptionView.render($('capture'),item,settings);CaptionView.confirm(socket,item);}
document.addEventListener('visibilitychange',()=>CaptionView.confirm(socket,currentCaption));
socket.on('version',v=>{$('version').textContent=v==='v29'||v==='v29.8'?'v29.8':'v29.8 / サーバー '+v;});
function prefixRange(end){const walker=document.createTreeWalker(edit,NodeFilter.SHOW_TEXT),range=document.createRange();range.setStart(edit,0);let n,offset=0;while(n=walker.nextNode()){if(offset+n.length>=end){range.setEnd(n,end-offset);return range;}offset+=n.length;}range.selectNodeContents(edit);return range;}
function editorText(){return String(edit.textContent||'').replace(/\r\n?/g,'\n');}
function manualRows(text,count){const source=String(text),parts=source.split('\n'),rows=[];let end=0;for(let i=0;i<Math.min(count,parts.length);i++){const value=parts[i];if(!value&&i===0)break;end+=value.length+(i<parts.length-1?1:0);rows.push({text:value,end});}return rows;}
function normalizeSent(text){const chars=[...String(text)];if(chars.length===settings.columns+1&&/[。、]$/.test(text))chars[chars.length-1]=chars[chars.length-1]==='。'?'｡':'､';return chars.join('');}
function submit(count){if(!ready||pending||blocked||composing)return;const text=editorText();
  if(text.startsWith('\n')){
    const viewport=$('edit-scroll'),top=viewport.scrollTop,left=viewport.scrollLeft;
    prefixRange(1).deleteContents();viewport.scrollTop=top;viewport.scrollLeft=left;
    status('先頭の空行を削除しました');draftEdited();scheduleThrough();return;
  }
  const rows=manualRows(text,count);if(!rows.length)return;
  const end=rows[rows.length-1].end,range=prefixRange(end);
  const request={id:operationId(),kind:'send',lines:rows.map(r=>r.text)};
  if(reviewDraft){request.draft=draftPayload();request.consumed=end;}
  pending={request,range,source:range.toString(),generation:draftGeneration};save();buttons();transmit();
}
function transmit(){
  if(!ready||!pending||!socket.connected)return;
  const operation=pending,connection=socket.id;
  status('送出確認待ち…');
  socket.timeout(4000).emit('captionAction',operation.request,(error,result)=>{
    if(pending!==operation||socket.id!==connection)return;
    if(error){
      status('送出確認待ち：同じIDで確認を再試行します');
      setTimeout(()=>{if(pending===operation&&socket.id===connection)transmit();},1000);
      return;
    }
    if(!result?.ok){pending=null;requireDraftReview(result?.error||'送出できませんでした');return;}
    if(composing){ackResult=result;return;}
    complete(result);
  });
}
function complete(result){
  if(!pending)return;
  const operation=pending;
  if(operation.request.draft){
    reviewDraft={...reviewDraft,revision:result.revision,lastSendId:operation.request.id};
  }
  if(operation.range && operation.range.toString()===operation.source){
    const viewport=$('edit-scroll'),top=viewport.scrollTop,left=viewport.scrollLeft;
    operation.range.deleteContents();
    viewport.scrollTop=top;viewport.scrollLeft=left;
    if(operation.request.draft&&draftGeneration===operation.generation)draftChanged=false;
    status('送出済み');
  }else if(operation.range){
    requireDraftReview('送出済みですが確認待ち中に先頭を編集したため残しました。送出済み部分を手動で整理してください。');
  }else status('字幕をアウトしました');
  pending=null;ackResult=null;
  if(deferredSettings){const s=deferredSettings;deferredSettings=null;applySettings(s);}
  buttons();save();queueDraftSave();scheduleThrough();
}
$('out').onclick=()=>{if(!ready||pending||blocked||composing)return;pending={request:{id:operationId(),kind:'out'}};save();buttons();transmit();};
$('conflict').onclick=()=>{
  if(reviewDraft){if(ready&&socket.connected&&!composing&&!pending)writeDraft(true);return;}
  blocked=false;$('conflict').style.display='none';status('送出を再開できます');save();scheduleThrough();buttons();
};
edit.addEventListener('compositionstart',()=>{composing=true;buttons();});
edit.addEventListener('compositionend',()=>{setTimeout(()=>{composing=false;if(ackResult)complete(ackResult);if(deferredSettings&&!pending){const s=deferredSettings;deferredSettings=null;applySettings(s);}save();queueDraftSave();buttons();scheduleThrough();},0);});
// 改行と貼り付けはプレーンテキスト。編集中の通常の入力はブラウザとIMEへ委ねる。
edit.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&!composing){e.preventDefault();document.execCommand('insertText',false,'\n');}});
edit.addEventListener('paste',e=>{if(composing)return;e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain').replace(/\r\n?/g,'\n'));});
edit.addEventListener('drop',e=>e.preventDefault());edit.addEventListener('input',()=>{draftEdited();scheduleThrough();});
document.addEventListener('keydown',e=>{if(e.key==='F12'){e.preventDefault();if(!e.repeat&&!e.isComposing&&document.activeElement===edit)submit(e.shiftKey?2:1);}});
$('send-one').onclick=()=>submit(1);$('send-two').onclick=()=>submit(2);
function restoreDraft(result,sameRoomSession){
  const snapshot=result.reviewDraft;
  if(!snapshot){
    if(reviewDraft||(!sameRoomSession&&pending)){
      pending=null;ackResult=null;
      requireDraftReview('編集欄を確認してから再開してください。');
    }
    reviewDraft=null;
    result.raw.forEach(receive);
    return;
  }

  const request=pending?.request;
  const accepted=request?.draft&&snapshot.lastSendId===request.id&&snapshot.revision===request.draft.revision+1;
  const sameWriter=sameRoomSession&&reviewDraft&&(snapshot.revision===reviewDraft.revision||accepted);
  reviewDraft=snapshot;
  if(sameWriter&&(pending||draftChanged||composing||blocked)){
    result.raw.forEach(receive);
    return;
  }

  inputId=snapshot.inputId;
  if(editorText()!==snapshot.text)edit.textContent=snapshot.text;
  pending=null;ackResult=null;draftChanged=false;blocked=!!snapshot.needsReview;
  $('conflict').style.display=blocked?'inline-block':'none';
}
function joinReviewer(connection){
  if(!socket.connected||socket.id!==connection)return;
  socket.timeout(4000).emit('joinReviewer',{draftProtocol:1,clientId:reviewerClientId},(error,result)=>{
    if(socket.id!==connection)return;
    if(error||result?.code==='reviewer_busy'||result?.error==='校閲者は既に接続中です'){
      status(error?'校閲サーバーへの接続を再試行しています。':'前の校閲端末の切断を待っています。');
      setTimeout(()=>joinReviewer(connection),1500);
      return;
    }
    if(!result?.ok){status(result?.error||'校閲画面に接続できませんでした。');ready=false;buttons();return;}
    loadReviewer(result);
  });
}
function loadReviewer(result){
  const sameRoomSession=session===result.session;
  if(!sameRoomSession){
    seen.clear();historyIds.clear();$('sent').textContent='';$('queue').textContent='';
  }
  session=result.session;logBackup.start(session);
  restoreDraft(result,sameRoomSession);
  ready=true;
  applySettings(result.settings);
  online=result.presence;active=result.active;throughMode=!!result.throughMode;updateThroughMode();monitor();
  const rememberedColumns=savedColumns();
  if(!result.columnsInitialized&&rememberedColumns!==null&&rememberedColumns!==settings.columns)socket.emit('setSettings',{columns:rememberedColumns});
  Object.entries(result.inputs).forEach(([key,value])=>typing({key,value}));
  result.history.forEach(addHistory);
  if(result.presentedCaption)logBackup.add(result.presentedCaption);
  renderQueue(result.waiting||[]);display(result.display);
  status(blocked?'編集欄を確認してから再開してください。':'校閲者として接続中');
  buttons();save();
  if(pending)transmit();
  else {queueDraftSave();scheduleThrough();}
}
socket.on('connect',()=>joinReviewer(socket.id));
socket.on('reviewItem',receive);socket.on('subtitleLog',addHistory);socket.on('captionLogged',item=>logBackup.add(item));socket.on('roomInfo',info=>logBackup.setRoomName(info.name));socket.on('captionQueue',renderQueue);socket.on('caption',display);socket.on('settings',applySettings);socket.on('throughMode',enabled=>{throughMode=!!enabled;updateThroughMode();scheduleThrough();});socket.on('typing',typing);socket.on('presence',s=>{online=s;monitor();});socket.on('active',s=>{active=s;monitor();});
socket.on('disconnect',()=>{ready=false;status('切断中：編集内容は保持しています');online={};monitor();buttons();});
addEventListener('pagehide',()=>socket.disconnect());
addEventListener('pageshow',event=>{if(event.persisted)socket.connect();});
$('theme').onclick=()=>{document.body.classList.toggle('light');$('theme').textContent=document.body.classList.contains('light')?'黒背景に切替':'白背景に切替';};
applySettings(settings);updateThroughMode();monitor();buttons();

new ResizeObserver(()=>CaptionView.render($('capture'),currentCaption,settings)).observe($('capture').parentElement);

// Select only the caption log when its own region has keyboard focus.
$('sent').addEventListener('keydown',event=>{
  if(!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.isComposing||event.repeat||!(event.code==='KeyA'||event.key?.toLowerCase()==='a'))return;
  event.preventDefault();event.stopPropagation();
  const selection=window.getSelection();if(!selection)return;
  const range=document.createRange();range.selectNodeContents($('sent'));selection.removeAllRanges();selection.addRange(range);
});

/* Reserve room for a terminal full stop without rewriting editable text or IME nodes. */
function fitEditorTerminalPeriod(){
  const style=getComputedStyle(edit);
  let required=0;
  for(const line of editorText().split('\n')){
    const chars=CaptionPagination.segments(line);
    if(chars.length===settings.columns+1&&chars[chars.length-1]==='。'&&!/[。、｡､]/.test(chars[chars.length-2])){
      required=Math.max(required,CaptionLayout.measure(line,edit));
    }
  }
  const padding=parseFloat(style.paddingLeft)+parseFloat(style.paddingRight);
  edit.style.minWidth=required?Math.ceil(required+padding+2)+'px':'';
}
new MutationObserver(fitEditorTerminalPeriod).observe(edit,{childList:true,characterData:true,subtree:true});
document.fonts.ready.then(fitEditorTerminalPeriod);
