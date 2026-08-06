/* Coach Steve Drill Finder */
const $ = (s) => document.querySelector(s);
let DRILLS = [];
const byId = {};

const FOCUS = ['Timing & Rhythm', 'Direction & Bat Path', 'Contact Quality', 'Separation & Power', 'Balance & Posture', 'Vision & Approach', 'Fielding & Throwing'];
const AGES = ['Beginner', 'Intermediate', 'Advanced', 'Pro Level'];
const HANDS = ['Any', 'Righty', 'Lefty', 'Switch'];
const CATS = ['Hitting', 'Bunting', 'Infield', 'Outfield', 'Pitching'];
let TYPES = [];
const DIFFS = ['Easy', 'Medium', 'Hard'];

const state = { q: '', focus: new Set(), ages: new Set(), hand: 'Any', cats: new Set(), types: new Set(), diffs: new Set() };

/* ---------- chip rendering ---------- */
function makeChips(el, values, set, counts, single) {
  el.innerHTML = '';
  values.forEach((v) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = counts && counts[v] != null ? `${v}<span class="n">${counts[v]}</span>` : v;
    b.dataset.v = v;
    b.onclick = () => {
      if (single) {
        state.hand = v;
      } else {
        set.has(v) ? set.delete(v) : set.add(v);
      }
      render();
    };
    el.appendChild(b);
  });
}

function countBy(fn) {
  const c = {};
  DRILLS.forEach((d) => fn(d).forEach((v) => (c[v] = (c[v] || 0) + 1)));
  return c;
}

function initApp(drills) {
  DRILLS = drills;
  DRILLS.forEach((d) => (byId[d.id] = d));
  TYPES = [...new Set(DRILLS.map((d) => d.drillType).filter(Boolean))].sort();
  makeChips($('#focusChips'), FOCUS, state.focus, countBy((d) => d.focus));
  makeChips($('#ageChips'), AGES, state.ages, countBy((d) => d.ages));
  makeChips($('#handChips'), HANDS, null, null, true);
  makeChips($('#catChips'), CATS, state.cats, countBy((d) => [d.category]));
  makeChips($('#typeChips'), TYPES, state.types, null);
  makeChips($('#diffChips'), DIFFS, state.diffs, null);
  $('#totalBadge').textContent = `${DRILLS.length} drills`;
  const fc = $('#footerCount');
  if (fc) fc.textContent = DRILLS.length;
  $('#gate').hidden = true;
  $('#appShell').hidden = false;
  render();
}

/* ---------- filtering ---------- */
function drillHand(d) {
  const t = (d.name + ' ' + d.fixes + ' ' + d.description + ' ' + d.howTo).toLowerCase();
  if (/\b(left-?hand|lefty|lefties)\b/.test(t)) return 'Lefty';
  if (/\b(right-?hand|righty|righties)\b/.test(t)) return 'Righty';
  return 'Any';
}

