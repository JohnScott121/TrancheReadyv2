// ===== Theme toggle =====
const root = document.documentElement;
const metaTheme = document.getElementById('theme-color');
const savedTheme = localStorage.getItem('tr.theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
applyTheme(savedTheme ? savedTheme === 'dark' : prefersDark);
document.getElementById('modeToggle')?.addEventListener('click', () => applyTheme(!root.classList.contains('theme-dark')));
function applyTheme(isDark){
  root.classList.toggle('theme-dark', isDark);
  localStorage.setItem('tr.theme', isDark ? 'dark' : 'light');
  if (metaTheme) metaTheme.setAttribute('content', isDark ? '#0B1020' : '#FFFFFF');
}

// ===== Elements =====
const form = document.getElementById('uform');
const clientsInput = document.getElementById('clientsInput');
const txInput = document.getElementById('txInput');
const drop = document.getElementById('drop');
const progress = document.getElementById('progress'); const bar = progress?.querySelector('.bar');
const skeleton = document.getElementById('skeleton');
const riskWrap = document.getElementById('riskWrap'); const riskBody = document.getElementById('riskBody');
const summary = document.getElementById('summary'); const verifyUrlEl = document.getElementById('verifyUrl');
const copyVerify = document.getElementById('copyVerify'); const openVerify = document.getElementById('openVerify'); const downloadZip = document.getElementById('downloadZip');
const toastEl = document.getElementById('toast');
const submitBtn = document.getElementById('submitBtn');

// ===== Toast =====
function toast(msg, ms=2200){
  toastEl.textContent = msg; toastEl.hidden = false;
  requestAnimationFrame(()=> toastEl.classList.add('show'));
  setTimeout(()=> { toastEl.classList.remove('show'); setTimeout(()=>toastEl.hidden=true, 180); }, ms);
}

// ===== Drag & drop (assigns to existing inputs) =====
if (drop){
  const setHover = (v)=> drop.setAttribute('data-hover', v?'true':'false');
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); setHover(true); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); if(ev==='drop'){ handleDrop(e); } setHover(false); }));
  drop.addEventListener('click', ()=> clientsInput?.click());
  drop.addEventListener('keydown', (e)=>{ if(e.key===' '||e.key==='Enter'){ e.preventDefault(); clientsInput?.click(); } });

  function handleDrop(e){
    const files = [...(e.dataTransfer?.files || [])];
    const clients = findCsv(files, /clients?/i);
    const txs = findCsv(files, /transactions?|transfers?/i);
    if (clients) setFile(clientsInput, clients);
    if (txs) setFile(txInput, txs);
    if (!clients || !txs) toast('Need both Clients.csv and Transactions.csv');
  }
  function findCsv(files, re){ return files.find(f => /\.csv$/i.test(f.name) && re.test(f.name)); }
  function setFile(input, file){ const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; }
}

// ===== Submit handler =====
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!clientsInput.files[0] || !txInput.files[0]) { toast('Select both files'); return; }
  if (!/\.csv$/i.test(clientsInput.files[0].name) || !/\.csv$/i.test(txInput.files[0].name)) { toast('Files must be .csv'); return; }

  try{
    submitBtn.classList.add('loading');
    progress.hidden = false; setBar(8);
    skeleton.hidden = false; riskWrap.hidden = true; summary.hidden = true;

    const fd = new FormData();
    fd.append('clients', clientsInput.files[0]);
    fd.append('transactions', txInput.files[0]);

    setBar(30);
    const res = await fetch('/upload', { method:'POST', body: fd });
    setBar(65);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    verifyUrlEl.textContent = data.verify_url;
    openVerify.href = data.verify_url;
    downloadZip.href = data.download_url;
    summary.hidden = false;

    renderRisk(data.risk);
    skeleton.hidden = true; riskWrap.hidden = false;
    setBar(100); setTimeout(()=> progress.hidden = true, 600);
    toast('Evidence ready');

  }catch(err){
    skeleton.hidden = true; riskWrap.hidden = true; summary.hidden = true;
    setBar(0); progress.hidden = true;
    toast(err.message || 'Processing failed');
  }finally{
    submitBtn.classList.remove('loading');
  }
});

copyVerify?.addEventListener('click', async ()=>{
  try { await navigator.clipboard.writeText(verifyUrlEl.textContent); toast('Verify link copied'); }
  catch { toast('Copy failed'); }
});

function setBar(p){ if(bar) bar.style.width = `${Math.max(0, Math.min(100, p))}%`; }

function renderRisk(items){
  riskBody.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const tr = document.createElement('tr');

    // client
    const tdC = document.createElement('td'); tdC.innerHTML = `<span class="mono">${esc(item.client_id||'—')}</span>`; tr.appendChild(tdC);

    // band
    const tdB = document.createElement('td');
    const band = (item.band||'').toLowerCase();
    tdB.innerHTML = `<span class="badge ${band==='high'?'high':band==='medium'?'med':'low'}">${esc(item.band)}</span>`;
    tr.appendChild(tdB);

    // score
    const tdS = document.createElement('td'); tdS.textContent = String(item.score ?? 0); tr.appendChild(tdS);

    // reasons
    const tdR = document.createElement('td');
    const reasons = (item.reasons||[]).filter(r=>r.type==='reason');
    if (reasons.length){
      const det = document.createElement('details'); const sum = document.createElement('summary'); sum.textContent = `${reasons.length} reason${reasons.length===1?'':'s'}`;
      const list = document.createElement('div'); list.className = 'reason-list';
      reasons.forEach(r => {
        const row = document.createElement('div'); row.className = 'reason';
        const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = r.family + (r.points?` +${r.points}`:'');
        const txt = document.createElement('span'); txt.textContent = r.text; row.append(tag, txt); list.appendChild(row);
      });
      det.append(sum, list); tdR.appendChild(det);
    } else { tdR.innerHTML = '<span class="muted">—</span>'; }
    tr.appendChild(tdR);

    frag.appendChild(tr);
  }
  riskBody.appendChild(frag);
}

function esc(s){ return (s??'').toString().replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
