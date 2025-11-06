const form = document.getElementById('uform');
const msg = document.getElementById('umsg');
const pre = document.getElementById('result');
const links = document.getElementById('links');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = 'Uploading…';
  pre.textContent = '';
  links.innerHTML = '';
  const fd = new FormData(form);
  try{
    const res = await fetch('/upload', { method:'POST', body: fd });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Upload failed');
    pre.textContent = JSON.stringify(data.risk, null, 2);
    links.innerHTML = '<a class="btn" href="'+data.download_url+'">Download ZIP</a> <a class="btn" href="'+data.verify_url+'">Open verify link</a>';
    msg.textContent = 'Done.';
  }catch(err){
    msg.textContent = err.message;
  }
});
