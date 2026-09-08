const socket=SubtitleConnection.connect(),$=id=>document.getElementById(id),edit=$('edit');
let settings={columns:20,mode:'page',keyColor:'#00ff00',fontSize:32,lineCount:2},online={},active=null;
let ready=false,composing=false,pending=null,blocked=false,session='',seen=new Set(),historyIds=new Set();
let deferredSettings=null,ackResult=null;
const storageKey='subtitle-review-v3';
try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved){edit.textContent=saved.draft||'';session=saved.session||'';seen=new Set(saved.seen||[]);if(saved.pending){blocked=true;$('conflict').style.display='inline-block';}}}catch(_){}
function save(){try{sessionStorage.setItem(storageKey,JSON.stringify({draft:edit.textContent,session,seen:[...seen],pending:!!pending||blocked}));}catch(_){}}
function status(text){$('status').textContent=text;}
function buttons(){['send-one','send-two','out'].forEach(id=>$(id).disabled=!ready||!!pending||blocked||composing);}
function applySettings(s){if(composing||pending){deferredSettings=s;return;}settings=s;$('columns').value=s.columns;$('lineCount').value=s.lineCount;$('mode').value=s.mode;$('keyColor').value=s.keyColor;edit.style.width='auto';edit.style.fontFamily=CaptionLayout.font;const parent=$('edit-scroll').getBoundingClientRect(),parentStyle=getComputedStyle($('edit-scroll')),rect=edit.getBoundingClientRect(),style=getComputedStyle(edit),edge=(rect.left-parent.left)-parseFloat(parentStyle.borderLeftWidth||0)-parseFloat(style.borderLeftWidth||0)+parseFloat(style.paddingLeft);const guide=$('edit-guide');guide.style.left=edge+'px';guide.style.fontFamily=style.fontFamily;guide.style.fontSize=style.fontSize;guide.style.fontWeight=style.fontWeight;guide.innerHTML='';const marker=document.createElement('span');marker.textContent='あ'.repeat(s.columns);guide.appendChild(marker);edit.style.backgroundImage='none';$('fontSize').value=s.fontSize;CaptionView.render($('capture'),currentCaption,s);}
for(let i=10;i<=40;i++){const o=document.createElement('option');o.value=i;o.textContent=i;$('columns').appendChild(o);}
['columns','mode','keyColor','fontSize','lineCount'].forEach(id=>$(id).onchange=()=>{if(ready&&!pending&&!composing)socket.emit('setSettings',{columns:Number($('columns').value),mode:$('mode').value,keyColor:$('keyColor').value,fontSize:Number($('fontSize').value),lineCount:Number($('lineCount').value)});});
function receive(item){if(seen.has(item.id))return;seen.add(item.id);
  // 既存ノード、選択範囲、IME対象を一切書き換えず、別のテキストノードを末尾へ足す。
  const viewport=$('edit-scroll'),top=viewport.scrollTop,left=viewport.scrollLeft;
  const current=editorText();
  if(current&&!current.endsWith('\n'))edit.appendChild(document.createTextNode('\n'));
  edit.appendChild(document.createTextNode(item.text));viewport.scrollTop=top;viewport.scrollLeft=left;save();
}
function monitor(){['A','B','C'].forEach(k=>{const row=$('monitor-'+k);row.classList.toggle('offline',!online[k]);row.classList.toggle('active',online[k]&&active===k);row.querySelector('label').textContent=k+'\n'+(!online[k]?'未接続':active===k?'送信担当':'接続中');if(!online[k])$('review-'+k).value='';});}
for(const k of ['A','B','C']){const row=document.createElement('div');row.id='monitor-'+k;row.className='monitor';const label=document.createElement('label');label.htmlFor='review-'+k;const field=document.createElement('textarea');field.id='review-'+k;field.readOnly=true;field.style.fontFamily=CaptionLayout.font;row.append(label,field);$('monitors').appendChild(row);}
function typing({key,value}){if(['A','B','C'].includes(key))$('review-'+key).value=value||'';}
function displayLine(text){const chars=[...String(text)];if(chars.length===settings.columns+1&&/[。、]$/.test(text))chars[chars.length-1]=chars[chars.length-1]==='。'?'｡':'､';return chars.join('');}
function displayRows(lines){return lines.flatMap(line=>CaptionLayout.wrapLine(displayLine(line),settings.columns));}
function addHistory(item){if(historyIds.has(item.id))return;historyIds.add(item.id);const e=document.createElement('div');e.className='entry';e.textContent=item.lines.join('\n');$('sent').appendChild(e);$('sent').scrollTop=$('sent').scrollHeight;}
function renderQueue(items){$('queue').textContent='';items.forEach(item=>{const e=document.createElement('div');e.className='entry';e.textContent=item.lines.join('\n');$('queue').appendChild(e);});}
let currentCaption={id:0,lines:[]};
function display(item){currentCaption=item;CaptionView.render($('capture'),item,settings);CaptionView.confirm(socket,item);}
document.addEventListener('visibilitychange',()=>CaptionView.confirm(socket,currentCaption));
socket.on('version',v=>{$('version').textContent=v==='v24'?'v24':'v24 / サーバー '+v;});
function prefixRange(end){const walker=document.createTreeWalker(edit,NodeFilter.SHOW_TEXT),range=document.createRange();range.setStart(edit,0);let n,offset=0;while(n=walker.nextNode()){if(offset+n.length>=end){range.setEnd(n,end-offset);return range;}offset+=n.length;}range.selectNodeContents(edit);return range;}
function editorText(){return String(edit.textContent||'').replace(/\r\n?/g,'\n');}
function manualRows(text,count){const source=String(text),parts=source.split('\n'),rows=[];let end=0;for(let i=0;i<Math.min(count,parts.length);i++){const value=parts[i];if(!value&&i===0)break;end+=value.length+(i<parts.length-1?1:0);rows.push({text:value,end});}return rows;}
function normalizeSent(text){const chars=[...String(text)];if(chars.length===settings.columns+1&&/[。、]$/.test(text))chars[chars.length-1]=chars[chars.length-1]==='。'?'｡':'､';return chars.join('');}
function submit(count){if(!ready||pending||blocked||composing)return;const rows=manualRows(editorText(),count);if(!rows.length)return;
  const end=rows[rows.length-1].end,range=prefixRange(end);
  pending={request:{id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),kind:'send',lines:rows.map(r=>r.text)},range,source:range.toString()};save();buttons();transmit();
}
function transmit(){if(!ready||!pending)return;const operation=pending;status('送出確認待ち…');socket.timeout(4000).emit('captionAction',operation.request,(err,result)=>{if(pending!==operation)return;if(err){status('送出確認待ち：同じIDで確認を再試行します');setTimeout(()=>{if(pending===operation)transmit();},1000);return;}if(!result.ok){status(result.error||'送出できませんでした');pending=null;buttons();save();return;}if(composing){ackResult=result;return;}complete();});}
function complete(){if(!pending)return;const op=pending;
  if(op.range){if(op.range.toString()===op.source){const viewport=$('edit-scroll'),top=viewport.scrollTop,left=viewport.scrollLeft;op.range.deleteContents();viewport.scrollTop=top;viewport.scrollLeft=left;status('送出済み');}else{blocked=true;$('conflict').style.display='inline-block';status('送出済みですが確認待ち中に先頭を編集したため残しました。送出済み部分を手動で整理してください。');}}
  else status('字幕をアウトしました');pending=null;ackResult=null;if(deferredSettings){const s=deferredSettings;deferredSettings=null;applySettings(s);}buttons();save();
}
$('out').onclick=()=>{if(!ready||pending||blocked||composing)return;pending={request:{id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),kind:'out'}};save();buttons();transmit();};
$('conflict').onclick=()=>{blocked=false;$('conflict').style.display='none';status('送出を再開できます');save();buttons();};
edit.addEventListener('compositionstart',()=>{composing=true;buttons();});
edit.addEventListener('compositionend',()=>{setTimeout(()=>{composing=false;if(ackResult)complete();if(deferredSettings&&!pending){const s=deferredSettings;deferredSettings=null;applySettings(s);}save();buttons();},0);});
// 改行と貼り付けはプレーンテキスト。編集中の通常の入力はブラウザとIMEへ委ねる。
edit.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&!composing){e.preventDefault();document.execCommand('insertText',false,'\n');}});
edit.addEventListener('paste',e=>{if(composing)return;e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain').replace(/\r\n?/g,'\n'));});
edit.addEventListener('drop',e=>e.preventDefault());edit.addEventListener('input',save);
document.addEventListener('keydown',e=>{if(e.key==='F12'){e.preventDefault();if(!e.repeat&&!e.isComposing&&document.activeElement===edit)submit(e.shiftKey?2:1);}});
$('send-one').onclick=()=>submit(1);$('send-two').onclick=()=>submit(2);
socket.on('connect',()=>socket.emit('joinReviewer',{},result=>{if(!result.ok){status(result.error);ready=false;buttons();return;}if(session&&session!==result.session&&pending){blocked=true;pending=null;$('conflict').style.display='inline-block';}if(session!==result.session){seen.clear();historyIds.clear();$('sent').textContent='';$('queue').textContent='';}session=result.session;ready=true;applySettings(result.settings);online=result.presence;active=result.active;monitor();Object.entries(result.inputs).forEach(([key,value])=>typing({key,value}));result.raw.forEach(receive);result.history.forEach(addHistory);renderQueue(result.waiting||[]);display(result.display);status(blocked?'送出済み部分を整理してから再開してください':'校閲者として接続中');buttons();save();if(pending)transmit();}));
socket.on('reviewItem',receive);socket.on('subtitleLog',addHistory);socket.on('captionQueue',renderQueue);socket.on('caption',display);socket.on('settings',applySettings);socket.on('typing',typing);socket.on('presence',s=>{online=s;monitor();});socket.on('active',s=>{active=s;monitor();});
socket.on('disconnect',()=>{ready=false;status('切断中：編集内容は保持しています');online={};monitor();buttons();});
$('theme').onclick=()=>{document.body.classList.toggle('light');$('theme').textContent=document.body.classList.contains('light')?'黒背景に切替':'白背景に切替';};
applySettings(settings);monitor();buttons();

new ResizeObserver(()=>CaptionView.render($('capture'),currentCaption,settings)).observe($('capture').parentElement);
