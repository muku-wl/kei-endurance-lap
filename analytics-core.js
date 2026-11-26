'use strict';
const analyticsCore = function analyticsCore(){
  const parseTime=t=>{
    if(t===null||t===undefined||String(t).trim()==='')return null;
    const v=String(t).trim();
    if(/^\d{4,}$/.test(v)){
      const ms=Number(v.slice(-3)),ss=Number(v.slice(-5,-3)||'0'),mm=Number(v.slice(0,-5)||'0');
      if(ss>=60&&v.length>=6)return NaN;
      return mm*60+ss+ms/1000;
    }
    const parts=v.replace(/，/g,':').split(':');
    if(parts.length>3)return NaN;
    let sum=0;
    for(let i=0;i<parts.length;i++){
      if(!/^\d+(?:\.\d+)?$/.test(parts[i]))return NaN;
      if(i<parts.length-1&&(!/^\d+$/.test(parts[i])||(i>0&&Number(parts[i])>59)))return NaN;
      sum=sum*60+Number(parts[i]);
    }
    return sum>0&&Number.isFinite(sum)?Math.round(sum*1000)/1000:NaN;
  };
  const fmt=s=>{
    if(s===null||s===undefined||!Number.isFinite(s)||s<0)return '—';
    const h=Math.floor(s/3600),m=Math.floor(s/60)%60,ss=(s%60).toFixed(3).padStart(6,'0');
    return h?`${h}:${String(m).padStart(2,'0')}:${ss}`:`${Math.floor(s/60)}:${ss}`;
  };
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  const med=a=>{if(!a.length)return null;const v=[...a].sort((x,y)=>x-y),n=v.length;return n%2?v[(n-1)/2]:(v[n/2-1]+v[n/2])/2};
  const pct=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*p)]:null;
  const round=x=>Number.isFinite(x)?Math.round(x*1000)/1000:null;
  function derive(arr){
    const sorted=[...(Array.isArray(arr)?arr:[])].sort((a,b)=>Number(a.no)-Number(b.no)||String(a.id||'').localeCompare(String(b.id||'')));
    let prev=null;
    return sorted.map(r=>{
      const lt=parseTime(r.lap),tt=parseTime(r.total),no=Number(r.no),gap=prev?no-prev.no:0;
      let lap=lt,total=tt;const warnings=[];
      if(Number.isNaN(lt)||Number.isNaN(tt))warnings.push('入力形式');
      if(!Number.isNaN(lt)&&!Number.isNaN(tt)){
        if(lt!==null&&tt!==null&&prev&&gap===1&&prev.total!==null&&Math.abs(prev.total+lt-tt)>.01)warnings.push('タイム不一致');
        if(lt===null&&tt!==null&&prev&&gap===1&&prev.total!==null){lap=round(tt-prev.total);if(lap<=0)warnings.push('総合が逆転')}
        if(tt===null&&lt!==null&&prev&&gap===1&&prev.total!==null)total=round(prev.total+lt);
        if(tt===null&&lt!==null&&!prev&&no===1)total=lt;
        if(lt===null&&tt!==null&&!prev&&no===1)lap=tt;
      }
      if(prev&&gap>1)warnings.push((gap-1)+'周欠測');
      if(prev&&gap===0)warnings.push('周回重複');
      if(!prev&&no>1)warnings.push('先頭'+(no-1)+'周不明');
      if(lap!==null&&(!Number.isFinite(lap)||lap<=0))warnings.push('ラップ異常');
      if(total!==null&&(!Number.isFinite(total)||total<=0))warnings.push('総合異常');
      const warn=warnings.length>0;
      const driver=String(r.driver||'').trim()||'未指定';
      const item={...r,no,driver,derivedLap:lap,derivedTotal:total,flag:warn?warnings.join('・'):(lap!==null&&total!==null?'OK':'部分記録'),warn,notes:String(r.note||''),reasons:[],clean:false};
      prev={no,total:Number.isFinite(total)?total:null};
      return item;
    });
  }
  function analyze(records,radius=1,outlier=false){
    const rows=derive(records),transitions=[],stints=[];
    const pitPattern=/(ピット|pit[\s-]*(?:in|out|stop)?|交代|給油|燃料補給|ドライバーチェンジ|休憩|停車)/i;
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      if(r.warn)r.reasons.push('要確認');
      if(!Number.isFinite(r.derivedLap)||r.derivedLap<=0)r.reasons.push('タイム不明');
      if(pitPattern.test(r.notes))r.reasons.push('メモにピット等');
      if(r.yellowAtRecord===true)r.reasons.push('計測時イエロー');
      if(i>0){
        const p=rows[i-1];
        if(p.driver!==r.driver&&p.driver!=='未指定'&&r.driver!=='未指定')
          transitions.push({from:p.driver,to:r.driver,prevIndex:i-1,nextIndex:i,prevNo:p.no,nextNo:r.no,elapsedBefore:Number.isFinite(p.derivedTotal)?p.derivedTotal:null,elapsedAfter:Number.isFinite(r.derivedTotal)?r.derivedTotal:null,oldLap:p.derivedLap,newLap:r.derivedLap,gap:r.no-p.no>1});
      }
    }
    for(const t of transitions){
      for(let i=Math.max(0,t.prevIndex-radius+1);i<=Math.min(rows.length-1,t.nextIndex+radius-1);i++){
        if(!rows[i].reasons.includes('交代前後'))rows[i].reasons.push('交代前後');
      }
    }
    if(outlier){
      const perDriver=new Map();
      for(const r of rows)if(!r.reasons.length&&Number.isFinite(r.derivedLap)){
        if(!perDriver.has(r.driver))perDriver.set(r.driver,[]);
        perDriver.get(r.driver).push(r.derivedLap);
      }
      for(const r of rows)if(!r.reasons.length&&Number.isFinite(r.derivedLap)){
        const v=perDriver.get(r.driver)||[],mid=med(v);
        if(v.length>=5&&mid!==null&&r.derivedLap>mid*1.2)r.reasons.push('中央値の120%超');
      }
    }
    rows.forEach(r=>r.clean=r.reasons.length===0);
    let stint=null;
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      if(!stint||stint.driver!==r.driver){
        if(stint)stints.push(stint);
        stint={driver:r.driver,firstNo:r.no,lastNo:r.no,startIndex:i,endIndex:i,lapCount:0,firstElapsed:null,lastElapsed:null,duration:null};
      }
      stint.lapCount++;stint.lastNo=r.no;stint.endIndex=i;
    }
    if(stint)stints.push(stint);
    for(const s of stints){
      const first=rows[s.startIndex],last=rows[s.endIndex],prev=rows[s.startIndex-1];
      const start=s.startIndex===0?(first.no===1?0:null):(prev&&prev.no+1===first.no&&Number.isFinite(prev.derivedTotal)?prev.derivedTotal:null);
      s.firstElapsed=start;s.lastElapsed=Number.isFinite(last.derivedTotal)?last.derivedTotal:null;
      s.duration=(start!==null&&s.lastElapsed!==null&&s.lastElapsed>=start)?s.lastElapsed-start:null;
      const valid=rows.slice(s.startIndex,s.endIndex+1).filter(r=>r.clean);
      s.validCount=valid.length;s.cleanAvg=avg(valid.map(r=>r.derivedLap));
    }
    const group=new Map();
    for(const r of rows){if(!group.has(r.driver))group.set(r.driver,[]);group.get(r.driver).push(r);}
    const driverStats=Array.from(group.entries()).map(([driver,rs])=>{
      const values=rs.filter(r=>r.clean).map(r=>r.derivedLap),a=avg(values);
      const sd=a!==null&&values.length>1?Math.sqrt(values.reduce((acc,x)=>acc+(x-a)**2,0)/values.length):null;
      const third=Math.max(1,Math.floor(values.length/3));
      const early=values.length>=4?avg(values.slice(0,third)):null,late=values.length>=4?avg(values.slice(-third)):null;
      return {driver,rows:rs,count:rs.length,cleanCount:values.length,excludedCount:rs.length-values.length,average:a,median:med(values),best:values.length?Math.min(...values):null,sd,early,late,delta:early!==null&&late!==null?late-early:null};
    }).sort((a,b)=>(a.driver==='未指定'?1:0)-(b.driver==='未指定'?1:0)||((a.average??Infinity)-(b.average??Infinity)));
    const byDriver=new Map(driverStats.map(x=>[x.driver,x]));
    for(const t of transitions){
      const a=byDriver.get(t.from),b=byDriver.get(t.to);
      const slowA=Number.isFinite(t.oldLap)&&a&&a.median!==null?Math.max(0,t.oldLap-a.median):null;
      const slowB=Number.isFinite(t.newLap)&&b&&b.median!==null?Math.max(0,t.newLap-b.median):null;
      t.slowOld=slowA;t.slowNew=slowB;t.referenceLoss=slowA!==null&&slowB!==null?slowA+slowB:null;
    }
    const clean=rows.filter(r=>r.clean),valid=rows.filter(r=>Number.isFinite(r.derivedLap)&&r.derivedLap>0&&!r.warn);
    return {rows,clean,valid,transitions,stints,driverStats,cleanAverage:avg(clean.map(r=>r.derivedLap)),cleanMedian:med(clean.map(r=>r.derivedLap)),best:valid.length?Math.min(...valid.map(r=>r.derivedLap)):null,finalLap:rows.length?Math.max(...rows.map(r=>r.no)):0,warnings:rows.filter(r=>r.warn).length};
  }
  return {analyze,derive,parseTime,fmt,avg,med,pct,round};
};
