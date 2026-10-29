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
let buildMode = false;
let planSel = [];
let sessionView = null; // {ids, name, note}

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
  const isCoach = accessContext.role === 'coach';
  $('#buildBtn').hidden = !isCoach;
  if (!isCoach) {
    buildMode = false;
    planSel = [];
    $('#buildBar').hidden = true;
    $('#buildPanel').hidden = true;
    $('#buildOutput').hidden = true;
  }
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
  applyHash();
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
  const selected = buildMode && planSel.includes(d.id);
  const num = sessionView ? `<span class="seq-badge">${sessionView.ids.indexOf(d.id) + 1}</span>` : '';
  const selMark = selected ? '<span class="sel-mark">&#10003; Added</span>' : '';
  return `<button class="card${selected ? ' sel' : ''}" onclick="cardClick('${d.id}')">
    <div class="card-thumb">${num}${selMark}${thumb}</div>
    <div class="card-body">
      <div class="card-badges">${badges}</div>
      <div class="card-title">${esc(d.name)}</div>
      <p class="card-fixes">${fixes}</p>
      <div class="card-meta">${meta}</div>
    </div>
  </button>`;
}

function cardClick(id) {
  if (buildMode) {
    const i = planSel.indexOf(id);
    if (i >= 0) planSel.splice(i, 1);
    else planSel.push(id);
    $('#buildOutput').hidden = true;
    render(true);
    renderBuildBar();
  } else {
    openDrill(id);
  }
}

