(()=>{
const definitions = [
 {id:'SEGVB2YC',name:'Sverige 2 år',category:'räntor',unit:'%',source:'Riksbanken',descr:'Statsobligation, 2 år',digits:2},
 {id:'SEGVB5YC',name:'Sverige 5 år',category:'räntor',unit:'%',source:'Riksbanken',descr:'Statsobligation, 5 år',digits:2},
 {id:'SEGVB10YC',name:'Sverige 10 år',category:'räntor',unit:'%',source:'Riksbanken',descr:'Statsobligation, 10 år',digits:2},
 {id:'SECBREPOEFF',name:'Styrräntan',category:'räntor',unit:'%',source:'Riksbanken',descr:'Riksbankens policy rate',digits:2},
 {id:'DEGVB10Y',name:'Tyskland 10 år',category:'räntor',unit:'%',source:'Riksbanken',descr:'Statsobligation, 10 år',digits:2},
 {id:'USGVB10Y',name:'USA 10 år',category:'räntor',unit:'%',source:'Riksbanken',descr:'Statsobligation, 10 år',digits:2},
 {id:'SEMB5YCACOMB',name:'Bostadsobligation 5 år',category:'räntor',unit:'%',source:'Riksbanken',descr:'Säkerställd bostadsobligation',digits:2},
 {id:'SEKUSDPMI',name:'USD / SEK',category:'valutor',unit:'SEK',source:'Riksbanken',descr:'Amerikansk dollar i SEK',digits:4},
 {id:'SEKEURPMI',name:'EUR / SEK',category:'valutor',unit:'SEK',source:'Riksbanken',descr:'Euro i SEK',digits:4},
 {id:'SEKNOKPMI',name:'NOK / SEK',category:'valutor',unit:'SEK',source:'Riksbanken',descr:'Norsk krona i SEK',digits:4},
 {id:'SEKDKKPMI',name:'DKK / SEK',category:'valutor',unit:'SEK',source:'Riksbanken',descr:'Dansk krona i SEK',digits:4},
 {id:'SEKGBPPMI',name:'GBP / SEK',category:'valutor',unit:'SEK',source:'Riksbanken',descr:'Brittiskt pund i SEK',digits:4},
 {id:'SEKCHFPMI',name:'CHF / SEK',category:'valutor',unit:'SEK',source:'Riksbanken',descr:'Schweizisk franc i SEK',digits:4},
 {id:'SEKKIX92',name:'KIX-index',category:'valutor',unit:'index',source:'Riksbanken',descr:'Kronans konkurrensvägda index',digits:2},
 {id:'KPIF_YOY',name:'KPIF-inflation',category:'inflation',unit:'%',source:'SCB',descr:'12-månadersförändring',digits:1},
 {id:'KPI_YOY',name:'KPI-inflation',category:'inflation',unit:'%',source:'SCB',descr:'12-månadersförändring',digits:1}
];
const byId = Object.fromEntries(definitions.map(d=>[d.id,d]));
let dataset = { indicators:{}, history:{}, sources:{} };
let range = '3m';
const $ = id => document.getElementById(id);
const fmtDate = iso => { if(!iso) return '–'; try { return new Date(iso.slice(0,10)+'T12:00:00').toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric'}); } catch { return iso; } };
const fmtMonth = iso => { if(!iso) return '–'; const d = new Date(iso.slice(0,10)+'T12:00:00'); return d.toLocaleDateString('sv-SE',{month:'short',year:'numeric'}); };
const formatNum = (v,digits=2) => (v===null || v===undefined || !Number.isFinite(Number(v))) ? '—' : new Intl.NumberFormat('sv-SE',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(v));
const quote = id => dataset.indicators?.[id] || null;
const hasValue = q => !!q && typeof q.value === 'number' && Number.isFinite(q.value);
const dataStr = id => { const q = quote(id), d = byId[id]; return hasValue(q) ? formatNum(q.value, d?.digits ?? 2) : '—'; };
const statusText = id => { const q = quote(id); return q?.date ? fmtDate(q.date) : 'Ej tillgänglig'; };
const setText = (id, value) => { const el = $(id); if(el) el.textContent = value; };
const setHTML = (id, value) => { const el = $(id); if(el) el.innerHTML = value; };

function cardHtml(id,title,symbol,caption){
  const q = quote(id), d = byId[id], empty = !hasValue(q);
  return `<div class="kpi-card ${empty?'empty':''}"><div class="kpi-top"><span class="kpi-name">${title}</span><span class="kpi-icon">${symbol}</span></div><div class="kpi-value">${dataStr(id)}${empty?'':` <span style="font-size:16px;font-weight:700;color:#81786f">${d.unit}</span>`}</div><div class="kpi-bottom"><span class="kpi-change">${caption}</span><span>${statusText(id)}</span></div></div>`;
}

function paintCards(){
  setHTML('kpiGrid',
    cardHtml('SECBREPOEFF','Styrräntan','◎','Riksbanken') +
    cardHtml('SEGVB10YC','Sverige 10 år','↗','Statsobligation') +
    cardHtml('KPIF_YOY','KPIF-inflation','◌','12 månader') +
    cardHtml('SEKUSDPMI','USD / SEK','⇄','1 USD i kronor')
  );
}

function paintRateList(){
  const ids = ['SEGVB2YC','SEGVB5YC','SEGVB10YC','DEGVB10Y','USGVB10Y','SEMB5YCACOMB'];
  setHTML('ratesList', ids.map(id=>{
    const d = byId[id];
    return `<div class="rate-item"><div><div class="rate-name">${d.name}</div><div class="rate-sub">${d.descr}</div></div><div class="rate-right"><div class="rate-value">${dataStr(id)}${hasValue(quote(id))?' %':''}</div><div class="rate-date">${statusText(id)}</div></div></div>`;
  }).join(''));
}

function paintFx(){
  const ids = ['SEKUSDPMI','SEKEURPMI','SEKNOKPMI','SEKDKKPMI','SEKGBPPMI','SEKCHFPMI'];
  const names = {
    'SEKUSDPMI':['US','Amerikansk dollar'],
    'SEKEURPMI':['EU','Euro'],
    'SEKNOKPMI':['NO','Norsk krona'],
    'SEKDKKPMI':['DK','Dansk krona'],
    'SEKGBPPMI':['UK','Brittiskt pund'],
    'SEKCHFPMI':['CH','Schweizisk franc']
  };
  setHTML('fxList', ids.map(id=>{
    const [flag,descr] = names[id], d = byId[id];
    return `<div class="fx-row"><div class="fx-pair"><span class="fx-icon">${flag}</span><div><div class="fx-label">${d.name}</div><div class="fx-desc">${descr}</div></div></div><div class="fx-price">${dataStr(id)}<small>${statusText(id)}</small></div></div>`;
  }).join(''));
}

function readHistory(id){
  const pts = dataset.history?.[id] || [];
  return pts.filter(p=>Number.isFinite(Number(p.value)) && p.date).map(p=>({date:p.date, value:Number(p.value)})).sort((a,b)=>a.date.localeCompare(b.date));
}

function recentSeries(arr, selectedRange){
  if(!arr.length) return [];
  const end = new Date(arr[arr.length-1].date+'T12:00:00Z');
  const days = selectedRange === '1m' ? 31 : selectedRange === '3m' ? 94 : 370;
  const from = new Date(end.getTime() - days*86400000).toISOString().slice(0,10);
  return arr.filter(p=>p.date >= from);
}

function makeSvg(points, options={}){
  const {height=240, width=630, color='#ef6c2a', filled=true, gradientId='lineGradient'} = options;
  const left=40, right=12, top=14, bottom=32, innerW=width-left-right, innerH=height-top-bottom;
  if(points.length < 2) return null;
  const vals = points.map(p=>p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const spread = Math.max(.05, hi-lo);
  lo -= spread*.18; hi += spread*.18;
  const X = i => left + (i/(points.length-1))*innerW;
  const Y = v => top + (hi-v)/(hi-lo)*innerH;
  const path = points.map((p,i)=>`${i?'L':'M'} ${X(i).toFixed(2)} ${Y(p.value).toFixed(2)}`).join(' ');
  const fillPath = `${path} L ${X(points.length-1).toFixed(2)} ${(top+innerH).toFixed(2)} L ${left} ${(top+innerH).toFixed(2)} Z`;
  const lines=[0,.25,.5,.75,1].map(f=>{
    const y = top + innerH*f;
    return `<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" stroke="#e6e0d8" stroke-width="1" stroke-dasharray="2 6"/><text x="${left-9}" y="${y+4}" text-anchor="end" font-size="10" fill="#8a8177">${formatNum(hi-f*(hi-lo),1)}</text>`;
  }).join('');
  const labels = [0,Math.floor((points.length-1)/2),points.length-1].map(i=>`<text x="${X(i)}" y="${height-10}" text-anchor="${i===0?'start':i===points.length-1?'end':'middle'}" fill="#8a8177" font-size="10">${fmtDate(points[i].date).replace(/ \d{4}$/,'')}</text>`).join('');
  return `<svg role="img" aria-label="Historiskt diagram, ${points.length} observationer" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><defs><linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.18"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${lines}${filled ? `<path d="${fillPath}" fill="url(#${gradientId})"/>` : ''}<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${X(points.length-1)}" cy="${Y(points[points.length-1].value)}" r="4" fill="${color}" stroke="#ffffff" stroke-width="3"/>${labels}</svg>`;
}

function paintChart(){
  const pts = recentSeries(readHistory('SEGVB10YC'), range);
  const svg = makeSvg(pts, {gradientId:'rateFill'});
  setHTML('rateChart', svg || '<div class="chart-empty">Historik hämtas automatiskt vid första datakörningen. Aktuella räntenivåer visas ovan även om diagrammet ännu saknar historik.</div>');
  setText('chartPeriod', pts.length ? `${fmtDate(pts[0].date)} – ${fmtDate(pts[pts.length-1].date)}` : 'Ingen historik ännu');
}

function paintInflation(){
  [['KPIF_YOY','kpif'],['KPI_YOY','kpi']].forEach(([id,prefix])=>{
    setText(prefix+'Value', hasValue(quote(id)) ? `${dataStr(id)} %` : '—');
    setText(prefix+'Date', quote(id)?.date ? `Referensmånad: ${fmtMonth(quote(id).date)}` : 'Inväntar SCB-data');
  });
  const pts = readHistory('KPIF_YOY').slice(-24);
  const svg = makeSvg(pts, {height:120, width:630, gradientId:'inflationFill'});
  setHTML('inflationChart', svg || '<div class="chart-empty">Inflationshistorik visas efter första uppdateringen.</div>');
}

function paintHealth(){
  const src = dataset.sources || {};
  const statuses = Object.values(src).map(v=>v.status);
  const ok = statuses.filter(x=>x==='ok').length;
  const errors = statuses.filter(x=>x==='error').length;
  const partial = statuses.filter(x=>x==='partial').length;
  const ts = dataset.generated_at;
  setText('lastUpdate', ts ? new Date(ts).toLocaleString('sv-SE',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Stockholm'}) : 'Startdata · 13 nov 2026');
  setText('healthStatus', !ts ? 'Första schemalagda körningen väntar' : errors ? `${ok} OK · ${errors} fel` : partial ? `${ok} OK · ${partial} delvis` : `${ok} datakällor uppdaterade`);
  const health = $('healthStatus');
  if(health) health.style.color = errors ? '#b24f1e' : '#3d342e';
}

function paintAll(){
  paintCards();
  paintRateList();
  paintFx();
  paintChart();
  paintInflation();
  paintHealth();
}

async function loadData(){
  try{
    const res = await fetch('./data/market.json?cache='+Date.now(), {cache:'no-store'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    dataset = await res.json();
    paintAll();
  }catch(err){
    console.error('Kan inte läsa datafil', err);
    setText('healthStatus', 'Datafilen kunde inte läsas');
    paintAll();
  }
}

function clockTick(){
  setText('clock', new Date().toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Stockholm'})+' CET/CEST');
}

function activateNav(target){
  document.querySelectorAll('[data-nav]').forEach(link=>{
    link.classList.toggle('active', link.dataset.nav === target);
  });
}

function events(){
  document.querySelectorAll('.seg').forEach(el=>el.addEventListener('click', ()=>{
    range = el.dataset.range;
    document.querySelectorAll('.seg').forEach(b=>b.classList.toggle('active', b === el));
    paintChart();
  }));
  const menu = $('menuToggle');
  if(menu){
    menu.addEventListener('click', ()=>{
      const open = $('sidebar')?.classList.toggle('open');
      menu.setAttribute('aria-expanded', String(!!open));
    });
  }
  document.querySelectorAll('[data-nav]').forEach(el=>el.addEventListener('click', ()=>{
    activateNav(el.dataset.nav);
    $('sidebar')?.classList.remove('open');
    menu?.setAttribute('aria-expanded','false');
  }));
}

clockTick();
setInterval(clockTick, 30000);
events();
paintAll();
loadData();
})();
