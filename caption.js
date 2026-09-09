(function(){
  const rows=CaptionPagination.rows;
  function render(el,item,settings){
    const columns=item.columns||settings.columns,lineCount=item.lineCount||settings.lineCount||2;
    const visualRows=item.columns?item.lines.map(CaptionPagination.segments):rows(item.lines,columns);
    const embedded=el.parentElement.classList.contains('capture-wrap');
    const availableWidth=embedded?el.parentElement.clientWidth:innerWidth;
    const availableHeight=embedded?el.parentElement.clientHeight:innerHeight;
    const size=Math.max(1,Math.min(settings.fontSize,(availableWidth-16)/(columns+.5),(availableHeight-16)/(lineCount*1.5)));
    const outline=settings.outline!==false?'text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;':'';
    el.replaceChildren();el.style.cssText='box-sizing:content-box;padding:8px;color:'+(settings.textColor||'#ffffff')+';background:'+settings.keyColor+';font-family:'+CaptionLayout.captionFont(settings.captionFont)+';font-weight:'+(settings.fontWeight==='bold'?'bold':'normal')+';font-size:'+size+'px;line-height:1.5;width:'+ (columns+.5)+'em;height:'+ (lineCount*1.5)+'em;min-height:0;flex-shrink:0;'+outline;
    Array.from({length:lineCount},(_,i)=>visualRows[i]||[]).forEach(chars=>{const row=document.createElement('div');row.style.cssText='white-space:nowrap;min-height:1.5em';chars.forEach(ch=>{const cell=document.createElement('span');cell.textContent=ch;cell.style.cssText='display:inline-block;box-sizing:content-box;padding:0;margin:0;height:auto;min-height:0;white-space:pre;width:'+(/[｡､]/.test(ch)?'.5':'1')+'em';row.append(cell);});el.append(row);});
  }
  function confirm(socket,item){requestAnimationFrame(()=>requestAnimationFrame(()=>{socket.emit('captionPresented',{id:item.id,visible:document.visibilityState==='visible'});}));}
  window.CaptionView={rows,render,confirm};
})();