let shown = 60;
function render(keepShown) {
  if (!keepShown) shown = 60;
  if (sessionView) { renderSession(); return; }
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

let drillReturnFocus = null;
function openDrill(id) {
  const d = byId[id];
  if (!d) return;
  if ($('#modalBackdrop').hidden) drillReturnFocus = document.activeElement;
  const embed = ytEmbed(d.video);
  const head = embed
    ? `<div class="modal-video"><iframe src="${embed}" title="${esc(d.name)}" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe></div>` +
      `<a class="yt-fallback" href="${esc(ytWatch(d.video))}" target="_blank" rel="noopener">Video not playing? <strong>Watch on YouTube &nearr;</strong></a>`
    : d.thumb
    ? `<div class="modal-video"><img src="${esc(d.thumb)}" alt="" style="width:100%;height:100%;object-fit:cover"></div>`
    : '';
  const badges = [d.category, d.level || d.ages[0], d.duration].filter(Boolean).map(x => `<span class="badge lvl">${esc(x)}</span>`).join('');



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
    <div class="drill-toolbar"><span>DRILL GUIDE</span><button class="drill-close" onclick="closeModal()" aria-label="Close drill">Close <span aria-hidden="true">&times;</span></button></div><div class="drill-scroll"><div class="modal-head">
      ${head}
    </div>
    <div class="modal-content">
      <div class="modal-title-row">
        <div class="modal-badges">${badges}</div>
        <h2 id="drillDialogTitle" class="modal-title">${esc(d.name)}</h2>
        ${(d.purpose || d.description) ? `<div class="drill-goal"><h3>The goal</h3><p class="modal-purpose">${esc(d.purpose || d.description)}</p></div>` : ''}
      </div>
      ${d.howTo ? `<div class="m-section"><h3>How to do it</h3>${steps(d.howTo)}</div>` : ''}
      ${d.cue ? `<div class="cue-box" aria-label="Your one reminder">&ldquo;${esc(d.cue.replace(/^[“"]+|[”"]+$/g, ''))}&rdquo;</div>` : ''}
      <details class="drill-more"><summary>More coaching details</summary><div class="drill-extra">
      <div class="two-col">
        ${d.feel ? `<div class="m-section"><h3>What to feel</h3><p>${esc(d.feel)}</p></div>` : ''}
        ${d.watchFor ? `<div class="m-section"><h3>What to look for</h3><p>${esc(d.watchFor)}</p></div>` : ''}
      </div>
      ${d.mistakes ? `<div class="m-section"><h3>Common mistakes</h3><p>${esc(d.mistakes)}</p></div>` : ''}
      ${(d.fixes && d.fixes !== d.purpose) ? `<div class="m-section"><h3>What this addresses</h3><p>${esc(d.fixes)}</p></div>` : ''}
      ${d.equipment.filter(e => !/^(varies|none|n\/a)$/i.test(e.trim())).length ? `<div class="m-section"><h3>Equipment</h3><div class="equip-row">${d.equipment.filter(e => !/^(varies|none|n\/a)$/i.test(e.trim())).map((e) => `<span class="chip">${esc(e)}</span>`).join('')}</div></div>` : ''}
      ${nextHtml}
      ${d.nextStepsText ? `<div class="m-section"><h3>Progression notes</h3><p>${esc(d.nextStepsText)}</p></div>` : ''}
      </div></details>
    </div></div>`;
  $('#modal').setAttribute('aria-labelledby', 'drillDialogTitle');
  $('#modalBackdrop').hidden = false;
  $('#modal .drill-scroll').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  $('#modal .drill-close').focus({preventScroll:true});
}

function closeModal() {
  $('#modalBackdrop').hidden = true;
  $('#modal').innerHTML = '';
  document.body.style.overflow = '';
  if (drillReturnFocus?.isConnected) drillReturnFocus.focus({preventScroll:true});
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

let theme = 'dark';
document.documentElement.dataset.theme = theme;
$('#themeToggle').onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
};

/* ---------- session view (shared plan links) ---------- */
function renderSession() {
  const drills = sessionView.ids.map((i) => byId[i]).filter(Boolean);
  $('#finderControls').hidden = true;
  const mins = drills.reduce((s, d) => s + (parseInt(d.duration) || 0), 0);
  $('#sessionBanner').hidden = false;
  $('#sessionBanner').innerHTML = `
    <div class="sb-inner">
      <span class="sb-label">Your assignments${sessionView.name ? ' for ' + esc(sessionView.name) : ''}</span>
      <h2 class="sb-title">${drills.length} drills from Coach Steve${mins ? ' &middot; ~' + mins + ' min' : ''}</h2>
      ${sessionView.note ? `<p class="sb-note">&ldquo;${esc(sessionView.note)}&rdquo;</p>` : ''}
      <p class="sb-hint">Work top to bottom. Tap a drill for video, setup, and cues. Keep the text message to reopen this assignment.</p>
      <button class="clear-btn" onclick="exitSession()">Browse the full library &rarr;</button>
    </div>`;
  $('#resultsGrid').innerHTML = drills.map(card).join('');
  $('#emptyState').hidden = true;
  $('#resultCount').innerHTML = `<strong>${drills.length}</strong> assigned drills`;
  $('#handNote').hidden = true;
}

function exitSession() {
  sessionView = null;
  history.replaceState(null, '', location.pathname + location.search);
  $('#sessionBanner').hidden = true;
  $('#finderControls').hidden = false;
  render();
}

function applyHash() {
  const h = location.hash.slice(1);
  if (!h.startsWith('plan=')) return false;
  const p = new URLSearchParams(h);
  const ids = (p.get('plan') || '').split(',').filter((i) => byId[i]);
  if (!ids.length) return false;
  if (buildMode) {
    buildMode = false;
    $('#buildBar').hidden = true;
    $('#buildBtn').classList.remove('on');
    $('#buildBtn').textContent = '+ Build session';
  }
  sessionView = { ids, name: p.get('for') || '', note: p.get('note') || '' };
  return true;
}

/* ---------- session builder ---------- */
function makePacks() {
  const pick = (fn) => DRILLS.filter((d) => d.category === 'Hitting' && d.video && fn(d)).slice(0, 4).map((d) => d.id);
  return [
    { name: 'Timing Tune-Up', ids: pick((d) => d.problems.some((p) => ['timing', 'rhythm'].includes(p))) },
    { name: 'Casting Fix Pack', ids: pick((d) => d.problems.includes('Casting')) },
    { name: 'Balance Builder', ids: pick((d) => d.problems.some((p) => ['Lunging', 'Drifting Forward'].includes(p))) },
  ].filter((p) => p.ids.length >= 3);
}

function setBuildMode(on) {
  if (accessContext.role !== 'coach') return;
  buildMode = on;
  if (on && sessionView) exitSession();
  $('#buildBar').hidden = !on;
  $('#buildBtn').classList.toggle('on', on);
  $('#buildBtn').textContent = on ? 'Building\u2026' : '+ Build session';
  if (on) renderBuildBar();
  render(true);
}

function renderBuildBar() {
  if (accessContext.role !== 'coach') return;
  $('#buildCount').textContent = `${planSel.length} drill${planSel.length === 1 ? '' : 's'}`;
  $('#getLinkBtn').disabled = planSel.length === 0;
  $('#textSessionBtn').disabled = planSel.length === 0;
  $('#sendStatus').textContent = '';
  if (!$('#buildOutput').hidden) $('#planLink').value = planUrl();
  const list = $('#buildList');
  list.innerHTML = planSel.map((id, i) => {
    const d = byId[id];
    return `<li><span>${esc(d.name)}</span>
      <span class="bl-actions">
        ${i > 0 ? `<button onclick="movePlan(${i},-1)" aria-label="Move up">&uarr;</button>` : ''}
        ${i < planSel.length - 1 ? `<button onclick="movePlan(${i},1)" aria-label="Move down">&darr;</button>` : ''}
        <button onclick="removePlan(${i})" aria-label="Remove">&times;</button>
      </span></li>`;
  }).join('') || '<li class="bl-empty">Tap drills in the library to add them.</li>';
  const packs = $('#packChips');
  if (!packs.dataset.done) {
    makePacks().forEach((p) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = p.name;
      b.onclick = () => { planSel = [...p.ids]; $('#buildOutput').hidden = true; render(true); renderBuildBar(); $('#buildPanel').hidden = false; };
      packs.appendChild(b);
    });
    packs.dataset.done = '1';
  }
}

function movePlan(i, dir) {
  const j = i + dir;
  [planSel[i], planSel[j]] = [planSel[j], planSel[i]];
  render(true); renderBuildBar();
}
function removePlan(i) {
  planSel.splice(i, 1);
  $('#buildOutput').hidden = true;
  render(true); renderBuildBar();
}

function planUrl() {
  const p = new URLSearchParams();
  p.set('plan', planSel.join(','));
  const name = $('#planFor').value.trim();
  const note = $('#planNote').value.trim();
  if (name) p.set('for', name);
  if (note) p.set('note', note);
  return location.origin + location.pathname + '#' + p.toString();
}

function sessionMessage() {
  const name = $('#planFor').value.trim();
  const note = $('#planNote').value.trim();
  return `Hi${name ? ' ' + name : ''}, here's your training session from Coach Steve.${note ? '\n\n' + note : ''}\n\nOpen your assigned drills: ${planUrl()}\n\nEnter your player access code if asked. Work through the drills in order.\n\n— Coach Steve`;
}

function smsHref(phone, message, userAgent = navigator.userAgent) {
  const raw = String(phone || '').trim();
  // Accept formatted phone numbers; never allow a recipient to inject URI parameters.
  if (raw && !/^\+?[0-9\s().-]+$/.test(raw)) throw new Error('Enter a phone number using digits, or leave it blank to choose in your texting app.');
  const number = raw.replace(/[^+0-9]/g, '');
  const count = number.replace(/\D/g, '').length;
  if (raw && (count < 7 || count > 15)) throw new Error('Check the phone number, or leave it blank to choose in your texting app.');
  const separator = /iPad|iPhone|iPod/.test(userAgent) ? '&' : '?';
  return 'sms:' + number + separator + 'body=' + encodeURIComponent(message);
}

function showShareOutput() {
  $('#buildPanel').hidden = false;
  $('#buildOutput').hidden = false;
  $('#planLink').value = planUrl();
}

function planText() {
  const name = $('#planFor').value.trim();
  const note = $('#planNote').value.trim();
  let t = `Coach Steve \u2014 training session${name ? ' for ' + name : ''}\n`;
  if (note) t += note + '\n';
  t += '\n';
  planSel.forEach((id, i) => {
    const d = byId[id];
    t += `${i + 1}. ${d.name}${d.duration ? ' (' + d.duration + ')' : ''}${d.cue ? ' \u2014 \u201C' + d.cue.replace(/^[\u201C"]+|[\u201D"]+$/g, '') + '\u201D' : ''}\n`;
  });
  t += `\nOpen your session: ${planUrl()}`;
  return t;
}

async function copyToClipboard(text, btn, okLabel) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      ok = document.execCommand('copy'); ta.remove();
    } catch (e2) { ok = false; }
  }
  const orig = btn.textContent;
  btn.textContent = ok ? okLabel : 'Select & copy manually';
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

