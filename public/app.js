// Theme toggle
const root = document.documentElement;
const metaTheme = document.getElementById('theme-color');
const saved = localStorage.getItem('tr.theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
applyTheme((saved ? saved === 'dark' : prefersDark));
document.getElementById('modeToggle')?.addEventListener('click', () => {
  applyTheme(!root.classList.contains('theme-dark'));
});
function applyTheme(dark){
  root.classList.toggle('theme-dark', dark);
  localStorage.setItem('tr.theme', dark ? 'dark' : 'light');
  if (metaTheme) metaTheme.setAttribute('content', dark ? '#0B1020' : '#FFFFFF');
}

// Elements
const form = document.getElementById('uform');
const drop = document.getElementById('drop');
const progress = document.getElementById('progress');
const bar = progress?.querySelector('.bar');
const skeleton = document.getElementById('skeleton');
const riskWrap = document.getElementById('riskWrap');
const riskBody = document.getElementById('riskBody');
const summary = document.getElementById('summary');
const verifyUrlEl = document.getElementById('verifyUrl');
const copyVerify = document.getElementById('copyVerify');
const openVerify = document.getElementById('openVerify');
const downloadZip = document.getElementById('downloadZip');
const toastEl = document.getElementById('toast');

// Toast
function toast(msg, ms=2200){
  toastEl.textContent = msg;
  toastEl.hidden = false;
  requestAnimationFrame(()=> toastEl.classList.add('show'));
  setTimeout(()=> { toastEl.classList.remove('show'); setTimeout(()=>toastEl.hidden=true, 180); }, ms);
}

// Drag & drop
if (drop){
  const [cInput, tInput] = drop.querySelectorAll('input[type=file]');
  const setHover = (v)=> drop.setAttribute('data-hover', v?'true':'false');
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); setHover(true); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); if(ev==='drop'){ handleDrop(e); } setHover(false); }));
  drop.addEventListener('click', () => cInput?.click());
  drop.addEventListener('keydown', (e) => { if(e.key===' '||e.key==='Enter'){ e.preventDefault(); cInput?.click(); } });

  function handleDrop(e){
    const files = [...(e.dataTransfer?.files || [])];
    const clients = files.find(f => /clients.*\.csv$/i.test(f.name)) || files.find(f=>/client.*\.csv$/i.test(f.name));
    const txs = files.find(f => /transactions.*\.csv$/i.test(f.name)) || files.find(f=>/transact.*\.csv$/i.test(f.name));
    if (!clients || !txs){ toast('Please drop both Clients.csv and Transactions.csv'); return; }
    assignFile(cInput, clients); assignFile(tInput, txs);
  }
  function assignFile(input, file){
    const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
  }
}

// Submit
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = form.querySelector('button[type="submit"]');
  btn.classList.add('loading');

  // Build FormData from the two named inputs (not the drop overlay ones)
  const sel = form.querySelectorAll('.file-row input[type=file]');
  const clients = sel[0]?.files?.[0];
  const txs = sel[1]?.files?.[0];
  if (!clients || !txs) { toast('Select both files first'); btn.classList.remove('loading'); return; }

  // Basic validation
  if (!/\.csv$/i.test(clients.name) || !/\.csv$/i.test(txs.name)){
    toast('Files must be .csv'); btn.classList.remove('loading'); return;
  }

  try{
    // progress fake (fetch streaming progress is limited; give smooth UI)
    progress.hidden = false; setBar(10);
    skeleton.hidden = false; riskWrap.hidden = true; summary.hidden = true;

    const fd = new FormData();
    fd.append('clients', clients);
    fd.append('transactions', txs);

    setBar(35);
    const res = await fetch('/upload', { method:'POST', body: fd });
    setBar(65);
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Upload failed');

    // Show summary links
    verifyUrlEl.textContent = data.verify_url;
    openVer
