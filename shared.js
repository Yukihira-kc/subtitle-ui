(function(){
  const font='"ＭＳ ゴシック", "MS Gothic", monospace';
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  function width(columns,size){ctx.font=size+'px '+font;return ctx.measureText('あ').width*columns;}
  function measure(text,element){
    const cs=getComputedStyle(element),span=document.createElement('span');
    span.style.cssText='position:absolute;visibility:hidden;white-space:pre;'+
      'font-family:'+cs.fontFamily+';font-size:'+cs.fontSize+';font-weight:'+cs.fontWeight+';'+
      'font-style:'+cs.fontStyle+';letter-spacing:'+cs.letterSpacing+';';
    span.textContent=text;document.body.appendChild(span);const value=span.getBoundingClientRect().width;span.remove();return value;
  }
  // 手動改行だけが送出行の境界。endは原文の削除位置（改行を含む）。
  function lines(text,columns,size=24){
    ctx.font=size+'px '+font;const max=width(columns,size),result=[];let start=0;
    while(start<text.length){
      const rest=text.slice(start),newline=rest.search(/\r\n|\r|\n/),manualEnd=newline<0?text.length:start+newline;
      const source=text.slice(start,manualEnd);
      if(!source){const nl=rest.match(/^\r\n|^\r|^\n/)[0];result.push({text:'',end:manualEnd+nl.length});start=manualEnd+nl.length;continue;}
      let used=0,end=start,content='';
      for(const {segment,index} of new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(source)){
        const w=ctx.measureText(segment).width;if(content&&used+w>max+.01)break;
        content+=segment;used+=w;end=start+index+segment.length;
      }
      if(end===start){const first=[...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(source)][0];content=first.segment;end=start+first.segment.length;}
      const hasManualEnd=end===manualEnd,nl=hasManualEnd?text.slice(manualEnd).match(/^\r\n|^\r|^\n/):null;
      const deleteEnd=hasManualEnd&&nl?manualEnd+nl[0].length:end;
      result.push({text:content,end:deleteEnd});start=deleteEnd;
    }
    return result;
  }
  window.CaptionLayout={font,width,measure,lines};
  window.CaptionLayout.wrapLine=function(text,columns){
    const out=[];let current='',used=0;
    for(const ch of [...String(text)]){
      const weight=(ch==='｡'||ch==='､')?0.5:1;
      if(current&&used+weight>columns+0.5){out.push(current);current='';used=0;}
      current+=ch;used+=weight;
    }
    if(current||!out.length)out.push(current);
    return out;
  };
})();