function matches(d) {
  if (state.focus.size && !d.focus.some((f) => state.focus.has(f))) return false;
  if (state.ages.size && !d.ages.some((a) => state.ages.has(a))) return false;
  if (state.cats.size && !state.cats.has(d.category)) return false;
  if (state.types.size && !state.types.has(d.drillType)) return false;
  if (state.diffs.size && !state.diffs.has(d.difficulty)) return false;
  if (state.hand !== 'Any') {
    const h = drillHand(d);
    if (h !== 'Any' && h !== state.hand) return false;
  }
  if (state.q) {
    const hay = [d.name, d.fixes, d.purpose, d.description, d.cue, d.problems.join(' '), d.goals.join(' '), d.tags.join(' '), d.equipment.join(' '), d.drillType].join(' ').toLowerCase();
    if (!state.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/* ---------- rendering ---------- */
function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ageRange(ages) {
  if (ages.length === 1) return ages[0];
  const short = { 'Beginner': 'Beg', 'Intermediate': 'Int', 'Advanced': 'Adv', 'Pro Level': 'Pro' };
  return short[ages[0]] + '\u2013' + short[ages[ages.length - 1]];
}

function card(d) {
  const thumb = d.thumb
    ? `<img src="${esc(d.thumb)}" alt="" loading="lazy" onerror="this.parentNode.innerHTML='<div class=no-video>No video yet</div>'">` +
      (d.video ? '<span class="play">&#9654; Video</span>' : '')
    : '<div class="no-video">No video yet</div>';
  const badges =
    `<span class="badge cat">${esc(d.category)}</span>` +
    (d.level ? `<span class="badge lvl">${esc(d.level)}</span>` : '') +
    (d.ages.length && ageRange(d.ages) !== d.level ? `<span class="badge lvl">${esc(ageRange(d.ages))}</span>` : '');
  const fallback = d.problems.length ? d.problems.join(', ') : d.goals.join(', ');
  const blurb = d.fixes || fallback || d.purpose || d.description;
  const fixes = (d.fixes || fallback) ? `<strong>Fixes:</strong> ${esc(blurb)}` : esc(blurb);
  const meta = [d.drillType, d.duration, d.difficulty].filter(Boolean).map(esc).join(' &middot; ');
  return `<button class="card" onclick="openDrill('${d.id}')">
    <div class="card-thumb">${thumb}</div>
    <div class="card-body">
      <div class="card-badges">${badges}</div>
      <div class="card-title">${esc(d.name)}</div>
      <p class="card-fixes">${fixes}</p>
      <div class="card-meta">${meta}</div>
    </div>
  </button>`;
}

let shown = 60;
function render(keepShown) {
  if (!keepShown) shown = 60;
  const res = DRILLS.filter(matches);
  const grid = $('#resultsGrid');
  grid.innerHTML = res.slice(0, shown).map(card).join('');
  if (res.length > shown) {
    const more = document.createElement('button');
    more.className = 'clear-btn';
    more.style.gridColumn = '1/-1';
    more.textContent = `Show ${Math.min(60, res.length - shown)} more`;
    more.onclick = () => { shown += 60; render(true); };
    grid.appendChild(more);
  }
  $('#emptyState').hidden = res.length > 0;
  $('#resultCount').innerHTML = `<strong>${res.length}</strong> of ${DRILLS.length} drills`;
  $('#handNote').hidden = state.hand === 'Any';
  document.querySelectorAll('.chips .chip').forEach((c) => {
    const p = c.parentNode.id;
    const v = c.dataset.v;
    let on = false;
    if (p === 'focusChips') on = state.focus.has(v);
    else if (p === 'ageChips') on = state.ages.has(v);
    else if (p === 'handChips') on = state.hand === v;
    else if (p === 'catChips') on = state.cats.has(v);
    else if (p === 'typeChips') on = state.types.has(v);
    else if (p === 'diffChips') on = state.diffs.has(v);
    c.classList.toggle('on', on);
  });
}

/* ---------- modal ---------- */
function ytId(url) {
  const m = (url || '').match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{6,})/);
  return m ? m[1] : null;
}
function ytEmbed(url) {
  const id = ytId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1` : null;
}
function ytWatch(url) {
  const id = ytId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : url;
}

function steps(text) {
  if (!text) return '';
  let parts = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1) {
    const numbered = text.split(/\s*\d+[\)\.]\s+/).map((s) => s.trim()).filter(Boolean);
    if (numbered.length > 1) parts = numbered;
  }
  parts = parts.map((p) => p.replace(/^\d+[\)\.]\s*/, '').replace(/^-\s*/, ''));
  if (parts.length > 1) return `<ol>${parts.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>`;
  return `<p>${esc(text)}</p>`;
}

function openDrill(id) {
  const d = byId[id];
  if (!d) return;
  const embed = ytEmbed(d.video);
  const head = embed
    ? `<div class="modal-video"><iframe src="${embed}" title="${esc(d.name)}" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe></div>` +
      `<a class="yt-fallback" href="${esc(ytWatch(d.video))}" target="_blank" rel="noopener">Video not playing? <strong>Watch on YouTube &nearr;</strong></a>`
    : d.thumb
    ? `<div class="modal-video"><img src="${esc(d.thumb)}" alt="" style="width:100%;height:100%;object-fit:cover"></div>`
    : '';
  const badges =
    `<span class="badge cat">${esc(d.category)}</span>` +
    [d.level, d.difficulty, d.duration].filter(Boolean).map((x) => `<span class="badge lvl">${esc(x)}</span>`).join('') +
    d.ages.map((a) => `<span class="badge lvl">${esc(a)}</span>`).join('');


  const next = d.nextDrill && byId[d.nextDrill] ? byId[d.nextDrill] : null;
  const nextHtml = next
    ? `<div class="m-section"><h3>Best next drill</h3>
       <button class="next-drill" onclick="openDrill('${next.id}')">
         ${next.thumb ? `<img src="${esc(next.thumb)}" alt="">` : ''}
         <span><span class="nd-label">Up next</span><br>
         <span class="nd-name">${esc(next.name)}</span><br>
         <span class="nd-why">${esc(d.nextReason)}${next.level ? ' &middot; ' + esc(next.level) : ''}</span></span>
         <span class="nd-arrow">&rarr;</span>
       </button></div>`
    : '';

  $('#modal').innerHTML = `
    <div class="modal-head">
      <button class="modal-close" onclick="closeModal()" aria-label="Close">&times;</button>
      ${head}
    </div>
    <div class="modal-content">
      <div class="modal-title-row">
        <div class="modal-badges">${badges}</div>
        <h2 class="modal-title">${esc(d.name)}</h2>
        ${d.purpose ? `<p class="modal-purpose">${esc(d.purpose)}</p>` : ''}
      </div>
      ${d.cue ? `<div class="cue-box">&ldquo;${esc(d.cue.replace(/^[“"]+|[”"]+$/g, ''))}&rdquo;</div>` : ''}
      ${(d.fixes || d.problems.length) ? `<div class="m-section"><h3>What it fixes</h3><p>${esc(d.fixes || d.problems.join(', '))}</p></div>` : ''}
      ${d.howTo ? `<div class="m-section"><h3>How to run it</h3>${steps(d.howTo)}</div>` : ''}
      <div class="two-col">
        ${d.feel ? `<div class="m-section"><h3>What to feel</h3><p>${esc(d.feel)}</p></div>` : ''}
        ${d.watchFor ? `<div class="m-section"><h3>Coach: watch for</h3><p>${esc(d.watchFor)}</p></div>` : ''}
      </div>
      ${d.mistakes ? `<div class="m-section"><h3>Common mistakes</h3><p>${esc(d.mistakes)}</p></div>` : ''}
      ${d.equipment.length ? `<div class="m-section"><h3>Equipment</h3><div class="equip-row">${d.equipment.map((e) => `<span class="chip">${esc(e)}</span>`).join('')}</div></div>` : ''}
      ${nextHtml}
      ${d.nextStepsText ? `<div class="m-section"><h3>Progression notes</h3><p>${esc(d.nextStepsText)}</p></div>` : ''}
    </div>`;
  $('#modalBackdrop').hidden = false;
  $('#modal').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('#modalBackdrop').hidden = true;
  $('#modal').innerHTML = '';
  document.body.style.overflow = '';
}
$('#modalBackdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ---------- search + reset + theme ---------- */
let deb;
$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(deb);
  deb = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 120);
});
$('#clearBtn').onclick = resetAll;
function resetAll() {
  state.q = '';
  state.focus.clear(); state.ages.clear(); state.cats.clear(); state.types.clear(); state.diffs.clear();
  state.hand = 'Any';
  $('#searchInput').value = '';
  render();
  window.scrollTo({ top: 0 });
}

let theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
document.documentElement.dataset.theme = theme;
$('#themeToggle').onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
};

/* ---------- access gate (AES-GCM encrypted dataset) ---------- */
const enc = new TextEncoder();
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const COOKIE = '__Host-csdf';
function saveCode(v) {
  try { document.cookie = `${COOKIE}=${encodeURIComponent(v)}; Secure; Path=/; SameSite=Lax; Max-Age=31536000`; } catch (e) {}
}
function readCode() {
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE.replace(/[-]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  } catch (e) { return null; }
}
function clearCode() {
  try { document.cookie = `${COOKIE}=; Secure; Path=/; SameSite=Lax; Max-Age=0`; } catch (e) {}
}

async function tryUnlock(code) {
  const norm = code.trim().toUpperCase();
  if (!norm) return false;
  try {
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(norm), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(ENC_DRILLS.salt), iterations: ENC_DRILLS.iter, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(ENC_DRILLS.iv) }, key, b64(ENC_DRILLS.data));
    const drills = JSON.parse(new TextDecoder().decode(pt));
    saveCode(norm);
    initApp(drills);
    return true;
  } catch (e) {
    return false;
  }
}

const gateForm = $('#gateForm');
gateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#gateBtn');
  btn.disabled = true; btn.textContent = 'Checking\u2026';
  const ok = await tryUnlock($('#gateInput').value);
  btn.disabled = false; btn.textContent = 'Unlock';
  $('#gateError').hidden = ok;
  if (!ok) { $('#gateInput').select(); }
});

const lockBtn = $('#lockBtn');
if (lockBtn) lockBtn.onclick = () => {
  clearCode();
  location.reload();
};

(async () => {
  const saved = readCode();
  if (saved && (await tryUnlock(saved))) return;
  $('#gate').hidden = false;
  $('#gateInput').focus();
})();
