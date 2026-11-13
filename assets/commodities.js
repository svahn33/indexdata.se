(()=>{
'use strict';
// Råvaror hämtas av GitHub Actions; webbläsaren läser endast den publika JSON-filen.
const SERIES = {
  brent:{name:'Brentolja',cat:'Energi',unit:'USD/fat',frequency:'Dagligt spotpris',digits:2},
  wti:{name:'WTI-olja',cat:'Energi',unit:'USD/fat',frequency:'Dagligt spotpris',digits:2},
  gas_us:{name:'Naturgas, Henry Hub',cat:'Energi',unit:'USD/MMBtu',frequency:'Dagligt spotpris',digits:2},
  gold:{name:'Guld',cat:'Metaller',unit:'USD/troy oz',frequency:'Månadsgenomsnitt',digits:2},
  silver:{name:'Silver',cat:'Metaller',unit:'USD/troy oz',frequency:'Månadsgenomsnitt',digits:2},
  copper:{name:'Koppar',cat:'Metaller',unit:'USD/ton',frequency:'Månadsgenomsnitt',digits:2},
  aluminum:{name:'Aluminium',cat:'Metaller',unit:'USD/ton',frequency:'Månadsgenomsnitt',digits:2},
  wheat:{name:'Vete',cat:'Jordbruk',unit:'USD/ton',frequency:'Månadsgenomsnitt',digits:2},
  maize:{name:'Majs',cat:'Jordbruk',unit:'USD/ton',frequency:'Månadsgenomsnitt',digits:2},
  coffee:{name:'Kaffe, Arabica',cat:'Jordbruk',unit:'USD/kg',frequency:'Månadsgenomsnitt',digits:2},
  sugar:{name:'Socker',cat:'Jordbruk',unit:'USD/kg',frequency:'Månadsgenomsnitt',digits:2},
  power_se1:{name:'SE1',cat:'Svensk el',unit:'SEK/kWh',frequency:'Dygnsmedel',digits:3},
  power_se2:{name:'SE2',cat:'Svensk el',unit:'SEK/kWh',frequency:'Dygnsmedel',digits:3},
  power_se3:{name:'SE3',cat:'Svensk el',unit:'SEK/kWh',frequency:'Dygnsmedel',digits:3},
  power_se4:{name:'SE4',cat:'Svensk el',unit:'SEK/kWh',frequency:'Dygnsmedel',digits:3}
};
const ZONE_NAMES={power_se1:'Luleå',power_se2:'Sundsvall',power_se3:'Stockholm',power_se4:'Malmö'};
const $=id=>document.getElementById(id);
const num=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)
  ?new Intl.NumberFormat('sv-SE',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v):'—';
const fmtDate=(date,month=false)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return '—';
  return new Date(date+'T12:00:00Z').toLocaleDateString('sv-SE',month?
    {month:'long',year:'numeric',timeZone:'Europe/Stockholm'}:
    {day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Stockholm'});
};
const set=(id,text)=>{const el=$(id);if(el)el.textContent=text;};
const quote=id=>data.quotes?.[id]||null;
const valid=id=>typeof quote(id)?.value==='number'&&Number.isFinite(quote(id).value);
const labelDate=id=>fmtDate(quote(id)?.date,quote(id)?.frequency==='month');
const freqText=id=>quote(id)?.frequency==='month'?'Månadsgenomsnitt':SERIES[id].frequency;
let data={quotes:{},history:{},sources:{}};

function element(tag, cls, content){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(content!==undefined)el.textContent=content;
  return el;
}
function lineChart(points,id){
  if(points.length<2)return '';
  const width=660,height=224,left=52,right=18,top=12,bottom=32;
  const vals=points.map(p=>p.value),min=Math.min(...vals),max=Math.max(...vals);
  const pad=Math.max((max-min)*.18,.01);
  const low=min-pad,high=max+pad;
  const x=i=>left+(width-left-right)*i/(points.length-1);
  const y=v=>top+(high-v)/(high-low)*(height-top-bottom);
  const path=points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area=`${path} L${x(points.length-1).toFixed(1)},${height-bottom} L${left},${height-bottom} Z`;
  const grid=[0,.25,.5,.75,1].map(t=>{
    const yy=top+(height-top-bottom)*t;
    return `<line x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}" stroke="#ebebe7" stroke-dasharray="3 5"/><text x="${left-9}" y="${yy+4}" text-anchor="end" fill="#999" font-size="10">${num(high-(high-low)*t,1)}</text>`;
  }).join('');
  const labels=[0,Math.floor((points.length-1)/2),points.length-1].map(i=>
    `<text x="${x(i)}" y="${height-9}" fill="#8f8f8f" font-size="10" text-anchor="${i===0?'start':i===points.length-1?'end':'middle'}">${fmtDate(points[i].date).replace(/ \d{4}$/, '')}</text>`
  ).join('');
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Prisutveckling, ${points.length} observationer"><defs><linearGradient id="commodity-gradient-${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fc591f" stop-opacity=".14"/><stop offset="1" stop-color="#fc591f" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#commodity-gradient-${id})"/><path d="${path}" fill="none" stroke="#fc591f" stroke-width="2.7" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle cx="${x(points.length-1)}" cy="${y(points[points.length-1].value)}" r="4.3" fill="#fc591f" stroke="#fff" stroke-width="2.5"/>${labels}</svg>`;
}
function historyFor(key){
  const hist=data.history?.[key];
  return (Array.isArray(hist)?hist:[]).filter(p=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(p.date||'')&&Number.isFinite(p.value))
    .sort((a,b)=>a.date.localeCompare(b.date));
}
function renderChart(group){
  const selection=$(group+'Select'); if(!selection)return;
  const id=selection.value,meta=SERIES[id];if(!meta)return;
  set(group+'Title', id.startsWith('power_')?`Elområde ${meta.name}`:meta.name);
  set(group+'Value',valid(id)?`${num(quote(id).value,meta.digits)} ${meta.unit}`:'—');
  set(group+'Meta',`${freqText(id)} · ${meta.unit} · ${labelDate(id)}`);
  const history=historyFor(id);
  const max=id.startsWith('power_')?90:quote(id)?.frequency==='month'?48:180;
  const subset=history.slice(-max);
  const html=lineChart(subset,group);
  const host=$(group+'Chart');
  if(host)host.innerHTML=html||`<div class="chart-empty">${id.startsWith('power_')?'Elprishistorik byggs upp dag för dag.':'Historiska data saknas just nu.'}</div>`;
  set(group+'Period',subset.length?`${fmtDate(subset[0].date)} – ${fmtDate(subset[subset.length-1].date)}`:'Ingen historik');
}
function makeCard(key){
  const item=SERIES[key],q=quote(key),card=element('article','commodity-price-card');
  card.append(element('div','commodity-price-name',item.name),
    element('strong','',valid(key)?num(q.value,item.digits):'—'),
    element('div','commodity-price-unit',item.unit),
    element('span','commodity-price-date',`${freqText(key)} · ${labelDate(key)}`),
    element('span','commodity-price-source',q?.source||'Data saknas'));
  return card;
}
function renderHighlights(){
  const host=$('commodityHighlights'); if(!host)return;
  host.replaceChildren(...['brent','wti','gold','copper'].map(makeCard));
}
function renderPower(){
  const host=$('powerAreaCards');if(!host)return;
  host.replaceChildren(...['power_se1','power_se2','power_se3','power_se4'].map(key=>{
    const card=element('article','power-area-card');
    card.append(element('h3','',SERIES[key].name),element('span','place',ZONE_NAMES[key]),
      element('strong','',valid(key)?num(quote(key).value,3):'—'),
      element('div','unit','SEK/kWh, exkl. moms'),
      element('time','date',labelDate(key)));
    return card;
  }));
}
function renderTable(){
  const target=$('commodityTable');if(!target)return;
  target.replaceChildren();
  for(const [category,ids] of [
    ['Energi',['brent','wti','gas_us']],
    ['Metaller',['gold','silver','copper','aluminum']],
    ['Jordbruk',['wheat','maize','coffee','sugar']],
    ['Svensk el',['power_se1','power_se2','power_se3','power_se4']]
  ]){
    const section=element('tr','table-group'); const head=element('td','',category);head.colSpan=4;
    section.append(head);target.append(section);
    for(const id of ids){
      const row=element('tr');
      const unit=element('span','price-unit-inline',SERIES[id].unit);
      const price=element('td');price.append(document.createTextNode(valid(id)?num(quote(id).value,SERIES[id].digits):'—'),unit);
      row.append(element('td','',SERIES[id].name),price,element('td','',labelDate(id)),element('td','',quote(id)?.source||'—'));
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
function render(){
  renderHighlights();renderPower();renderTable();renderStatus();
  ['energy','metals','agriculture','electricity'].forEach(renderChart);
}
async function load(){
  try{
    const response=await fetch('./data/commodities.json?ts='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const parsed=await response.json();
    if(!parsed || typeof parsed!=='object')throw Error('Invalid commodity file');
    data={quotes:parsed.quotes||{},history:parsed.history||{},sources:parsed.sources||{},generated_at:parsed.generated_at};
  }catch(e){
    console.warn('Råvarudata kunde inte läsas',e);
    set('commoditySourceHealth','Kunde inte läsa datafilen – kontrollera GitHub Actions');
  }
  render();
}
['energy','metals','agriculture','electricity'].forEach(id=>$(id+'Select')?.addEventListener('change',()=>renderChart(id)));
render();load();
})();
