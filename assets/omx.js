/* Indexdata v16: Nasdaq Stockholm-kalender och OMXS30-widgetar.
   Indexpriserna återges av TradingView. Inga kurser eller procentsatser skapas här. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const CLOSED={
  2026:new Set(['01-01','01-06','04-03','04-06','05-01','05-14','06-19','12-24','12-25','12-31']),
  2027:new Set(['01-01','01-06','03-26','03-29','05-06','06-25','12-24','12-31'])
};
const HALF_DAYS={
  2026:new Set(['01-05','04-02','04-30','05-13','10-30']),
  2027:new Set(['01-05','03-25','04-30','05-05','11-05'])
};
const PERIODS=new Set(['1D','1W','1M','3M','6M','YTD','12M','36M','60M','ALL']);
let selected='1D';
function parts(date){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
    hourCycle:'h23',timeZone:'Europe/Stockholm'
  }).formatToParts(date).map(x=>[x.type,x.value]));
  return {year:+p.year,month:+p.month,day:+p.day,minutes:+p.hour*60+(+p.minute)};
}
function schedule(date){
  const p=parts(date),wk=new Date(Date.UTC(p.year,p.month-1,p.day)).getUTCDay();
  const mmdd=String(p.month).padStart(2,'0')+'-'+String(p.day).padStart(2,'0');
  const closed=wk===0||wk===6||Boolean(CLOSED[p.year]?.has(mmdd));
  const halfDay=Boolean(HALF_DAYS[p.year]?.has(mmdd));
  const closingMinutes=halfDay?13*60:17*60+30;
  return {open:!closed&&p.minutes>=540&&p.minutes<closingMinutes,closed,halfDay,closingMinutes,parts:p,verified:Boolean(CLOSED[p.year])};
}
function nextOpen(date){
  const p=parts(date);
  for(let i=0;i<20;i++){
    // Mitt på dagen UTC för att inte påverkas av omställning mellan vinter-/sommartid.
    const day=new Date(Date.UTC(p.year,p.month-1,p.day+i,12));
    const s=schedule(day);
    if(s.closed)continue;
    if(i===0&&p.minutes>=540)continue;
    const weekday=day.toLocaleDateString('sv-SE',{weekday:'long',timeZone:'Europe/Stockholm'});
    if(i===0)return 'Öppnar idag 09:00';
    return 'Öppnar '+weekday+' 09:00';
  }
  return 'Nästa öppningstid ej fastställd';
}
function updateStatus(now=new Date()){
  const state=schedule(now);
  const statusText=state.open?'Öppen':'Stängd';
  const detail=state.open?(state.halfDay?'Stänger idag 13:00':'Stänger idag 17:30'):nextOpen(now);
  for(const cfg of [
    ['omxMarketStatus','omxMarketStatusText','omxMarketDetail'],
    ['marketOmxStatus','marketOmxStatusText','marketOmxDetail']
  ]){
    const badge=$(cfg[0]);if(!badge)continue;
    badge.dataset.state=state.open?'open':'closed';
    const text=$(cfg[1]),sub=$(cfg[2]);
    if(text)text.textContent=statusText;
    if(sub)sub.textContent=detail;
    badge.title='Schemalagd handelsstatus enligt Nasdaq Stockholm. Handelsstopp kan förekomma.';
  }
  const label=$('omxQuoteLabel');
  if(label){
    // Eftersom noteringar kan ha fördröjning lovar vi inte ett fastställt stängningsvärde direkt kl. 17.30.
    label.textContent=state.open?'Senaste notering · dagens utveckling':
      'Senaste stängningsnotering · dagens förändring';
  }
  return {state,detail};
}
function widget(hostId,url,config){
  const host=$(hostId);if(!host)return;
  const wrap=document.createElement('div');wrap.className='tradingview-widget-container';
  const body=document.createElement('div');body.className='tradingview-widget-container__widget';
  const script=document.createElement('script');script.type='text/javascript';script.async=true;script.src=url;
  script.textContent=JSON.stringify(config);
  script.addEventListener('error',()=>{
    host.innerHTML='<span class="widget-placeholder">Kursdata kunde inte hämtas. Försök igen senare.</span>';
  });
  wrap.append(body,script);host.replaceChildren(wrap);
}
function quote(){
  widget('homeOmxQuote','https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js',{
    symbol:'OMXSTO:OMXS30',width:'100%',locale:'sv',colorTheme:'light',isTransparent:true
  });
}
function chart(period){
  if(!PERIODS.has(period))return;
  selected=period;
  document.querySelectorAll('[data-omx-market-period]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.omxMarketPeriod===period));
  });
  // TradingViews symbol-overview accepterar period|upplösning i symbolsträngen.
  widget('marketOmxChart','https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js',{
    symbols:[['OMXS30','OMXSTO:OMXS30|'+(period==='ALL'?'all':period)]],
    chartOnly:false,width:'100%',height:'100%',autosize:true,locale:'sv',
    colorTheme:'light',isTransparent:false,backgroundColor:'#fffdf9',
    widgetFontColor:'#123F36',fontColor:'#6d756f',
    gridLineColor:'rgba(18,63,54,0.065)',
    chartType:'area',lineType:0,lineWidth:2,lineColor:'#2A6B5C',
    topColor:'rgba(42,107,92,0.17)',bottomColor:'rgba(42,107,92,0.012)',
    upColor:'#238553',downColor:'#c2424c',borderUpColor:'#238553',borderDownColor:'#c2424c',
    hideDateRanges:true,hideMarketStatus:true,hideSymbolLogo:true,
    noTimeScale:false,showVolume:false,showMA:false,valuesTracking:'1',
    changeMode:'price-and-percent',scalePosition:'right',fontSize:'11',headerFontSize:'medium',
    // Finns som dokumenterad dateRanges-funktion, hjälper widgeten med upplösning.
    dateRanges:['1d|1','1w|60','1m|30','3m|60','6m|1D','12m|1D','36m|1W','60m|1W','all|1M']
  });
}
function init(){
  const hasHome=Boolean($('homeOmxQuote')),hasMarket=Boolean($('marketOmxChart'));
  if(!hasHome&&!hasMarket)return;
  updateStatus();setInterval(updateStatus,30000);
  if(hasHome)quote();
  if(hasMarket){
    document.querySelectorAll('[data-omx-market-period]').forEach(button=>{
      button.addEventListener('click',()=>chart(button.dataset.omxMarketPeriod));
    });
    chart(selected);
  }
}
// Exponerat endast för tester; inget anrop från annan kod krävs.
window.IndexdataOmx={schedule,nextOpen,updateStatus,chart};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();
