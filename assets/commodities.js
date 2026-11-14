(()=>{
'use strict';
// GitHub Actions ger stabila historiska data. Elområden kompletteras direkt
// från Spotwatts för dagens kvartpriser, utan API-nyckel.
const SERIES={
  brent:{name:'Brentolja',cat:'Energi',unit:'USD/fat',frequency:'Senaste dagliga spotpris',digits:2},
  wti:{name:'WTI-olja',cat:'Energi',unit:'USD/fat',frequency:'Senaste dagliga spotpris',digits:2},
  gas_us:{name:'Naturgas, Henry Hub',cat:'Energi',unit:'USD/MMBtu',frequency:'Senaste dagliga spotpris',digits:2},
  gold:{name:'Guld',cat:'Metaller',unit:'USD/troy oz',frequency:'Månadsreferens',digits:2},
  silver:{name:'Silver',cat:'Metaller',unit:'USD/troy oz',frequency:'Månadsreferens',digits:2},
  copper:{name:'Koppar',cat:'Metaller',unit:'USD/ton',frequency:'Månadsreferens',digits:2},
  aluminum:{name:'Aluminium',cat:'Metaller',unit:'USD/ton',frequency:'Månadsreferens',digits:2},
  wheat:{name:'Vete',cat:'Jordbruk',unit:'USD/ton',frequency:'Månadsreferens',digits:2},
  maize:{name:'Majs',cat:'Jordbruk',unit:'USD/ton',frequency:'Månadsreferens',digits:2},
  coffee:{name:'Kaffe, Arabica',cat:'Jordbruk',unit:'USD/kg',frequency:'Månadsreferens',digits:2},
  sugar:{name:'Socker',cat:'Jordbruk',unit:'USD/kg',frequency:'Månadsreferens',digits:2},
  power_se1:{name:'SE1',cat:'Svensk el',unit:'öre/kWh',frequency:'Pågående kvart',digits:2},
  power_se2:{name:'SE2',cat:'Svensk el',unit:'öre/kWh',frequency:'Pågående kvart',digits:2},
  power_se3:{name:'SE3',cat:'Svensk el',unit:'öre/kWh',frequency:'Pågående kvart',digits:2},
  power_se4:{name:'SE4',cat:'Svensk el',unit:'öre/kWh',frequency:'Pågående kvart',digits:2}
};
const ZONE_NAMES={power_se1:'Luleå',power_se2:'Sundsvall',power_se3:'Stockholm',power_se4:'Malmö'};
const TV_SYMBOLS={
  gold:'TVC:GOLD',silver:'TVC:SILVER',copper:'COMEX:HG1!',aluminum:'COMEX:ALI1!',
  wheat:'CBOT:ZW1!',maize:'CBOT:ZC1!',coffee:'ICEUS:KC1!',sugar:'ICEUS:SB1!'
};
const $=id=>document.getElementById(id);
const set=(id,value)=>{const el=$(id);if(el)el.textContent=value;};
const element=(tag,cls,content)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(content!==undefined)el.textContent=content;return el;};
const num=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)?
  new Intl.NumberFormat('sv-SE',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v):'—';
