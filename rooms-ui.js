(function(){
  'use strict';
  const C=SubtitleConnection,$=id=>document.getElementById(id),params=new URLSearchParams(location.search);
  const directNext=['index.html','reviewer.html','output.html'].includes(params.get('next'))?params.get('next'):'index.html';
  let selected=null,selection=0,busy=false;
  function resetFields(id){$(id).querySelectorAll('input').forEach(input=>{input.value='';});}
  function clearEntryFields(){for(const id of ['create-form','join-form','password-form'])resetFields(id);}
  function normalizePassword(value){return value.replace(/[０-９]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xfee0));}
  function normalizeField(input){input.value=normalizePassword(input.value);}
  for(const id of ['new-password','join-password','change-password']){
    const input=$(id);input.addEventListener('input',e=>{if(!e.isComposing)normalizeField(input);});input.addEventListener('compositionend',()=>normalizeField(input));
  }
  function takePassword(id){const input=$(id),value=normalizePassword(input.value);input.value='';return value;}
  // These are room access controls, not a website account login. Avoid native
  // login-form submission and clear secrets before any request or navigation.
  function bindAction(id,handler){
    const group=$(id);
    const run=()=>{if(busy)return;for(const input of group.querySelectorAll('input')){if(input.type==='password')normalizeField(input);if(!input.reportValidity())return;}handler();};
    group.querySelector('[data-action]').onclick=run;
    group.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229&&e.target.matches('input')){e.preventDefault();run();}});
  }
  clearEntryFields();
  window.addEventListener('pagehide',clearEntryFields);
  window.addEventListener('pageshow',clearEntryFields);
  function status(message,ok=false){
    $('status').textContent=message;$('status').classList.toggle('ok',ok);
    for(const [dialog,notice] of [['join-dialog','join-status'],['manage-dialog','manage-status']])if($(dialog).open)$(notice).textContent=message;
  }
  function link(page,id){const u=new URL(page,location.href);u.search='';u.hash='';u.searchParams.set('room',id);return u.href;}
  function dismiss(){
    ++selection;selected=null;
    for(const id of ['join-dialog','manage-dialog'])if($(id).open)$(id).close();
    resetFields('join-form');resetFields('password-form');
    history.replaceState(null,'',new URL('rooms.html',location.href));
    status('練習用を選ぶか、案件ルームを作成してください。',true);
  }
  function proceed(){
    if(!selected)return;
    const {room,purpose,next}=selected;
    if($('join-dialog').open)$('join-dialog').close();resetFields('join-form');
    if(purpose==='manage'){
      $('manage-title').textContent=room.name+' の管理';$('manage-status').textContent='';resetFields('password-form');$('manage-dialog').showModal();
    }else{status('担当選択画面へ移動します。',true);location.assign(link(next,room.id));}
  }
  async function select(id,purpose='enter',next='index.html'){
    const ticket=++selection;selected=null;status('ルームを確認中…');
    const {room}=await C.api('/rooms/'+encodeURIComponent(id));if(ticket!==selection)return;
    selected={room,purpose,next};
    if(room.practice){if(purpose==='enter')proceed();return;}
    if(C.token(id)){
      try{await C.api('/rooms/'+id+'/join',{method:'POST',token:C.token(id),body:'{}'});if(ticket===selection)proceed();return;}
      catch(e){if(ticket!==selection)return;if(e.status!==401&&e.status!==403)throw e;C.remember(id,'');}
    }
    $('join-title').textContent=room.name;$('join-purpose').textContent=purpose==='manage'?'ルームを管理するにはパスワードで認証してください。':'認証後、A・B・Cの担当選択画面へ進みます。';
    $('join-password').maxLength=room.pin4?4:128;if(room.pin4)$('join-password').setAttribute('pattern','[0-9]{4}');else $('join-password').removeAttribute('pattern');
    $('join-status').textContent='';$('join-password').value='';$('join-dialog').showModal();$('join-password').focus();
    $('status').textContent='パスワードを入力してください。';
  }
  async function refresh(){
    const {rooms}=await C.api('/rooms');$('room-list').replaceChildren();
    rooms.forEach(room=>{
      const row=document.createElement('div');row.className='room row';
      const name=document.createElement('div');name.className='room-name';name.textContent=room.name;
      const hint=document.createElement('small');hint.textContent=room.practice?'フリー枠・パスワードなし':'パスワードが必要';name.append(hint);
      const buttons=document.createElement('div');buttons.className='row';
      const enter=document.createElement('button');enter.type='button';enter.textContent='入室';enter.onclick=()=>action(()=>select(room.id));buttons.append(enter);
      if(!room.practice){const manage=document.createElement('button');manage.type='button';manage.textContent='管理';manage.onclick=()=>action(()=>select(room.id,'manage'));buttons.append(manage);}
      row.append(name,buttons);$('room-list').append(row);
    });
  }
  async function action(fn){if(busy)return;busy=true;document.querySelectorAll('button:not([data-close])').forEach(b=>b.disabled=true);try{await fn();}catch(e){status(e.message);}finally{busy=false;document.querySelectorAll('button:not([data-close])').forEach(b=>b.disabled=false);}}
  document.querySelectorAll('[data-close]').forEach(button=>button.onclick=dismiss);
  for(const id of ['join-dialog','manage-dialog'])$(id).addEventListener('cancel',e=>{e.preventDefault();dismiss();});
  $('refresh').onclick=()=>action(async()=>{await refresh();status('ルーム一覧を更新しました。',true);});
  bindAction('create-form',()=>{const name=$('new-name').value,password=takePassword('new-password');action(async()=>{
    const data=await C.api('/rooms',{method:'POST',body:JSON.stringify({name,password})});
    C.remember(data.room.id,data.token);resetFields('create-form');selected={room:data.room,purpose:'enter',next:'index.html'};proceed();
  });});
  bindAction('join-form',()=>{if(!selected)return;const {room}=selected,ticket=selection,password=takePassword('join-password');action(async()=>{
    const data=await C.api('/rooms/'+room.id+'/join',{method:'POST',body:JSON.stringify({password})});
    if(ticket!==selection)return;C.remember(room.id,data.token);proceed();
  });});
  bindAction('password-form',()=>{if(!selected||selected.purpose!=='manage'||selected.room.practice)return;const {room}=selected;if(!confirm('このルームの接続中の画面が切断され、新しいパスワードでの再入室が必要になります。変更しますか？'))return;const password=takePassword('change-password');action(async()=>{
    const data=await C.api('/rooms/'+room.id+'/password',{method:'PATCH',token:C.token(room.id),body:JSON.stringify({password})});
    C.remember(room.id,data.token);resetFields('password-form');status('パスワードを変更しました。各担当者は新しいパスワードで再入室してください。',true);
  });});
  $('delete-room').onclick=()=>{if(!selected||selected.purpose!=='manage'||selected.room.practice)return;const {room}=selected;if(!confirm('「'+room.name+'」を削除しますか？接続中の画面が切断され、原稿・字幕・ログも消えます。'))return;action(async()=>{
    await C.api('/rooms/'+room.id,{method:'DELETE',token:C.token(room.id)});C.remember(room.id,'');dismiss();await refresh();status('案件ルームを削除しました。',true);
  });};
  $('forget-room').onclick=()=>{if(selected){C.remember(selected.room.id,'');dismiss();status('このブラウザの入室情報を解除しました。',true);}};
  action(async()=>{await refresh();if(params.get('room'))await select(params.get('room'),'enter',directNext);else status('練習用を選ぶか、案件ルームを作成してください。',true);});
})();