$('#buildBtn').onclick = () => setBuildMode(!buildMode);
$('#buildDone').onclick = () => setBuildMode(false);
$('#buildClear').onclick = () => { planSel = []; $('#buildOutput').hidden = true; render(true); renderBuildBar(); };
$('#buildTogglePanel').onclick = () => { $('#buildPanel').hidden = !$('#buildPanel').hidden; };
$('#getLinkBtn').onclick = () => {
  $('#buildPanel').hidden = false;
  $('#buildOutput').hidden = false;
  $('#planLink').value = planUrl();
};
$('#copyLinkBtn').onclick = (e) => copyToClipboard(planUrl(), e.target, 'Copied!');
$('#copyTextBtn').onclick = (e) => copyToClipboard(planText(), e.target, 'Copied!');

$('#textSessionBtn').onclick = () => {
  if (!planSel.length) return;
  showShareOutput();
  try {
    const href = smsHref($('#planPhone').value, sessionMessage());
    $('#sendStatus').textContent = 'Opening your texting app. Nothing is sent until you press Send. If no app opens, choose Copy text message below.';
    const link = document.createElement('a');
    link.href = href;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    $('#sendStatus').textContent = error.message;
    $('#planPhone').focus();
  }
};
$('#copyMessageBtn').onclick = (e) => copyToClipboard(sessionMessage(), e.target, 'Message copied!');
if (typeof navigator.share === 'function') {
  $('#shareSessionBtn').hidden = false;
  $('#shareSessionBtn').onclick = async () => {
    try {
      await navigator.share({ title: 'Coach Steve — your assigned drills', text: sessionMessage() });
    } catch (error) {
      if (error.name !== 'AbortError') $('#sendStatus').textContent = 'Sharing is unavailable here. Use Copy text message.';
    }
  };
}
if (location.hash.startsWith('#plan=')) {
  $('.gate-sub').textContent = 'Your assigned drills are ready. Enter your player access code to open the session Coach Steve sent you.';
}

