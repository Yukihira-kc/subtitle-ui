// The shared connection never joins a private room before server authentication.
(function(){
  'use strict';
  const url=['localhost','127.0.0.1'].includes(location.hostname)?location.origin:'https://subtitle-server-czoz.onrender.com';
  const params=new URLSearchParams(location.search),roomId=params.get('room')||'';
  const isLobby=/\/rooms\.html$/.test(location.pathname);
  const pages=['index.html','reviewer.html','output.html'];
  const page=location.pathname.split('/').pop()||'index.html';
  const prefix='subtitle-v29:'+url+':'+roomId+':';
  const tokenKey=id=>'subtitle-v29:'+url+':'+id+':token';
  function token(id=roomId){try{return localStorage.getItem(tokenKey(id))||'';}catch(_){return '';}}
  function remember(id,value){try{if(value)localStorage.setItem(tokenKey(id),value);else localStorage.removeItem(tokenKey(id));}catch(_){throw new Error('入室情報を保存できません。ブラウザのサイトデータ保存を許可してください。');}}
  function lobby(reason){const u=new URL('rooms.html',location.href);if(roomId)u.searchParams.set('room',roomId);if(pages.includes(page))u.searchParams.set('next',page);if(reason)u.searchParams.set('reason',reason);return u.href;}
  async function api(path,options={}){
    const {token:authToken,...init}=options;
    const response=await fetch(url+'/api'+path,{...init,headers:{'Content-Type':'application/json',...(authToken?{Authorization:'Bearer '+authToken}:{}),...init.headers},cache:'no-store'});
    let data;try{data=await response.json();}catch(_){throw new Error('サーバーの更新中、または接続できない状態です。少し待って再試行してください。');}
    if(!response.ok){const e=new Error(data.error||'通信に失敗しました。');e.status=response.status;throw e;}return data;
  }
  if(!isLobby){
    const style=document.createElement('style');style.id='room-auth-cover';style.textContent='body{visibility:hidden!important}';document.head.appendChild(style);
    if(!roomId||roomId!=='practice'&&!token())location.replace(lobby());
  }
  function showRoom(info){
    const reveal=()=>{
      document.getElementById('room-auth-cover')?.remove();
      document.title=info.name+' | '+document.title.replace(/^.* \| /,'');
      document.querySelectorAll('a[href]').forEach(a=>{const target=new URL(a.getAttribute('href'),location.href);if(target.origin===location.origin&&pages.includes(target.pathname.split('/').pop())){target.searchParams.set('room',roomId);a.href=target.href;}});
      // The output page must remain a clean caption-only surface after authentication.
      if(page==='output.html'||document.getElementById('room-nav'))return;
      const nav=document.createElement('div');nav.id='room-nav';nav.style.cssText='display:flex;gap:14px;align-items:center;flex-wrap:wrap;font:14px Meiryo,sans-serif;padding:5px 0;flex-shrink:0';
      const name=document.createElement('strong');name.textContent=info.name;
      const link=document.createElement('a');const managementUrl=new URL('rooms.html',location.href);link.href=managementUrl.href;link.textContent='ルーム選択・管理';link.style.color='#72b7ff';nav.append(name,link);document.body.prepend(nav);
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',reveal,{once:true});else reveal();
  }
  function connect(){
    let connectionToken='';
    const socket=io(url,{autoConnect:false,auth:cb=>{connectionToken=token();cb({roomId,token:connectionToken});}});
    socket.on('roomInfo',showRoom);
    function reauthenticate(){try{if(token()===connectionToken)remember(roomId,'');}catch(_){}location.replace(lobby('auth'));}
    socket.on('roomRevoked',reauthenticate);
    socket.on('connect_error',error=>{if(error.data?.code==='ROOM_AUTH')reauthenticate();});
    if(roomId&&(roomId==='practice'||token()))socket.connect();
    return socket;
  }
  // Reveal operator role buttons after validating the room, before its socket is created.
  if(!isLobby&&roomId&&(roomId==='practice'||token())){
    const check=async()=>{
      try{const data=await api('/rooms/'+encodeURIComponent(roomId)+'/join',{method:'POST',token:token(),body:'{}'});showRoom(data.room);}
      catch(e){if(e.status===401||e.status===403||e.status===404){try{remember(roomId,'');}catch(_){}location.replace(lobby('auth'));}else{
        const display=()=>{document.getElementById('room-auth-cover')?.remove();const warning=document.createElement('div');warning.textContent='接続を確認中です。通信が戻るまで操作をお待ちください。';warning.style.cssText='background:#562c15;color:white;padding:10px';document.body.prepend(warning);setTimeout(()=>{warning.remove();check();},5000);};
        if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',display,{once:true});else display();
      }}
    };check();
  }
  window.SubtitleConnection=Object.freeze({version:'v29.1',url,roomId,storageKey:key=>prefix+key,connect,api,token,remember});
})();
