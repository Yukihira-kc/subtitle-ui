(function(){
  'use strict';
  const C=SubtitleConnection,$=id=>document.getElementById(id),params=new URLSearchParams(location.search);
  const next=['index.html','reviewer.html','output.html'].includes(params.get('next'))?params.get('next'):null;
  let selected=null,selection=0,busy=false;
  function status(message,ok=false){$('status').textContent=message;$('status').classList.toggle('ok',ok);}
  function link(page,id){const u=new URL(page,location.href);u.search='';u.hash='';u.searchParams.set('room',id);return u.href;}
  function tools(room){selected=room;$('selected').hidden=false;$('selected-name').textContent=room.name;$('join-form').hidden=true;$('room-tools').hidden=false;$('management').hidden=room.practice;$('management').open=false;
    $('operator-link').href=link('index.html',room.id);$('reviewer-link').href=link('reviewer.html',room.id);$('output-link').href=link('output.html',room.id);$('invite-url').value=link('rooms.html',room.id);status(room.practice?'練習用は誰でも利用できます。':'入室できました。使う画面を選んでください。',true);
  }
  async function select(id,fromDirect=false){
    const ticket=++selection;selected=null;$('selected').hidden=true;status('ルームを確認中…');
    try{
      const {room}=await C.api('/rooms/'+encodeURIComponent(id));if(ticket!==selection)return;
      selected=room;$('selected').hidden=false;$('selected-name').textContent=room.name;$('room-tools').hidden=true;$('join-form').hidden=true;
      const address=new URL(location.href);address.searchParams.set('room',id);history.replaceState(null,'',address);
      if(room.practice){tools(room);if(fromDirect&&next)location.assign(link(next,id));return;}
      if(C.token(id)){
        try{await C.api('/rooms/'+id+'/join',{method:'POST',token:C.token(id),body:'{}'});if(ticket!==selection)return;tools(room);if(fromDirect&&next)location.assign(link(next,id));return;}
        catch(e){if(ticket!==selection)return;if(e.status!==401&&e.status!==403)throw e;C.remember(id,'');}
      }
      $('join-form').hidden=false;$('join-password').value='';$('join-password').focus();status('パスワードを入力して入室してください。');
    }catch(e){if(ticket===selection)status(e.message);}
  }
  async function refresh(){
    const {rooms}=await C.api('/rooms');$('room-list').replaceChildren();
    rooms.forEach(room=>{const row=document.createElement('div');row.className='room row';const name=document.createElement('div');name.className='room-name';name.textContent=room.name;const hint=document.createElement('small');hint.textContent=room.practice?'フリー枠・パスワードなし':'パスワードが必要';name.append(hint);const button=document.createElement('button');button.type='button';button.textContent='選択';button.onclick=()=>select(room.id);row.append(name,button);$('room-list').append(row);});
  }
  async function action(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){status(e.message);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
  $('refresh').onclick=()=>action(async()=>{await refresh();status('ルーム一覧を更新しました。',true);});
  $('create-form').onsubmit=e=>{e.preventDefault();action(async()=>{const data=await C.api('/rooms',{method:'POST',body:JSON.stringify({name:$('new-name').value,password:$('new-password').value})});C.remember(data.room.id,data.token);$('create-form').reset();++selection;tools(data.room);history.replaceState(null,'',link('rooms.html',data.room.id));await refresh();});};
  $('join-form').onsubmit=e=>{e.preventDefault();if(!selected)return;const room=selected,ticket=selection;action(async()=>{const data=await C.api('/rooms/'+room.id+'/join',{method:'POST',body:JSON.stringify({password:$('join-password').value})});C.remember(room.id,data.token);$('join-password').value='';if(ticket!==selection)return;tools(data.room);if(next)location.assign(link(next,room.id));});};
  $('password-form').onsubmit=e=>{e.preventDefault();if(!selected||selected.practice)return;const room=selected;if(!confirm('このルームの接続中の画面が切断され、新しいパスワードでの再入室が必要になります。変更しますか？'))return;action(async()=>{const data=await C.api('/rooms/'+room.id+'/password',{method:'PATCH',token:C.token(room.id),body:JSON.stringify({password:$('change-password').value})});C.remember(room.id,data.token);$('password-form').reset();status('パスワードを変更しました。各担当者は新しいパスワードで再入室してください。',true);});};
  $('delete-room').onclick=()=>{if(!selected||selected.practice)return;const room=selected;if(!confirm('「'+room.name+'」を削除しますか？接続中の画面が切断され、原稿・字幕・ログも消えます。'))return;action(async()=>{await C.api('/rooms/'+room.id,{method:'DELETE',token:C.token(room.id)});C.remember(room.id,'');selected=null;++selection;$('selected').hidden=true;history.replaceState(null,'','rooms.html');await refresh();status('案件ルームを削除しました。',true);});};
  $('forget-room').onclick=()=>{if(selected){const id=selected.id;C.remember(id,'');select(id);}};
  $('copy-url').onclick=()=>action(async()=>{try{await navigator.clipboard.writeText($('invite-url').value);status('共有URLをコピーしました。',true);}catch(_){$('invite-url').select();status('共有URLを選択しました。Ctrl+Cでコピーしてください。');}});
  action(async()=>{await refresh();if(params.get('room'))await select(params.get('room'),true);else status('練習用を選ぶか、案件ルームを作成してください。',true);});
})();