const fmtDate=(date,month=false)=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')?
  new Date(date+'T12:00:00Z').toLocaleDateString('sv-SE',month?
    {month:'long',year:'numeric',timeZone:'Europe/Stockholm'}:
    {day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Stockholm'}):'—';
const localDay=()=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
    year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Europe/Stockholm'
  }).formatToParts(new Date()).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const fmtClock=iso=>new Date(iso).toLocaleTimeString('sv-SE',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit'});
const quote=id=>data.quotes?.[id]||null;
const valid=id=>typeof quote(id)?.value==='number'&&Number.isFinite(quote(id).value);
const labelDate=id=>fmtDate(quote(id)?.date,quote(id)?.frequency==='month');
let data={quotes:{},history:{},sources:{},power_intervals:{}};
const lastWidgets={};
// Cached intervals are in öre/kWh excluding VAT; value_vat, when present,
// is the source's own price including VAT. Never apply VAT twice.
function priceInclVat(point){
  if(!point)return null;
  if(typeof point.value_vat==='number'&&Number.isFinite(point.value_vat))return point.value_vat;
  if(typeof point.value==='number'&&Number.isFinite(point.value))return Math.round(point.value*125)/100;
  return null;
}

function validPowerDay(day){
  return !!day&&day.date===localDay()&&Array.isArray(day.intervals)&&day.intervals.length>0;
}
function activePower(key,now=Date.now()){
  const day=data.power_intervals?.[key];
  if(!validPowerDay(day))return null;
  const cur=day.intervals.find(p=>Date.parse(p.start)<=now&&now<Date.parse(p.end)&&Number.isFinite(p.value));
  if(!cur)return null;
  return {date:day.date,start:cur.start,end:cur.end,value:priceInclVat(cur),unit:'öre/kWh',
    frequency:'quarter',source:'Spotwatts / ENTSO-E'};
}
function current(id){return id.startsWith('power_')?activePower(id):quote(id);}
function currentValid(id){return typeof current(id)?.value==='number'&&Number.isFinite(current(id).value);}
function observation(id){
  if(id.startsWith('power_')){
    const q=current(id);
    return q?`Idag ${fmtClock(q.start)}–${fmtClock(q.end)} · inkl. moms`:'Inget pris för pågående kvart';
  }
  return `${quote(id)?.frequency==='month'?'Månadsgenomsnitt':SERIES[id].frequency} · ${labelDate(id)}`;
}
function historyFor(key){
  const hist=data.history?.[key];
  return (Array.isArray(hist)?hist:[]).filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')&&Number.isFinite(p.value))
    .sort((a,b)=>a.date.localeCompare(b.date));
}
function lineChart(points,id,opts={}){
  if(points.length<2)return '';
  const width=660,height=224,left=54,right=18,top=12,bottom=32;
  const vals=points.map(p=>p.value),min=Math.min(...vals),max=Math.max(...vals);
  const pad=Math.max((max-min)*.18,.01),low=min-pad,high=max+pad;
  const x=i=>left+(width-left-right)*i/(points.length-1);
  const y=v=>top+(high-v)/(high-low)*(height-top-bottom);
  const path=points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area=`${path} L${x(points.length-1).toFixed(1)},${height-bottom} L${left},${height-bottom} Z`;
  const grid=[0,.25,.5,.75,1].map(t=>{
    const yy=top+(height-top-bottom)*t;
    return `<line x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}" stroke="#ebebe7" stroke-dasharray="3 5"/><text x="${left-9}" y="${yy+4}" text-anchor="end" fill="#999" font-size="10">${num(high-(high-low)*t,1)}</text>`;
  }).join('');
  const tickIndices=[0,Math.floor((points.length-1)/2),points.length-1];
  const labels=tickIndices.map(i=>
    `<text x="${x(i)}" y="${height-9}" fill="#8f8f8f" font-size="10" text-anchor="${i===0?'start':i===points.length-1?'end':'middle'}">${opts.intraday?fmtClock(points[i].start):fmtDate(points[i].date).replace(/ \d{4}$/,'')}</text>`
  ).join('');
  let marker='';
  if(opts.intraday){
    const now=Date.now();
    const at=points.findIndex(p=>Date.parse(p.start)<=now&&now<Date.parse(p.end));
    if(at>=0)marker=`<line x1="${x(at)}" x2="${x(at)}" y1="${top}" y2="${height-bottom}" stroke="#f46b31" stroke-width="1" stroke-dasharray="3 4"/><circle cx="${x(at)}" cy="${y(points[at].value)}" r="6" fill="#fc591f" stroke="#fff" stroke-width="3"/><text x="${Math.max(left+30,Math.min(width-right-45,x(at)))}" y="${top+4}" text-anchor="middle" fill="#ea5c20" font-size="10" font-weight="700">NU</text>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${opts.intraday?'Kvartspriser för dagens elhandel':'Prisutveckling'}, ${points.length} observationer"><defs><linearGradient id="commodity-gradient-${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fc591f" stop-opacity=".14"/><stop offset="1" stop-color="#fc591f" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#commodity-gradient-${id})"/><path d="${path}" fill="none" stroke="#fc591f" stroke-width="2.7" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>${marker}${labels}</svg>`;
}
function renderTradingChart(group,id){
  const host=$(group+'Chart'),symbol=TV_SYMBOLS[id];if(!host||!symbol)return;
  set(group+'Title',SERIES[id].name);
  set(group+'Value','');
  set(group+'Meta','Indikativ marknadskurs · kan vara fördröjd');
  set(group+'Period','Grafen visar börshandlade instrument, inte Världsbankens månadssnitt');
  if(lastWidgets[group]===symbol)return;
  lastWidgets[group]=symbol;
  const frame=element('div','tradingview-widget-container commodity-trading-frame');
  const content=element('div','tradingview-widget-container__widget');
  content.style.height='100%';content.style.width='100%';frame.append(content);
  const script=document.createElement('script');
  script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
  script.type='text/javascript';script.async=true;
  script.textContent=JSON.stringify({
    autosize:true,symbol,interval:'15',timezone:'Europe/Stockholm',theme:'light',style:'2',
    locale:'sv',allow_symbol_change:false,hide_side_toolbar:true,withdateranges:true,
    hide_volume:true,save_image:false,backgroundColor:'#ffffff',
    gridColor:'rgba(0,0,0,0.06)',support_host:'https://www.tradingview.com'
  });
  frame.append(script);host.replaceChildren(frame);
}
function renderPowerChart(id){
  const q=current(id),day=data.power_intervals?.[id],host=$('electricityChart');
  set('electricityTitle',`Elområde ${SERIES[id].name}`);
  set('electricityValue',q?`${num(q.value,2)} öre/kWh`:'—');
  set('electricityMeta',q?`Aktuellt kvart ${fmtClock(q.start)}–${fmtClock(q.end)} · inkl. moms`:'Inväntar aktuellt kvartpris');
  if(!host)return;
  if(!validPowerDay(day)){
    host.innerHTML='<div class="chart-empty">Inga kvartpriser för idag. Aktuell data hämtas automatiskt.</div>';
    set('electricityPeriod','Ingen aktuell dagskurva');return;
  }
  const pts=day.intervals.filter(p=>Number.isFinite(priceInclVat(p))&&Number.isFinite(Date.parse(p.start))&&Number.isFinite(Date.parse(p.end))).map(p=>({...p,value:priceInclVat(p)}));
  host.innerHTML=lineChart(pts,'electricity',{intraday:true})||'<div class="chart-empty">Dagens kvartpriser saknas.</div>';
  set('electricityPeriod',`${fmtDate(day.date)} · ${pts.length} prisintervall · öre/kWh inkl. moms`);
}
function renderChart(group){
  const choice=$(group+'Select');if(!choice)return;
  const id=choice.value,meta=SERIES[id];if(!meta)return;
  if(group==='electricity'){renderPowerChart(id);return;}
  if(group==='metals'||group==='agriculture'){renderTradingChart(group,id);return;}
  set(group+'Title',meta.name);
  const daily=quote(id)?.frequency==='day';
  set(group+'Value',daily&&valid(id)?`${num(quote(id).value,meta.digits)} ${meta.unit}`:'—');
  set(group+'Meta',daily?`Dagligt spotpris · ${meta.unit} · ${labelDate(id)}`:'Inväntar dagliga spotpriser');
  const points=daily?historyFor(id).slice(-180):[],host=$(group+'Chart');
  if(host)host.innerHTML=lineChart(points,group)||'<div class="chart-empty">Dagsnoteringar saknas just nu.</div>';
  set(group+'Period',points.length?`${fmtDate(points[0].date)} – ${fmtDate(points[points.length-1].date)}`:'Ingen historik');
}
function makeCard(key){
  const meta=SERIES[key],q=current(key),card=element('article','commodity-price-card');
  const isDaily=key.startsWith('power_')||q?.frequency==='day';
  card.append(element('div','commodity-price-name',meta.name),
    element('strong','',isDaily&&currentValid(key)?num(q.value,meta.digits):'—'),
    element('div','commodity-price-unit',meta.unit),
    element('span','commodity-price-date',isDaily?observation(key):'Dagsnotering saknas'),
    element('span','commodity-price-source',isDaily?(q?.source||'Ingen aktuell notering'):'Historiska referenser finns i tabellen'));
  return card;
}
function renderHighlights(){
  const host=$('commodityHighlights');if(host)host.replaceChildren(...['brent','wti','power_se3','power_se4'].map(makeCard));
}
function renderPower(){
  const host=$('powerAreaCards');if(!host)return;
  host.replaceChildren(...['power_se1','power_se2','power_se3','power_se4'].map(key=>{
    const q=current(key),card=element('article','power-area-card');
    card.append(element('h3','',SERIES[key].name),element('span','place',ZONE_NAMES[key]),
      element('strong','',q?num(q.value,2):'—'),
      element('div','unit','öre/kWh · inkl. moms'),
      element('time','date',observation(key)));
    return card;
  }));
}
function renderTable(){
  const target=$('commodityTable');if(!target)return;
  target.replaceChildren();
  for(const [category,ids] of [
    ['Energi (se period och källa)',['brent','wti','gas_us']],
    ['Metaller (månadsreferenser)',['gold','silver','copper','aluminum']],
    ['Jordbruk (månadsreferenser)',['wheat','maize','coffee','sugar']],
    ['Svensk el (pågående kvart)',['power_se1','power_se2','power_se3','power_se4']]
  ]){
    const section=element('tr','table-group'),head=element('td','',category);head.colSpan=4;
    section.append(head);target.append(section);
    for(const id of ids){
      const row=element('tr'),q=current(id),unit=element('span','price-unit-inline',SERIES[id].unit),price=element('td');
      price.append(document.createTextNode(currentValid(id)?num(q.value,SERIES[id].digits):'—'),unit);
      row.append(element('td','',SERIES[id].name),price,element('td','',id.startsWith('power_')?observation(id):labelDate(id)),element('td','',q?.source||'—'));
      target.append(row);
    }
  }
}
function renderStatus(){
  const ts=data.generated_at;
  set('commodityLastUpdate',ts&&!Number.isNaN(Date.parse(ts))?
    new Date(ts).toLocaleString('sv-SE',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Stockholm'}):'Ingen körning ännu');
  const names={eia:'EIA/FRED',worldbank:'Världsbanken',power:'SE1–SE4'};
  const status={ok:'uppdaterad',partial:'delvis uppdaterad',error:'kunde inte uppdateras'};
  set('commoditySourceHealth',Object.entries(data.sources||{}).map(([id,v])=>`${names[id]||id}: ${status[v.status]||'väntar'}`).join(' · ')||'Inväntar första hämtningen');
}
function renderPowerUI(){renderHighlights();renderPower();renderTable();renderChart('electricity');}
function renderAll(){renderPowerUI();renderStatus();renderChart('energy');renderChart('metals');renderChart('agriculture');}

// En livehämtning vid sidladdning och därefter var 30:e minut. Mellan
// hämtningarna räknas pågående 15-minutersintervall ut lokalt varje minut.
async function loadPowerLive(){
  let updated=0;
  await Promise.all(['se1','se2','se3','se4'].map(async zone=>{
    try{
      const response=await fetch(`https://spotwatts.com/api/v1/${zone}/today.json`,{cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const body=await response.json();
      if(body?.date!==localDay()||body.zone?.toLowerCase()!==zone||body.unit!=='SEK/kWh'||!Array.isArray(body.intervals))return;
      const intervals=body.intervals.map(p=>({
        start:p.start,end:p.end,value:typeof p.price==='number'?Math.round(p.price*100000)/1000:NaN,
        value_vat:typeof p.price_vat==='number'?Math.round(p.price_vat*100000)/1000:(typeof p.price==='number'?Math.round(p.price*125000)/1000:NaN)
      })).filter(p=>Number.isFinite(p.value)&&Number.isFinite(Date.parse(p.start))&&Number.isFinite(Date.parse(p.end))&&Date.parse(p.start)<Date.parse(p.end));
      if(!intervals.length)return;
      data.power_intervals[`power_${zone}`]={date:body.date,unit:'öre/kWh',intervals};
      updated++;
    }catch(err){console.warn(`Elpriser ${zone} kunde inte hämtas direkt`,err);}
  }));
  if(updated)renderPowerUI();
}
async function load(){
  try{
    const response=await fetch('./data/commodities.json?ts='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const parsed=await response.json();
    if(!parsed||typeof parsed!=='object')throw Error('Invalid commodity file');
    data={quotes:parsed.quotes||{},history:parsed.history||{},sources:parsed.sources||{},
      power_intervals:parsed.power_intervals||{},generated_at:parsed.generated_at};
  }catch(err){
    console.warn('Råvarudata kunde inte läsas',err);
    set('commoditySourceHealth','Kunde inte läsa datafilen – kontrollera GitHub Actions');
  }
  renderAll();
  await loadPowerLive();
}
['energy','metals','agriculture','electricity'].forEach(id=>$(id+'Select')?.addEventListener('change',()=>renderChart(id)));
renderAll();load();
setInterval(renderPowerUI,60000);
setInterval(loadPowerLive,30*60000);
})();
