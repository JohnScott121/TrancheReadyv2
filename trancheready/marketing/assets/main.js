const APP_HOST = (window.APP_HOST_OVERRIDE || "https://app.trancheready.com");
const API_HOST = (window.APP_API_HOST_OVERRIDE || "https://app.trancheready.com");
document.querySelectorAll('[data-app-link]').forEach(a => { a.href = APP_HOST; });

const root = document.documentElement;
const metaTheme = document.getElementById('theme-color-meta');
const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
const savedTheme = localStorage.getItem('tr.theme');
const startDark = savedTheme ? savedTheme === 'dark' : prefersDark;
function applyTheme(isDark){
  root.classList.toggle('theme-dark', isDark);
  localStorage.setItem('tr.theme', isDark ? 'dark' : 'light');
  if(metaTheme) metaTheme.setAttribute('content', isDark ? '#0B1020' : '#FFFFFF');
}
applyTheme(startDark);

const toggle = document.getElementById('modeToggle'); if(toggle){ toggle.addEventListener('click', ()=> applyTheme(!root.classList.contains('theme-dark'))); }
const burger = document.getElementById('hamburger'); const menu = document.querySelector('[data-menu]');
if(burger && menu){ burger.addEventListener('click', ()=>{ const open = menu.getAttribute('data-open') === 'true'; menu.setAttribute('data-open', String(!open)); burger.setAttribute('aria-expanded', String(!open)); }); }

function smoothScrollTo(id){ const el = document.querySelector(id); if(!el) return; const pref = window.matchMedia('(prefers-reduced-motion: reduce)').matches; const top = el.getBoundingClientRect().top + window.scrollY - 64; window.scrollTo({ top, behavior: pref ? 'auto' : 'smooth' }); }
document.querySelectorAll('a[href^="#"]').forEach(a => { a.addEventListener('click', (e) => { const hash = a.getAttribute('href'); if(hash.length > 1){ e.preventDefault(); smoothScrollTo(hash); } }); });

const toTop = document.getElementById('toTop'); if(toTop){ window.addEventListener('scroll', ()=>{ toTop.classList.toggle('show', window.scrollY > 400); }); toTop.addEventListener('click', ()=> smoothScrollTo('#top')); }
const yearEl = document.getElementById('year'); if(yearEl){ yearEl.textContent = new Date().getFullYear(); }