$('#planLink').addEventListener('focus', (e) => e.target.select());
['planFor', 'planNote'].forEach((id) => $('#' + id).addEventListener('input', () => {
  if (!$('#buildOutput').hidden) $('#planLink').value = planUrl();
}));
window.addEventListener('hashchange', () => { if (applyHash()) render(); });

/* ---------- access gate (server-side session) ---------- */
let accessContext = { accessId: null, role: "player" };

async function loadLibrary() {
  try {
    const response = await fetch('/api/library', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) return false;
    const payload = await response.json();
    if (!Array.isArray(payload.drills)) return false;
    accessContext = { accessId: payload.accessId || null, role: payload.role || 'player' };
    initApp(payload.drills);
    return true;
  } catch {
    return false;
  }
}

async function tryUnlock(code) {
  const norm = String(code || '').trim().toUpperCase();
  if (!norm) return false;
  try {
    const response = await fetch('/api/access', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ code: norm })
    });
    if (!response.ok) return false;
    return await loadLibrary();
  } catch {
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
if (lockBtn) lockBtn.onclick = async () => {
  try {
    await fetch('/api/access', { method: 'DELETE', credentials: 'same-origin' });
  } catch {}
  location.reload();
};

(async () => {
  if (await loadLibrary()) return;
  $('#gate').hidden = false;
  $('#gateInput').focus();
})();

