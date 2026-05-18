const state = {
  user: null,
  stories: [],
  publicStories: [],
  monetization: null,
  adminLoaded: false
};

let deferredInstallPrompt = null;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getApiBase() {
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';

  // Normal deployment and normal npm run dev use same-origin API.
  if (window.location.protocol !== 'file:' && (!isLocal || window.location.port === '3000')) return '';

  // Fix for VS Code Live Server / Go Live / file-opened pages.
  // The frontend may be opened on port 5500, but the Express backend runs on port 3000.
  const localHost = host || 'localhost';
  return `http://${localHost}:3000`;
}

function apiUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${getApiBase()}${url}`;
}

async function api(url, options = {}) {
  try {
    const response = await fetch(apiUrl(url), {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      credentials: 'include',
      mode: 'cors',
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed with status ${response.status}.`);
    return data;
  } catch (error) {
    if (String(error.message || '').toLowerCase().includes('failed to fetch')) {
      throw new Error('Cannot connect to the backend server. Open http://localhost:3000/health to check it. If it does not open, run npm run dev inside the project folder. Do not use VS Code Go Live unless the Express server is also running.');
    }
    throw error;
  }
}

function showNotice(message, type = 'success', target = '#appNotice') {
  const box = $(target);
  if (!box) return;
  box.textContent = message;
  box.className = `notice ${type}`;
  box.classList.remove('hidden');
  setTimeout(() => box.classList.add('hidden'), 5200);
}

function setUser(user) {
  state.user = user;
  if (!user) {
    $('#authView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
    $('#logoutBtn').classList.add('hidden');
    return;
  }

  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#logoutBtn').classList.remove('hidden');
  $('#profileName').textContent = user.name;
  $('#profileEmail').textContent = `${user.email} • ${user.role === 'admin' ? 'Admin management account' : 'Reader and Writer'}`;
  $('#coinCount').textContent = Number(user.coins || 0);
  $('#earningsCount').textContent = Number(user.earnings || 0);
  $('#walletCoinMirror') && ($('#walletCoinMirror').textContent = Number(user.coins || 0));
  $('#monetizationMini').textContent = user.role === 'admin' ? 'Admin tools only' : `Monetization: ${user.monetizationStatus || 'not_applied'}`;
  const initial = String(user.name || user.email || 'U').trim().charAt(0).toUpperCase() || 'U';
  $('#profileInitial') && ($('#profileInitial').textContent = initial);
  $('#profileBigInitial') && ($('#profileBigInitial').textContent = initial);
  $('#homeAvatar') && ($('#homeAvatar').textContent = initial);

  const isAdmin = user.role === 'admin';
  $$('.user-tab').forEach(btn => btn.classList.toggle('hidden', isAdmin));
  $$('.admin-tab').forEach(btn => btn.classList.toggle('hidden', !isAdmin));
}

function setTab(tab) {
  $$('.tab-panel').forEach(panel => panel.classList.add('hidden'));
  $(`#${tab}Tab`)?.classList.remove('hidden');
  $$('.side-menu button').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));

  if (tab === 'dashboard') loadDashboard();
  if (tab === 'library') loadMyStories();
  if (tab === 'reader') loadPublicStories();
  if (tab === 'wallet') loadWallet();
  if (tab === 'profile') loadProfile();
  if (tab === 'monetization') loadMonetization();
  if (tab === 'admin') loadAdminOverview();
  if (tab === 'adminUsers') loadAdminUsers();
  if (tab === 'adminTopups') loadAdminTopups();
  if (tab === 'adminWithdrawals') loadAdminWithdrawals();
  if (tab === 'adminStories') loadAdminStories();
  if (tab === 'adminMonetization') loadAdminMonetization();
  if (tab === 'adminReports') loadAdminReports();
  if (tab === 'adminTransactions') loadAdminTransactions();
}

function statCard(label, value, icon = '✦') {
  return `<article class="card stat-card"><div class="icon-box">${icon}</div><h3>${escapeHtml(value)}</h3><p>${escapeHtml(label)}</p></article>`;
}

function statusTag(status) {
  return `<span class="tag ${escapeHtml(status || '')}">${escapeHtml(status || 'none')}</span>`;
}

function formatDate(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

function storyInitial(story = {}) {
  return String(story.title || 'InkTales').trim().charAt(0).toUpperCase() || 'I';
}

function exactStoryArtIndex(story = {}) {
  const key = String(story.id || story.title || 'inktales');
  let total = 0;
  for (let i = 0; i < key.length; i += 1) total += key.charCodeAt(i);
  return (total % 7) + 1;
}

function storyCoverHtml(story = {}) {
  const title = story.title || 'InkTales Story';
  const genre = story.genre || 'Story';
  const art = exactStoryArtIndex(story);
  return `<div class="story-cover-exact art-${art}"><small>${escapeHtml(genre)}</small><strong>${escapeHtml(title)}</strong></div>`;
}


function storyTextPreview(story = {}, chars = 160) {
  const value = story.summary || story.preview || story.content || '';
  return String(value).slice(0, chars) + (String(value).length > chars ? '...' : '');
}

function conversionAvailability(story = {}) {
  const c = story.conversions || {};
  return `<div class="tags"><span class="tag">Manga: ${c.manga ? 'Ready' : 'Not yet'}</span><span class="tag">Comic: ${c.comic ? 'Ready' : 'Not yet'}</span><span class="tag">Text: ${story.unlocked || story.status === 'draft' || story.status === 'published' ? 'Ready' : 'Locked'}</span></div>`;
}

function getStoryById(id) {
  return [...(state.publicStories || []), ...(state.stories || [])].find(story => story.id === id);
}

function setStoryModalMode(mode = 'detail') {
  const modal = $('#storyModeModal');
  if (!modal) return;
  modal.classList.remove('reader-fullscreen', 'manga-reader', 'comic-reader', 'text-reader', 'detail-reader');
  document.body.classList.remove('story-reader-open');

  if (mode === 'manga' || mode === 'comic') {
    modal.classList.add('reader-fullscreen', `${mode}-reader`);
    document.body.classList.add('story-reader-open');
  } else if (mode === 'text') {
    modal.classList.add('text-reader');
  } else {
    modal.classList.add('detail-reader');
  }
}

async function toggleStoryFullscreen() {
  const modal = $('#storyModeModal');
  if (!modal) return;
  try {
    if (!document.fullscreenElement && modal.requestFullscreen) {
      await modal.requestFullscreen();
    } else if (document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch (error) {
    showNotice('Fullscreen is not allowed by this browser. The reader is already expanded inside the page.', 'error');
  }
}

function openStoryDetails(id) {
  const story = getStoryById(id);
  if (!story) return showNotice('Story not found. Refresh the page and try again.', 'error');
  const modal = $('#storyModeModal');
  const content = $('#storyModeContent');
  if (!modal || !content) return;
  setStoryModalMode('detail');
  const isLocked = !story.unlocked && Number(story.price || 0) > 0;
  content.innerHTML = `
    <div class="exact-story-detail">
      <div>
        ${storyCoverHtml(story)}
        <div class="exact-meta mt-2"><span class="exact-star">4.8 ★★★★★</span><span>(${Number(story.likes || 0) + 256})</span></div>
      </div>
      <div>
        <h1>${escapeHtml(story.title || 'Untitled Story')}</h1>
        <div class="exact-author-line"><span>● ${escapeHtml(story.authorName || 'InkTales Author')}</span><span>● Verified Author</span></div>
        <div class="tags"><span class="tag">${escapeHtml(story.genre || 'Fantasy')}</span><span class="tag">Adventure</span></div>
        <div class="exact-story-stats">
          <div><strong>${Number(story.views || 0).toLocaleString()}</strong><span>Reads</span></div>
          <div><strong>${Number(story.likes || 0).toLocaleString()}</strong><span>Likes</span></div>
          <div><strong>${Math.max(1, Math.ceil(String(story.content || story.preview || '').length / 700))}</strong><span>Chapters</span></div>
        </div>
        <p>${escapeHtml(storyTextPreview(story, 230) || 'In a world where stories become worlds, every choice opens a new chapter.')}</p>
        <button class="exact-forgot" type="button">...Read more</button>
        <div class="exact-read-choice">
          <h3>Choose your reading experience</h3>
          <div class="exact-reader-actions">
            ${isLocked ? `<button class="text" onclick="unlockStory('${story.id}')"><span>Unlock ${Number(story.price || 0)} coins</span><small>Premium text</small></button>` : `<button class="text" onclick="openStoryMode('${story.id}', 'text')"><span>▣ Read as Text</span><small>Enjoy the story in words</small></button>`}
            <button class="manga" onclick="openStoryMode('${story.id}', 'manga')"><span>▧ Read as Manga</span><small>Manga-style mode</small></button>
            <button class="comic" onclick="openStoryMode('${story.id}', 'comic')"><span>▤ Read as Comics</span><small>AI comics mode</small></button>
          </div>
          <button class="secondary-btn exact-save-library">▱ Save to Library</button>
        </div>
      </div>
    </div>`;
  modal.classList.remove('hidden');
}

function openStoryMode(id, mode = 'text') {
  const story = getStoryById(id);
  if (!story) return showNotice('Story not found. Refresh the page and try again.', 'error');
  const modal = $('#storyModeModal');
  const content = $('#storyModeContent');
  if (!modal || !content) return;
  setStoryModalMode(mode);

  if (mode === 'text') {
    if (!story.unlocked && Number(story.price || 0) > 0 && !story.content) {
      content.innerHTML = `<div class="exact-text-reader"><div class="exact-reader-title"><small>Locked Story</small><h1>${escapeHtml(story.title)}</h1></div><p class="notice">This premium story is locked. Unlock it first using coins.</p></div>`;
    } else {
      content.innerHTML = `
        <div class="exact-text-reader">
          <div class="exact-reader-head"><button class="exact-back-btn" onclick="openStoryDetails('${story.id}')">←</button><div>Aa</div></div>
          <div class="exact-reader-title"><small>Chapter 1</small><h1>The Beginning</h1></div>
          <div class="exact-reader-copy">${escapeHtml(story.content || story.preview || 'No story text available yet.')}</div>
          <div class="exact-progress"><span>‹ Prev</span><input type="range" min="1" max="24" value="1"><span>Next ›</span><small>1/24</small></div>
        </div>`;
    }
  } else if (mode === 'manga' || mode === 'comic') {
    const title = mode === 'manga' ? 'Manga Reader' : 'Comic Reader';
    const html = storyVisualPagesHtml(story, mode);
    content.innerHTML = `
      <div class="visual-reader-shell ${mode}">
        <div class="exact-reader-head visual-reader-head">
          <button class="exact-back-btn" onclick="openStoryDetails('${story.id}')">← Back</button>
          <div><strong>${title}</strong><span>${escapeHtml(story.title || 'Untitled Story')}</span></div>
          <button class="secondary-btn small-btn visual-fullscreen-btn" onclick="toggleStoryFullscreen()">⛶ Full Screen</button>
        </div>
        <div class="visual-reader-stage ${mode}">${html}</div>
      </div>`;
  }
  modal.classList.remove('hidden');
}

function closeStoryMode() {
  $('#storyModeModal')?.classList.add('hidden');
  setStoryModalMode('detail');
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}

function previewDraft() {
  const title = $('#storyTitle')?.value || 'Untitled story';
  const content = $('#storyContent')?.value || 'No content yet.';
  const modal = $('#storyModeModal');
  const box = $('#storyModeContent');
  if (!modal || !box) return;
  box.innerHTML = `<div class="kicker">Draft Preview</div><h2>${escapeHtml(title)}</h2><div class="notice readable-story mt-2">${escapeHtml(content)}</div>`;
  modal.classList.remove('hidden');
}

function markStoryFinished() {
  const words = String($('#storyContent')?.value || '').trim().split(/\s+/).filter(Boolean).length;
  showNotice(words ? `Marked as finished locally. Save it, then publish from Library. Word count: ${words}.` : 'Write your story first before marking it as finished.');
}

function updateWordCounter() {
  const words = String($('#storyContent')?.value || '').trim().split(/\s+/).filter(Boolean).length;
  $('#wordCounter') && ($('#wordCounter').textContent = `${words} word${words === 1 ? '' : 's'}`);
}

function tableRows(items, columns, emptyText) {
  if (!items || !items.length) return `<p class="notice">${escapeHtml(emptyText || 'No records found.')}</p>`;
  return `
    <div class="table-wrap"><table>
      <thead><tr>${columns.map(col => `<th>${escapeHtml(col.label)}</th>`).join('')}</tr></thead>
      <tbody>${items.map(item => `<tr>${columns.map(col => `<td>${col.render(item)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
  `;
}

async function refreshMe() {
  const data = await api('/api/me');
  if (data.user) setUser(data.user);
  return data.user;
}

async function loadDashboard() {
  try {
    await refreshMe();
    await loadMyStories(false);
    const drafts = state.stories.filter(s => s.status === 'draft').length;
    const published = state.stories.filter(s => s.status === 'published').length;
    const tips = state.stories.reduce((sum, story) => sum + Number(story.tips || 0), 0);
    const views = state.stories.reduce((sum, story) => sum + Number(story.views || 0), 0);
    $('#dashboardStats').innerHTML = [
      statCard('Total stories written', state.stories.length, '📚'),
      statCard('Published stories', published, '🚀'),
      statCard('Draft stories', drafts, '✍'),
      statCard('Tips earned by stories', `${tips} coins`, '🪙'),
      statCard('Story views', views, '👁'),
      statCard('Wallet coins', `${state.user.coins} coins`, '◈'),
      statCard('Creator earnings', `${state.user.earnings} coins`, '💎'),
      statCard('Monetization', state.user.monetizationStatus || 'not_applied', '✅')
    ].join('');
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

function textLines(value = '', maxChars = 28, maxLines = 5) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach(word => {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  const trimmed = lines.slice(0, maxLines);
  if (lines.length > maxLines && trimmed.length) trimmed[trimmed.length - 1] = `${trimmed[trimmed.length - 1].slice(0, Math.max(0, maxChars - 3))}...`;
  return trimmed;
}

function svgTextBlock(lines, x, y, size = 8, weight = 700, fill = '#111', gap = 12) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? gap : 0}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
}

function safeImageUrl(value = '') {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('/generated/')) return url;
  if (url.startsWith('https://image.pollinations.ai/')) return url;
  return '';
}

function buildPollinationsImageUrl(prompt = '', mode = 'manga', pageNumber = 1) {
  const cleanPrompt = String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 1800);
  if (!cleanPrompt) return '';

  const isComic = String(mode).toLowerCase().includes('comic');
  const params = new URLSearchParams({
    model: 'flux',
    width: '1400',
    height: '1800',
    safe: 'true',
    nologo: 'true',
    referrer: 'localhost',
    seed: String(pageNumber || 1)
  });

  const styleLock = isComic
    ? ' Create one full-color western comic page with multiple panels, clean black outlines, expressive original characters, readable storytelling flow, speech bubble spaces, vivid colors, no watermark, no logo.'
    : ' Create one black-and-white manga page with multiple dynamic panels, screentones, speed lines, dramatic cinematic composition, expressive original characters, speech bubble spaces, no watermark, no logo.';

  return `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt + styleLock)}?${params.toString()}`;
}

function resolveFullPageImageUrl(page = {}, mode = 'manga') {
  const direct = safeImageUrl(page.imageUrl);
  if (direct) return direct;

  // Version 10 repair: older conversions may have saved the page plan but not the imageUrl.
  // This rebuilds a Pollinations URL in the browser so the page still loads instead of showing a blank fallback.
  if (page.prompt) return buildPollinationsImageUrl(page.prompt, mode, page.pageNumber || 1);

  const panelPlan = Array.isArray(page.panels)
    ? page.panels.map(panel => {
        const exact = panel.sourceExcerpt || panel.exactText || panel.caption || '';
        const shot = panel.shot || panel.shotType || 'medium shot';
        const mood = panel.mood || 'dramatic';
        const setting = panel.setting || panel.visualLayout || 'story scene';
        const action = panel.action || panel.caption || exact;
        return `Panel ${panel.number || panel.panelNumber || 1}: ${shot}, ${mood}, ${setting}, ${action}.`;
      }).join(' ')
    : '';

  if (panelPlan) return buildPollinationsImageUrl(panelPlan, mode, page.pageNumber || 1);
  return '';
}

function panelSvg(panel) {
  const imageUrl = safeImageUrl(panel.imageUrl);
  const sfx = escapeHtml(panel.sfx || '');
  const exact = panel.sourceExcerpt || panel.exactText || panel.caption || '';
  const dialogueLines = Array.isArray(panel.dialogueLines) && panel.dialogueLines.length
    ? panel.dialogueLines
    : (panel.dialogue ? [panel.dialogue] : []);
  const dialogue = dialogueLines.join(' / ');
  const caption = panel.caption || exact;
  const mood = escapeHtml(panel.mood || 'scene').toUpperCase();

  if (imageUrl) {
    return `
      <div class="ai-panel-art" role="img" aria-label="AI-generated visual panel with exact text overlay">
        <img src="${escapeHtml(imageUrl)}" alt="AI-generated ${escapeHtml(panel.mood || 'story')} panel" loading="lazy" />
        <div class="panel-overlay-top"><span>${mood}</span><small>${escapeHtml(panel.imageProvider || 'Pollinations')} ${panel.imageStatus === 'generated' || panel.imageStatus === 'url_ready' ? '✓' : ''}</small></div>
        ${dialogue ? `<div class="speech-bubble">${escapeHtml(dialogueLines[0] || dialogue)}</div>` : ''}
        ${sfx ? `<div class="sfx-overlay">${sfx}</div>` : ''}
        <div class="caption-strip">${escapeHtml(caption).slice(0, 220)}</div>
      </div>
    `;
  }

  const layout = panel.visualLayout || 'spotlight';
  const characterLabel = (panel.characters || []).length ? (panel.characters || []).slice(0, 2).join(' & ') : 'Scene';
  const textForPanel = dialogue || exact;
  const speechLines = textLines(textForPanel, 25, 4);
  const captionLines = textLines(caption, 34, 3);
  const bgPattern = {
    city: '<rect x="18" y="58" width="34" height="96" fill="none" stroke="#111" stroke-width="3"/><rect x="72" y="34" width="42" height="120" fill="none" stroke="#111" stroke-width="3"/><rect x="132" y="72" width="44" height="82" fill="none" stroke="#111" stroke-width="3"/>',
    street: '<path d="M0 150 L200 118 M0 170 L200 138" stroke="#111" stroke-width="3"/><rect x="18" y="62" width="28" height="70" fill="none" stroke="#111" stroke-width="3"/><rect x="154" y="48" width="30" height="82" fill="none" stroke="#111" stroke-width="3"/>',
    room: '<path d="M20 154 L180 154 M28 48 L96 92 L172 48" stroke="#111" stroke-width="3" fill="none"/><rect x="62" y="100" width="76" height="44" stroke="#111" stroke-width="3" fill="none"/>',
    school: '<rect x="20" y="48" width="160" height="92" fill="none" stroke="#111" stroke-width="3"/><path d="M34 78 H166 M50 48 V140 M100 48 V140 M150 48 V140" stroke="#111" stroke-width="2"/><text x="64" y="36" font-size="11" font-weight="900" fill="#111">SCHOOL</text>',
    phone: '<rect x="72" y="22" width="56" height="120" rx="8" fill="#fff" stroke="#111" stroke-width="4"/><path d="M84 50 H116 M84 70 H116 M84 90 H106" stroke="#111" stroke-width="3"/><circle cx="100" cy="126" r="4" fill="#111"/>',
    forest: '<path d="M40 156 L70 42 L102 156 M102 156 L132 52 L166 156" stroke="#111" stroke-width="4" fill="none"/><path d="M26 75 C54 20 92 20 112 76 C130 28 168 34 184 82" stroke="#111" stroke-width="3" fill="none"/>',
    speedlines: '<path d="M8 18 L84 94 M194 14 L116 90 M8 170 L88 106 M194 172 L112 104 M100 0 L100 72 M100 180 L100 116" stroke="#111" stroke-width="3"/>',
    night: '<circle cx="150" cy="38" r="24" fill="none" stroke="#111" stroke-width="3"/><path d="M22 148 C58 116 92 116 124 148 S170 186 190 148" stroke="#111" stroke-width="3" fill="none"/><path d="M42 36 L46 46 L56 48 L46 52 L42 62 L38 52 L28 48 L38 46 Z" fill="#111"/>',
    rain: '<path d="M36 30 L24 62 M70 20 L58 52 M104 28 L92 60 M138 18 L126 50 M172 30 L160 62 M42 92 L30 124 M86 86 L74 118 M132 90 L120 122 M174 82 L162 114" stroke="#111" stroke-width="3"/><path d="M20 150 C70 128 130 128 180 150" stroke="#111" stroke-width="3" fill="none"/>',
    moon: '<circle cx="144" cy="44" r="26" fill="none" stroke="#111" stroke-width="3"/><path d="M20 154 C52 114 84 114 116 154 S170 190 188 154" stroke="#111" stroke-width="3" fill="none"/>',
    spotlight: '<path d="M88 16 L44 160 L158 160 L112 16" stroke="#111" stroke-width="3" fill="none"/><circle cx="100" cy="94" r="28" fill="none" stroke="#111" stroke-width="4"/>'
  }[layout] || '';

  return `
    <svg class="panel-art" viewBox="0 0 200 210" role="img" aria-label="Generated manga storyboard panel based on exact story text">
      <defs><pattern id="tone${panel.id || panel.number}" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1" fill="#111" opacity=".13"/></pattern></defs>
      <rect x="0" y="0" width="200" height="210" fill="#fff"/>
      <rect x="0" y="0" width="200" height="210" fill="url(#tone${panel.id || panel.number})"/>
      ${bgPattern}
      <circle cx="96" cy="92" r="22" fill="#fff" stroke="#111" stroke-width="4"/>
      <path d="M72 146 C82 118 118 118 130 146" fill="none" stroke="#111" stroke-width="5"/>
      <text x="12" y="24" font-size="12" font-weight="900" fill="#111">${mood}</text>
      <text x="12" y="40" font-size="8" font-weight="900" fill="#111">${escapeHtml(characterLabel).slice(0, 22)}</text>
      ${dialogue ? '<path d="M14 22 H118 Q128 22 128 32 V72 Q128 82 118 82 H36 L22 96 L28 82 H14 Q4 82 4 72 V32 Q4 22 14 22" fill="#fff" stroke="#111" stroke-width="2"/>' : '<rect x="10" y="154" width="180" height="46" fill="#fff" stroke="#111" stroke-width="2"/>'}
      ${dialogue ? svgTextBlock(speechLines, 16, 40, 8, 900, '#111', 10) : svgTextBlock(captionLines, 18, 170, 8, 850, '#111', 10)}
      <text x="130" y="160" font-size="18" font-weight="900" fill="#111" transform="rotate(-10 130 160)">${sfx}</text>
      <text x="12" y="205" font-size="7" font-weight="900" fill="#111">${panel.imageStatus === 'failed' ? 'AI IMAGE FAILED: USING STORYBOARD FALLBACK' : 'EXACT TEXT OVERLAY ENABLED'}</text>
    </svg>
  `;
}

function overlayBoxStyle(box, fallback = {}) {
  const b = { ...fallback, ...(box || {}) };
  return `left:${Number(b.x || 0)}%; top:${Number(b.y || 0)}%; width:${Number(b.w || 30)}%; min-height:${Number(b.h || 8)}%;`;
}


function detectClientVisualLayout(text = '') {
  const lower = String(text || '').toLowerCase();
  if (/rain|storm|thunder|flood/.test(lower)) return 'rain';
  if (/night|dark|shadow|moon/.test(lower)) return 'night';
  if (/forest|tree|mountain|river/.test(lower)) return 'forest';
  if (/run|fight|battle|boom|slam|crash|fast/.test(lower)) return 'speedlines';
  if (/school|class|teacher|student/.test(lower)) return 'school';
  if (/phone|message|call/.test(lower)) return 'phone';
  if (/room|house|door|bed/.test(lower)) return 'room';
  return 'spotlight';
}

function clientPanelsFromStory(story = {}, mode = 'manga') {
  const source = cleanClientText(story.content || story.preview || story.summary || 'A quiet opening scene begins the story.');
  const chunks = source
    .split(/(?<=[.!?])\s+/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, mode === 'comic' ? 5 : 4);
  const usable = chunks.length ? chunks : [source.slice(0, 220) || 'A new story begins.'];
  return usable.map((line, index) => {
    const dialogueLines = extractClientDialogue(line);
    const caption = removeClientDialogue(line) || line;
    return {
      id: `client-${mode}-${index + 1}`,
      number: index + 1,
      sourceExcerpt: line,
      exactText: line,
      caption,
      dialogueLines,
      dialogue: dialogueLines.join(' / '),
      mood: detectClientMood(line, story.genre),
      shot: index === 0 ? 'wide establishing shot' : index % 2 ? 'close-up reaction shot' : 'dynamic action angle',
      action: caption,
      setting: detectClientVisualLayout(line),
      visualLayout: detectClientVisualLayout(line),
      sfx: detectClientSfx(line),
      textAccuracy: 99,
      bubbleBox: overlayBoxesForClient(index, mode).bubbleBox,
      captionBox: overlayBoxesForClient(index, mode).captionBox,
      sfxBox: overlayBoxesForClient(index, mode).sfxBox
    };
  });
}

function cleanClientText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractClientDialogue(text = '') {
  const matches = [...String(text || '').matchAll(/[“"]([^”"]+)[”"]/g)].map(match => match[1].trim()).filter(Boolean);
  return matches.slice(0, 2);
}

function removeClientDialogue(text = '') {
  return String(text || '').replace(/[“"][^”"]+[”"]/g, '').replace(/\s+/g, ' ').trim();
}

function detectClientMood(text = '', genre = '') {
  const lower = `${text} ${genre}`.toLowerCase();
  if (/boom|slam|fight|battle|blood|attack|run/.test(lower)) return 'intense';
  if (/love|heart|kiss|romance/.test(lower)) return 'romantic';
  if (/dark|shadow|fear|ghost|horror/.test(lower)) return 'suspenseful';
  if (/cry|tears|alone|lost/.test(lower)) return 'emotional';
  return 'dramatic';
}

function detectClientSfx(text = '') {
  const match = String(text || '').match(/\b(BOOM|BANG|CRASH|SLAM|WHOOSH|GASP|THUD|RING|KNOCK)\b/i);
  return match ? match[1].toUpperCase() : '';
}

function overlayBoxesForPanels(count, mode = 'manga') {
  const comic = [
    { bubbleBox: { x: 8, y: 6, w: 38, h: 10 }, captionBox: { x: 6, y: 32, w: 40, h: 7 }, sfxBox: { x: 54, y: 30, w: 18, h: 8 } },
    { bubbleBox: { x: 54, y: 6, w: 36, h: 10 }, captionBox: { x: 54, y: 32, w: 38, h: 7 }, sfxBox: { x: 79, y: 30, w: 16, h: 8 } },
    { bubbleBox: { x: 8, y: 42, w: 36, h: 10 }, captionBox: { x: 7, y: 66, w: 38, h: 7 }, sfxBox: { x: 36, y: 60, w: 18, h: 8 } },
    { bubbleBox: { x: 55, y: 42, w: 36, h: 10 }, captionBox: { x: 55, y: 66, w: 38, h: 7 }, sfxBox: { x: 80, y: 60, w: 16, h: 8 } },
    { bubbleBox: { x: 18, y: 79, w: 58, h: 9 }, captionBox: { x: 10, y: 91, w: 78, h: 6 }, sfxBox: { x: 72, y: 80, w: 18, h: 8 } }
  ];
  const manga = [
    { bubbleBox: { x: 62, y: 7, w: 28, h: 13 }, captionBox: { x: 8, y: 28, w: 40, h: 7 }, sfxBox: { x: 75, y: 27, w: 17, h: 8 } },
    { bubbleBox: { x: 6, y: 39, w: 28, h: 15 }, captionBox: { x: 36, y: 57, w: 34, h: 7 }, sfxBox: { x: 42, y: 49, w: 20, h: 8 } },
    { bubbleBox: { x: 68, y: 43, w: 26, h: 15 }, captionBox: { x: 8, y: 71, w: 38, h: 7 }, sfxBox: { x: 46, y: 66, w: 22, h: 8 } },
    { bubbleBox: { x: 52, y: 76, w: 34, h: 13 }, captionBox: { x: 10, y: 91, w: 45, h: 6 }, sfxBox: { x: 36, y: 80, w: 20, h: 8 } }
  ];
  return (mode === 'comic' ? comic : manga).slice(0, Math.max(count, 1));
}

function overlayBoxesForClient(index = 0, mode = 'manga') {
  const boxes = overlayBoxesForPanels(mode === 'comic' ? 5 : 4, mode);
  return boxes[index % boxes.length] || boxes[0];
}

function clientVisualPage(story = {}, mode = 'manga') {
  const panels = clientPanelsFromStory(story, mode);
  return {
    id: `client-${story.id || 'story'}-${mode}`,
    pageNumber: 1,
    title: `${mode === 'comic' ? 'Comic' : 'Manga'} Page 1`,
    layout: mode === 'comic' ? 'full-color comic page' : 'black-and-white manga page',
    textAccuracy: 99,
    provider: 'InkTales local visual reader',
    imageUrl: '',
    imageStatus: 'local_visual_reader',
    panels
  };
}

function visualPanelSceneHtml(panel = {}, mode = 'manga', index = 0) {
  const layout = escapeHtml(panel.visualLayout || panel.setting || 'spotlight');
  const caption = panel.caption || panel.sourceExcerpt || panel.exactText || '';
  const dialogueLines = Array.isArray(panel.dialogueLines) && panel.dialogueLines.length ? panel.dialogueLines : (panel.dialogue ? [panel.dialogue] : []);
  const dialogue = dialogueLines.join(' ');
  const sfx = panel.sfx || '';
  return `
    <section class="ink-visual-panel ${mode} panel-${index + 1} layout-${layout}">
      <div class="ink-panel-art" aria-hidden="true"><span class="ink-art-moon"></span><span class="ink-art-character"></span><span class="ink-art-lines"></span></div>
      <div class="ink-panel-label">${mode === 'comic' ? 'P' : '第'}${Number(panel.number || index + 1)}</div>
      ${dialogue ? `<div class="page-speech-bubble ${mode}" style="${overlayBoxStyle(panel.bubbleBox, { x: 8, y: 8, w: 34, h: 12 })}">${escapeHtml(dialogue)}</div>` : ''}
      ${caption ? `<div class="page-caption-box ${mode}" style="${overlayBoxStyle(panel.captionBox, { x: 8, y: 78, w: 42, h: 8 })}">${escapeHtml(caption).slice(0, 150)}</div>` : ''}
      ${sfx ? `<div class="page-sfx ${mode}" style="${overlayBoxStyle(panel.sfxBox, { x: 62, y: 58, w: 20, h: 10 })}">${escapeHtml(sfx)}</div>` : ''}
    </section>`;
}

function visualPageFallbackHtml(page = {}, mode = 'manga') {
  const panels = Array.isArray(page.panels) && page.panels.length ? page.panels : clientPanelsFromStory({}, mode);
  const count = Math.min(Math.max(panels.length, 1), mode === 'comic' ? 5 : 4);
  return `<div class="ink-visual-page-fallback ${mode} panel-count-${count}" aria-label="InkTales generated ${mode} page">
    ${panels.slice(0, mode === 'comic' ? 5 : 4).map((panel, index) => visualPanelSceneHtml(panel, mode, index)).join('')}
  </div>`;
}

function storyVisualPagesHtml(story = {}, mode = 'manga') {
  const pages = mode === 'manga' ? (story.mangaPages || []) : (story.comicPages || []);
  if (pages.length) return mode === 'manga' ? mangaPagesHtml(pages) : comicPagesHtml(pages);

  if (mode === 'manga' && Array.isArray(story.mangaPanels) && story.mangaPanels.length) {
    const panels = decoratePanelsForClient(story.mangaPanels, 'manga');
    return `<div class="asset-block manga-page-asset-block"><div class="spread"><h4>Manga Page Preview</h4><span class="tag">Fullscreen manga reader</span></div>${fullPageCardHtml({ title: 'Manga Page 1', layout: 'black-and-white manga page', textAccuracy: 99, panels }, 'manga')}</div>`;
  }

  const localPage = clientVisualPage(story, mode);
  const label = mode === 'comic' ? 'Comic Page Preview' : 'Manga Page Preview';
  return `<div class="asset-block ${mode === 'comic' ? 'comic-asset-block' : 'manga-page-asset-block'}"><div class="spread"><h4>${label}</h4><span class="tag">Local visual reader • Convert for AI art</span></div><p class="notice">This fullscreen reader uses your exact story text and builds a ${mode === 'comic' ? 'full-color comic' : 'black-and-white manga'} page layout. Press Convert ${mode === 'comic' ? 'Comic' : 'Manga'} in Library to generate AI artwork.</p>${fullPageCardHtml(localPage, mode)}</div>`;
}

function decoratePanelsForClient(panels = [], mode = 'manga') {
  return panels.map((panel, index) => ({
    ...panel,
    bubbleBox: panel.bubbleBox || overlayBoxesForClient(index, mode).bubbleBox,
    captionBox: panel.captionBox || overlayBoxesForClient(index, mode).captionBox,
    sfxBox: panel.sfxBox || overlayBoxesForClient(index, mode).sfxBox,
    visualLayout: panel.visualLayout || detectClientVisualLayout(panel.sourceExcerpt || panel.caption || '')
  }));
}

function pageOverlayHtml(page, mode = 'manga') {
  const panels = Array.isArray(page.panels) ? page.panels : [];
  return panels.map(panel => {
    const dialogueLines = Array.isArray(panel.dialogueLines) && panel.dialogueLines.length
      ? panel.dialogueLines
      : (panel.dialogue ? [panel.dialogue] : []);
    const dialogue = dialogueLines.join(' ');
    const caption = panel.caption || panel.sourceExcerpt || panel.exactText || '';
    const sfx = panel.sfx || '';
    return `
      ${dialogue ? `<div class="page-speech-bubble ${mode}" style="${overlayBoxStyle(panel.bubbleBox, { x: 8, y: 8, w: 32, h: 10 })}">${escapeHtml(dialogue)}</div>` : ''}
      ${caption ? `<div class="page-caption-box ${mode}" style="${overlayBoxStyle(panel.captionBox, { x: 8, y: 84, w: 42, h: 6 })}">${escapeHtml(caption).slice(0, 180)}</div>` : ''}
      ${sfx ? `<div class="page-sfx ${mode}" style="${overlayBoxStyle(panel.sfxBox, { x: 68, y: 66, w: 18, h: 8 })}">${escapeHtml(sfx)}</div>` : ''}
    `;
  }).join('');
}

function fullPageCardHtml(page, mode = 'manga') {
  const imageUrl = resolveFullPageImageUrl(page, mode);
  const repaired = !safeImageUrl(page.imageUrl) && imageUrl;
  const fallbackPage = visualPageFallbackHtml(page, mode);
  return `
    <article class="generated-full-page ${mode}">
      <div class="full-page-header">
        <strong>${escapeHtml(page.title || `${mode} Page ${page.pageNumber || ''}`)}</strong>
        <span>${escapeHtml(page.layout || 'full page')} • ${Number(page.textAccuracy || 99)}% text match</span>
      </div>
      <div class="full-page-art-wrap ${mode} ${imageUrl ? 'has-image' : 'image-missing'}">
        ${imageUrl
          ? `<img src="${escapeHtml(imageUrl)}" alt="Generated ${escapeHtml(mode)} page ${Number(page.pageNumber || 1)}" loading="lazy" onerror="this.closest('.full-page-art-wrap').classList.add('image-failed')" />`
          : ''}
        ${fallbackPage}
        ${repaired ? '<div class="page-repair-note">Loading repaired full-page AI image...</div>' : ''}
        ${imageUrl ? pageOverlayHtml(page, mode) : ''}
      </div>
      <details class="full-page-source">
        <summary>Show exact source panel breakdown</summary>
        <div class="generated-page-panel-list">
          ${(page.panels || []).map(panel => `
            <article class="generated-panel-meta">
              <h4>Panel ${Number(panel.number || panel.panelNumber || 1)}</h4>
              <p><strong>Mood:</strong> ${escapeHtml(panel.mood || '')}</p>
              <p><strong>Shot:</strong> ${escapeHtml(panel.shot || panel.shotType || '')}</p>
              <p><strong>Exact source:</strong> ${escapeHtml(panel.sourceExcerpt || panel.exactText || '')}</p>
              ${(panel.dialogueLines || []).length ? `<p><strong>Dialogue:</strong> ${escapeHtml((panel.dialogueLines || []).join(' / '))}</p>` : ''}
              ${panel.sfx ? `<p><strong>SFX:</strong> ${escapeHtml(panel.sfx)}</p>` : ''}
            </article>
          `).join('')}
        </div>
      </details>
    </article>
  `;
}

function mangaPagesHtml(pages = []) {
  if (!pages.length) return '';
  return `<div class="asset-block manga-page-asset-block">
    <div class="spread">
      <h4>Manga Pages</h4>
      <span class="tag">Black-and-white full manga page • exact text overlay</span>
    </div>
    <p class="notice">Manga conversion now generates a complete manga page like a real manga layout. Pollinations draws the full page, while InkTales overlays the exact dialogue, captions, and SFX for better text accuracy.</p>
    ${pages.map(page => fullPageCardHtml(page, 'manga')).join('')}
  </div>`;
}

function mangaPanelsHtml(panels = []) {
  if (!panels.length) return '';
  return `<div class="asset-block"><h4>Legacy Manga Panels</h4><p class="notice">These are fallback individual panels. The newer generator uses full manga pages.</p><div class="manga-grid">${panels.map(panel => `
    <article class="manga-panel">
      ${panelSvg(panel)}
      <small>Panel ${panel.number} • ${escapeHtml(panel.shot)} • ${Number(panel.textAccuracy || 99)}% text match • ${escapeHtml(panel.imageStatus || 'storyboard')}</small>
      <h4>${escapeHtml(panel.mood)} scene</h4>
      <p class="source-excerpt"><strong>Exact source:</strong> ${escapeHtml(panel.sourceExcerpt || panel.exactText || panel.caption)}</p>
      ${panel.dialogue ? `<div class="speech">“${escapeHtml(panel.dialogue)}”</div>` : ''}
      ${(panel.characters || []).length ? `<div class="tags"><span class="tag">Characters: ${escapeHtml((panel.characters || []).join(', '))}</span></div>` : ''}${panel.imageError ? `<p class="muted">Image note: ${escapeHtml(panel.imageError)}</p>` : ''}
    </article>
  `).join('')}</div></div>`;
}

function comicPanelHtml(panel, index = 0) {
  const imageUrl = safeImageUrl(panel.imageUrl);
  const dialogueLines = Array.isArray(panel.dialogueLines) && panel.dialogueLines.length
    ? panel.dialogueLines
    : (panel.dialogue ? [panel.dialogue] : []);
  const exact = panel.sourceExcerpt || panel.exactText || panel.caption || '';
  const caption = panel.caption || exact;
  const sfx = panel.sfx || '';

  return `
    <div class="comic-frame ${index === 0 ? 'comic-frame-hero' : ''}">
      <div class="comic-art-wrap">
        ${imageUrl
          ? `<img src="${escapeHtml(imageUrl)}" alt="Comic panel ${Number(panel.number || index + 1)}" loading="lazy" onerror="this.closest('.comic-art-wrap').classList.add('image-failed')" />`
          : panelSvg(panel)}
        <div class="comic-panel-number">P${Number(panel.number || index + 1)}</div>
        ${dialogueLines[0] ? `<div class="comic-speech">${escapeHtml(dialogueLines[0])}</div>` : ''}
        ${sfx ? `<div class="comic-sfx">${escapeHtml(sfx)}</div>` : ''}
      </div>
      <div class="comic-caption">${escapeHtml(caption).slice(0, 260)}</div>
      <details class="comic-source">
        <summary>Exact source text</summary>
        <p>${escapeHtml(exact)}</p>
      </details>
    </div>
  `;
}

function comicPagesHtml(pages = []) {
  if (!pages.length) return '';
  return `<div class="asset-block comic-asset-block">
    <div class="spread">
      <h4>Comic Pages</h4>
      <span class="tag">Full-color comic page • exact text overlay</span>
    </div>
    <p class="notice">Comic conversion now generates a complete comic page image instead of simple cards. Pollinations creates the western comic page, and InkTales overlays exact dialogue/captions.</p>
    ${pages.map(page => resolveFullPageImageUrl(page, 'comic') ? fullPageCardHtml(page, 'comic') : `
        <article class="comic-page">
          <div class="comic-page-header">
            <strong>${escapeHtml(page.title || `Comic Page ${page.pageNumber || ''}`)}</strong>
            <span>${escapeHtml(page.layout || 'comic-grid')} • ${Number(page.textAccuracy || 99)}% text match</span>
          </div>
          ${(page.panels || []).length
            ? `<div class="comic-grid">${(page.panels || []).map((panel, index) => comicPanelHtml(panel, index)).join('')}</div>`
            : '<p class="notice">This comic page has no panels yet. Try Convert Comic again.</p>'}
        </article>
      `).join('')}
  </div>`;
}

function animatedVideoHtml(video) {
  if (!video || !video.scenes || !video.scenes.length) return '';
  return `<div class="asset-block"><h4>Animated Video Preview</h4>
    <div class="video-preview">
      <div class="video-stage">
        ${(video.scenes || []).slice(0, 6).map(scene => `<div class="video-scene">${safeImageUrl(scene.imageUrl) ? `<img src="${escapeHtml(safeImageUrl(scene.imageUrl))}" alt="Animated preview scene ${scene.sceneNumber}" loading="lazy" />` : ''}<div><strong>Scene ${scene.sceneNumber} • ${escapeHtml(scene.mood || 'story')}</strong><span>${escapeHtml(scene.caption || '')}</span></div></div>`).join('')}
      </div>
      <p class="muted">${escapeHtml(video.format)} • ${Number(video.totalDurationSeconds || 0)} seconds • ${Number(video.textAccuracy || 100)}% text match</p>
      <div class="timeline">${video.scenes.map(scene => `<div><strong>${scene.sceneNumber}</strong><span>${escapeHtml(scene.camera)}</span><small>${escapeHtml((scene.caption || '').slice(0, 70))}</small></div>`).join('')}</div>
    </div>
  </div>`;
}

function assetsHtml(story) {
  const mangaReady = Boolean((story.mangaPages && story.mangaPages.length) || (story.mangaPanels && story.mangaPanels.length));
  const comicReady = Boolean(story.comicPages && story.comicPages.length);
  const statusNote = story.status === 'published' ? 'Open in fullscreen or convert again for fresh visuals.' : 'Publish first to enable conversion.';
  return `<div class="exact-conversion-shelf">
    <article class="exact-conversion-card manga ${mangaReady ? 'ready' : ''}">
      <strong>Manga Reader</strong>
      <span>${mangaReady ? 'Generated manga page is ready.' : 'Fullscreen preview is available.'}</span>
      <button class="secondary-btn small-btn" onclick="openStoryMode('${story.id}', 'manga')">Open Fullscreen</button>
    </article>
    <article class="exact-conversion-card comic ${comicReady ? 'ready' : ''}">
      <strong>Comic Reader</strong>
      <span>${comicReady ? 'Generated comic page is ready.' : 'Fullscreen preview is available.'}</span>
      <button class="secondary-btn small-btn" onclick="openStoryMode('${story.id}', 'comic')">Open Fullscreen</button>
    </article>
    <p>${statusNote}</p>
  </div>`;
}

function storyActions(story) {
  const publishButton = story.status === 'published'
    ? `<button class="secondary-btn small-btn" onclick="unpublishStory('${story.id}')">Unpublish</button>`
    : `<button class="primary-btn small-btn" onclick="publishStory('${story.id}')">Publish</button>`;
  const conversionButtons = story.status === 'published'
    ? `<button class="secondary-btn small-btn" onclick="convertStory('${story.id}', 'manga')">Convert Manga</button>
       <button class="secondary-btn small-btn" onclick="convertStory('${story.id}', 'comic')">Convert Comic</button>
       <button class="secondary-btn small-btn" onclick="convertStory('${story.id}', 'animated_video')">Convert Video</button>
       <button class="secondary-btn small-btn" onclick="convertStory('${story.id}', 'all')">Convert All</button>`
    : `<span class="notice inline-notice">Publish first to unlock conversions.</span>`;
  return `<div class="flex story-actions">
    <button class="secondary-btn small-btn" onclick="editStory('${story.id}')">Edit</button>
    ${publishButton}
    ${conversionButtons}
    <button class="danger-btn small-btn" onclick="deleteStory('${story.id}')">Delete</button>
  </div>`;
}

async function loadMyStories(render = true) {
  const data = await api('/api/stories');
  state.stories = data.stories || [];
  if (!render) return;
  if (!state.stories.length) {
    $('#myStories').innerHTML = '<div class="card"><h3>No stories yet.</h3><p>Create your first story. After publishing, convert it into manga, comic, or animated video format.</p></div>';
    return;
  }
  $('#myStories').innerHTML = state.stories.map(story => `
    <article class="exact-library-card">
      ${storyCoverHtml(story)}
      <div>
        <h3>${escapeHtml(story.title)}</h3>
        <p>${story.status === 'published' ? 'Published' : 'Updated 2 min ago'} • ${Math.max(1, Math.ceil(String(story.content || '').length / 700))} Chapter${Math.ceil(String(story.content || '').length / 700) === 1 ? '' : 's'}</p>
        <div class="tags"><span class="tag">${escapeHtml(story.genre || 'Story')}</span><span class="tag">${Number(story.views || 0)} reads</span><span class="tag">${Number(story.likes || 0)} likes</span></div>
      </div>
      <div class="exact-library-actions">
        <span class="exact-status-pill ${escapeHtml(story.status)}">${escapeHtml(story.status || 'draft')}</span>
        <button class="secondary-btn small-btn" onclick="openStoryMode('${story.id}', 'text')">View</button>
        <button class="secondary-btn small-btn" onclick="editStory('${story.id}')">Edit</button>
        ${story.status === 'published' ? `<button class="secondary-btn small-btn" onclick="unpublishStory('${story.id}')">Unpublish</button>` : `<button class="primary-btn small-btn" onclick="publishStory('${story.id}')">Publish</button>`}
        ${story.status === 'published' ? `<button class="secondary-btn small-btn" onclick="convertStory('${story.id}', 'manga')">Manga</button><button class="secondary-btn small-btn" onclick="convertStory('${story.id}', 'comic')">Comic</button>` : ''}
        <button class="danger-btn small-btn" onclick="deleteStory('${story.id}')">Delete</button>
      </div>
      <button class="exact-more" type="button">⋮</button>
      <div class="exact-assets-collapse">${assetsHtml(story)}</div>
    </article>
  `).join('');
}


async function loadPublicStories() {
  const data = await api('/api/public/stories');
  state.publicStories = data.stories || [];
  if (!state.publicStories.length) {
    $('#publicStories').innerHTML = '<div class="card"><h3>No published stories yet.</h3><p>Publish your first story to display it here.</p></div>';
    return;
  }
  const featured = state.publicStories.slice(0, 3);
  const trending = state.publicStories.slice(3, 9);
  const fallbackTrending = trending.length ? trending : state.publicStories.slice(0, 3);
  $('#publicStories').innerHTML = `
    <section>
      <div class="exact-feed-section-header"><h2>Featured Stories</h2><button type="button">View all</button></div>
      <div class="exact-featured-grid">
        ${featured.map(story => `
          <article class="exact-featured-card" onclick="openStoryDetails('${story.id}')">
            ${storyCoverHtml(story)}
            <div class="exact-featured-body">
              <h3>${escapeHtml(story.title)}</h3>
              <p>by ${escapeHtml(story.authorName || 'InkTales Author')}</p>
              <div class="tags"><span class="tag">${escapeHtml(story.genre || 'Fantasy')}</span></div>
              <div class="exact-meta"><span>♡ ${Number(story.views || 0).toLocaleString()}</span><span class="exact-star">★ 4.${(Number(story.likes || 0) % 9) + 1}</span></div>
            </div>
          </article>`).join('')}
      </div>
    </section>
    <section>
      <div class="exact-feed-section-header"><h2>Trending Now</h2><button type="button">See all</button></div>
      <div class="exact-trending-list">
        ${fallbackTrending.map(story => `
          <article class="exact-trending-item" onclick="openStoryDetails('${story.id}')">
            ${storyCoverHtml(story)}
            <div>
              <h3>${escapeHtml(story.title)}</h3>
              <p>${escapeHtml(story.authorName || 'InkTales Author')}</p>
              <div class="exact-meta"><span>${escapeHtml(story.genre || 'Story')}</span><span>♡ ${Number(story.views || 0).toLocaleString()}</span></div>
            </div>
          </article>`).join('')}
      </div>
    </section>`;
}


function exactRequestRows(items, emptyText) {
  if (!items || !items.length) return `<p class="notice">${escapeHtml(emptyText || 'No records found.')}</p>`;
  return `<div class="exact-compact-rows">${items.map(item => `<div class="exact-transaction-row"><div class="icon">${escapeHtml(String(item.method || 'I').charAt(0))}</div><div><strong>${escapeHtml(item.method || item.type || 'Request')}</strong><small>${formatDate(item.createdAt)}</small></div><div><em>${Number(item.amount || 0)} Coins</em>${statusTag(item.status || 'pending')}</div></div>`).join('')}</div>`;
}

async function loadWallet() {
  try {
    await refreshMe();
    const [txData, coinData, withdrawalData] = await Promise.all([
      api('/api/wallet/transactions'),
      api('/api/wallet/coin-requests'),
      api('/api/wallet/withdrawals')
    ]);

    $('#coinRequests').innerHTML = exactRequestRows(coinData.requests || [], 'No top-up requests yet.');
    $('#withdrawalRequests').innerHTML = exactRequestRows(withdrawalData.withdrawals || [], 'No withdrawal requests yet.');

    const txs = txData.transactions || [];
    $('#transactions').innerHTML = txs.length ? txs.slice(0, 8).map(item => `
      <div class="exact-transaction-row">
        <div class="icon">${escapeHtml(String(item.type || 'T').charAt(0).toUpperCase())}</div>
        <div><strong>${escapeHtml(item.type || 'Transaction')}</strong><small>${formatDate(item.createdAt)}</small></div>
        <div><em>${Number(item.amount || 0) >= 0 ? '+' : ''}${Number(item.amount || 0)} Coins</em><small>${escapeHtml(item.note || 'Completed')}</small></div>
      </div>
    `).join('') : '<p class="notice">No transactions yet.</p>';
  } catch (error) {
    showNotice(error.message, 'error');
  }
}


async function loadMonetization() {
  try {
    const data = await api('/api/monetization/status');
    state.monetization = data;
    setUser(data.user);
    const checks = data.eligibility?.checks || [];
    $('#monetizationEligibility').innerHTML = `
      <div class="tags"><span class="tag ${data.user.monetizationStatus}">Status: ${escapeHtml(data.user.monetizationStatus)}</span>${data.eligibility.eligible ? '<span class="tag approved">Eligible</span>' : '<span class="tag pending">Not yet eligible</span>'}</div>
      <div class="checklist">${checks.map(check => `<div><span>${check.passed ? '✅' : '⬜'}</span><strong>${escapeHtml(check.label)}</strong><small>${Number(check.current)} / ${Number(check.required)}</small></div>`).join('')}</div>
      <p class="notice mt-2">${escapeHtml(data.user.monetizationNote || 'Build your story library and engagement to unlock monetization.')}</p>
    `;
    $('#monetizationApplications').innerHTML = tableRows(data.applications || [], [
      { label: 'Payout Name', render: item => escapeHtml(item.payoutName) },
      { label: 'Status', render: item => statusTag(item.status) },
      { label: 'Admin Note', render: item => escapeHtml(item.adminNote || '—') },
      { label: 'Date', render: item => formatDate(item.createdAt) }
    ], 'No monetization applications yet.');
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function login() {
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('#authEmail').value, password: $('#authPassword').value })
    });
    setUser(data.user);
    setTab(data.user.role === 'admin' ? 'admin' : 'reader');
  } catch (error) {
    showNotice(error.message, 'error', '#authNotice');
  }
}

async function register() {
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: $('#authName').value, email: $('#authEmail').value, password: $('#authPassword').value })
    });
    setUser(data.user);
    setTab('reader');
  } catch (error) {
    showNotice(error.message, 'error', '#authNotice');
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  setUser(null);
}

function clearStoryForm() {
  $('#editingStoryId').value = '';
  $('#storyTitle').value = '';
  $('#storyGenre').value = '';
  $('#storySummary').value = '';
  $('#storyPrice').value = 0;
  $('#storyContent').value = '';
  $('#editorHeading').textContent = 'Write a story.';
  $('#saveStoryBtn').textContent = 'Save';
  $('#cancelEditBtn').classList.add('hidden');
  updateWordCounter();
}

async function saveStory() {
  try {
    const id = $('#editingStoryId').value;
    const payload = {
      title: $('#storyTitle').value,
      genre: $('#storyGenre').value,
      summary: $('#storySummary').value,
      price: Number($('#storyPrice').value || 0),
      content: $('#storyContent').value
    };
    if (id) {
      await api(`/api/stories/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showNotice('Story updated successfully.');
    } else {
      await api('/api/stories', { method: 'POST', body: JSON.stringify(payload) });
      showNotice('Story saved as draft.');
    }
    clearStoryForm();
    setTab('library');
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

function editStory(id) {
  const story = state.stories.find(item => item.id === id);
  if (!story) return;
  $('#editingStoryId').value = story.id;
  $('#storyTitle').value = story.title || '';
  $('#storyGenre').value = story.genre || '';
  $('#storySummary').value = story.summary || '';
  $('#storyPrice').value = story.price || 0;
  $('#storyContent').value = story.content || '';
  $('#editorHeading').textContent = 'Edit story.';
  $('#saveStoryBtn').textContent = 'Update';
  $('#cancelEditBtn').classList.remove('hidden');
  updateWordCounter();
  setTab('create');
}

async function deleteStory(id) {
  if (!confirm('Delete this story permanently?')) return;
  try {
    await api(`/api/stories/${id}`, { method: 'DELETE' });
    showNotice('Story deleted.');
    await loadMyStories();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function publishStory(id) {
  try {
    await api(`/api/stories/${id}/publish`, { method: 'POST' });
    showNotice('Story published. You can now convert it into manga, comic, or animated video.');
    await loadMyStories();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function unpublishStory(id) {
  try {
    await api(`/api/stories/${id}/unpublish`, { method: 'POST' });
    showNotice('Story returned to draft.');
    await loadMyStories();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function convertStory(id, type) {
  try {
    const label = type === 'animated_video' ? 'animated video' : type;
    showNotice(`Generating ${label} with Gemini + Pollinations. Please wait...`);
    const data = await api(`/api/stories/${id}/convert`, { method: 'POST', body: JSON.stringify({ type }) });

    if (data.story) {
      state.stories = state.stories.map(story => story.id === data.story.id ? data.story : story);
    }

    showNotice(`Story converted into ${label}. Scroll down inside My Library to see the generated assets.`);
    await loadMyStories();
  } catch (error) {
    showNotice(`Conversion failed: ${error.message}`, 'error');
  }
}

async function unlockStory(id) {
  try {
    const data = await api(`/api/public/stories/${id}/unlock`, { method: 'POST' });
    if (data.user) setUser(data.user);
    showNotice('Story unlocked.');
    await loadPublicStories();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function tipStory(id, amount) {
  try {
    const data = await api(`/api/public/stories/${id}/tip`, { method: 'POST', body: JSON.stringify({ amount }) });
    if (data.user) setUser(data.user);
    showNotice(`Tip sent: ${amount} coins.`);
    await loadPublicStories();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function likeStory(id) {
  try {
    await api(`/api/public/stories/${id}/like`, { method: 'POST' });
    await loadPublicStories();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function reportStory(id) {
  try {
    const reason = prompt('Reason for reporting this story:', 'Inappropriate content');
    if (!reason) return;
    const details = prompt('Optional details:', 'Please review this story.');
    await api(`/api/public/stories/${id}/report`, { method: 'POST', body: JSON.stringify({ reason, details }) });
    showNotice('Report submitted for admin review.');
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function requestCoins() {
  try {
    await api('/api/wallet/coin-requests', {
      method: 'POST',
      body: JSON.stringify({
        amount: Number($('#coinRequestAmount').value || 0),
        method: $('#coinRequestMethod').value,
        reference: $('#coinRequestReference').value,
        note: $('#coinRequestNote').value
      })
    });
    $('#coinRequestReference').value = '';
    $('#coinRequestNote').value = '';
    showNotice('Top-up request submitted for admin approval.');
    await loadWallet();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function requestWithdrawal() {
  try {
    const data = await api('/api/wallet/withdrawals', {
      method: 'POST',
      body: JSON.stringify({
        amount: Number($('#withdrawAmount').value || 0),
        method: $('#withdrawMethod').value,
        accountName: $('#withdrawName').value,
        accountNumber: $('#withdrawNumber').value
      })
    });
    if (data.user) setUser(data.user);
    showNotice('Withdrawal request submitted.');
    await loadWallet();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function applyMonetization() {
  try {
    const data = await api('/api/monetization/apply', {
      method: 'POST',
      body: JSON.stringify({ payoutName: $('#monetizationPayoutName').value, portfolioNote: $('#monetizationNote').value })
    });
    if (data.user) setUser(data.user);
    $('#monetizationPayoutName').value = '';
    $('#monetizationNote').value = '';
    showNotice('Monetization application submitted.');
    await loadMonetization();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function loadProfile() {
  try {
    await refreshMe();
    await loadMyStories(false);
    const user = state.user || {};
    const works = state.stories || [];
    const publishedWorks = works.filter(story => story.status === 'published');
    const published = publishedWorks.length;
    const totalReads = works.reduce((sum, story) => sum + Number(story.views || 0), 0);
    $('#profileDisplayName') && ($('#profileDisplayName').textContent = user.name || 'InkTales User');
    $('#profileBioText') && ($('#profileBioText').textContent = user.bio || 'Dreamer, writer, creator.');
    $('#profileWorksCount') && ($('#profileWorksCount').textContent = published);
    $('#profileFollowersCount') && ($('#profileFollowersCount').textContent = Number(user.followers || Math.max(0, totalReads)).toLocaleString());
    $('#profileFollowingCount') && ($('#profileFollowingCount').textContent = Number(user.following || 0).toLocaleString());
    $('#verifiedAuthorBadge') && ($('#verifiedAuthorBadge').textContent = user.monetizationStatus === 'approved' ? '◆ Verified Author' : 'Regular Writer');
    $('#verifiedAuthorBadge') && ($('#verifiedAuthorBadge').className = `tag ${user.monetizationStatus === 'approved' ? 'approved' : 'pending'}`);
    $('#profileStatusBadge') && ($('#profileStatusBadge').textContent = user.status || 'active');
    $('#profileNameInput') && ($('#profileNameInput').value = user.name || '');
    $('#profileBioInput') && ($('#profileBioInput').value = user.bio || '');
    const list = $('#profileWorksList');
    if (list) {
      const displayWorks = (publishedWorks.length ? publishedWorks : works).slice(0, 5);
      list.innerHTML = displayWorks.length ? displayWorks.map(story => `
        <article class="exact-profile-work" onclick="openStoryMode('${story.id}', 'text')">
          ${storyCoverHtml(story)}
          <div><h3>${escapeHtml(story.title)}</h3><p>${escapeHtml(story.genre || 'Story')} • ${Number(story.views || 0).toLocaleString()} reads</p></div>
          <button class="exact-more" type="button">⋮</button>
        </article>`).join('') : '<p class="notice">No published works yet.</p>';
    }
  } catch (error) {
    showNotice(error.message, 'error');
  }
}


async function saveProfile() {
  try {
    const data = await api('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({
        name: $('#profileNameInput')?.value || '',
        bio: $('#profileBioInput')?.value || ''
      })
    });
    if (data.user) setUser(data.user);
    showNotice('Profile updated successfully.');
    await loadProfile();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function loadAdminOverview() {
  try {
    const data = await api('/api/admin/stats');
    const s = data.stats || {};
    $('#adminStats').innerHTML = [
      statCard('Users', s.users, '👥'),
      statCard('Active users', s.activeUsers, '✅'),
      statCard('Suspended users', s.suspendedUsers, '⛔'),
      statCard('Total stories', s.stories, '📚'),
      statCard('Published stories', s.publishedStories, '🚀'),
      statCard('Pending top ups', s.pendingTopUps, '🪙'),
      statCard('Pending withdrawals', s.pendingWithdrawals, '💸'),
      statCard('Pending monetization', s.pendingMonetization, '💎'),
      statCard('Open reports', s.openReports, '🚩'),
      statCard('User coin balance', s.totalUserCoins, '◈'),
      statCard('Creator earnings balance', s.totalCreatorEarnings, '◆'),
      statCard('Platform fees earned', s.platformFees, '🏦')
    ].join('');
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function loadAdminUsers() {
  try {
    const data = await api('/api/admin/users');
    $('#adminUsers').innerHTML = tableRows(data.users || [], [
      { label: 'Name', render: item => escapeHtml(item.name) },
      { label: 'Email', render: item => escapeHtml(item.email) },
      { label: 'Role', render: item => escapeHtml(item.role) },
      { label: 'Coins', render: item => Number(item.coins) },
      { label: 'Earnings', render: item => Number(item.earnings) },
      { label: 'Monetization', render: item => statusTag(item.monetizationStatus) },
      { label: 'Stories', render: item => Number(item.stats?.totalStories || 0) },
      { label: 'Status', render: item => statusTag(item.status) },
      { label: 'Action', render: item => item.role === 'admin' ? 'Protected' : `<button class="secondary-btn small-btn" onclick="toggleUserStatus('${item.id}', '${item.status === 'active' ? 'suspended' : 'active'}')">${item.status === 'active' ? 'Suspend' : 'Activate'}</button>` }
    ], 'No users.');
  } catch (error) { showNotice(error.message, 'error'); }
}

async function loadAdminTopups() {
  try {
    const data = await api('/api/admin/coin-requests');
    $('#adminCoinRequests').innerHTML = tableRows(data.requests || [], [
      { label: 'User', render: item => escapeHtml(item.user?.name || 'Unknown') },
      { label: 'Coins', render: item => Number(item.amount) },
      { label: 'Method', render: item => escapeHtml(item.method) },
      { label: 'Reference', render: item => escapeHtml(item.reference) },
      { label: 'Status', render: item => statusTag(item.status) },
      { label: 'Date', render: item => formatDate(item.createdAt) },
      { label: 'Action', render: item => item.status === 'pending' ? `<div class="flex"><button class="primary-btn small-btn" onclick="approveCoinRequest('${item.id}')">Approve</button><button class="danger-btn small-btn" onclick="rejectCoinRequest('${item.id}')">Reject</button></div>` : escapeHtml(item.adminNote || 'Resolved') }
    ], 'No top-up requests.');
  } catch (error) { showNotice(error.message, 'error'); }
}

async function loadAdminWithdrawals() {
  try {
    const data = await api('/api/admin/withdrawals');
    $('#adminWithdrawals').innerHTML = tableRows(data.withdrawals || [], [
      { label: 'User', render: item => escapeHtml(item.user?.name || 'Unknown') },
      { label: 'Earned Coins', render: item => Number(item.amount) },
      { label: 'Method', render: item => escapeHtml(item.method) },
      { label: 'Account', render: item => `${escapeHtml(item.accountName)}<br><small>${escapeHtml(item.accountNumber)}</small>` },
      { label: 'Status', render: item => statusTag(item.status) },
      { label: 'Date', render: item => formatDate(item.createdAt) },
      { label: 'Action', render: item => item.status === 'pending' ? `<div class="flex"><button class="primary-btn small-btn" onclick="approveWithdrawal('${item.id}')">Approve</button><button class="danger-btn small-btn" onclick="rejectWithdrawal('${item.id}')">Reject</button></div>` : escapeHtml(item.adminNote || 'Resolved') }
    ], 'No withdrawal requests.');
  } catch (error) { showNotice(error.message, 'error'); }
}

async function loadAdminStories() {
  try {
    const data = await api('/api/admin/stories');
    $('#adminStories').innerHTML = tableRows(data.stories || [], [
      { label: 'Title', render: item => `<strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.genre)}</small>` },
      { label: 'Author', render: item => escapeHtml(item.author?.name || 'Unknown') },
      { label: 'Price', render: item => Number(item.price) },
      { label: 'Status', render: item => statusTag(item.status) },
      { label: 'Engagement', render: item => `${Number(item.views)} views<br>${Number(item.likes)} likes<br>${Number(item.tips)} tips` },
      { label: 'Conversions', render: item => `Manga: ${item.conversions?.manga ? 'yes' : 'no'}<br>Comic: ${item.conversions?.comic ? 'yes' : 'no'}<br>Video: ${item.conversions?.animatedVideo ? 'yes' : 'no'}` },
      { label: 'Reports', render: item => Number(item.reports || 0) },
      { label: 'Action', render: item => `<div class="flex"><button class="secondary-btn small-btn" onclick="toggleFeaturedStory('${item.id}', ${!item.featured})">${item.featured ? 'Unfeature' : 'Feature'}</button>${item.status === 'published' ? `<button class="danger-btn small-btn" onclick="adminUnpublishStory('${item.id}')">Unpublish</button>` : ''}<button class="danger-btn small-btn" onclick="adminDeleteStory('${item.id}')">Delete</button></div>` }
    ], 'No stories.');
  } catch (error) { showNotice(error.message, 'error'); }
}

async function loadAdminMonetization() {
  try {
    const data = await api('/api/admin/monetization');
    $('#adminMonetizationApplications').innerHTML = tableRows(data.applications || [], [
      { label: 'User', render: item => escapeHtml(item.user?.name || 'Unknown') },
      { label: 'Payout Name', render: item => escapeHtml(item.payoutName) },
      { label: 'Snapshot', render: item => `${Number(item.snapshot?.publishedStories || 0)} stories<br>${Number(item.snapshot?.totalViews || 0)} views<br>${Number(item.snapshot?.totalLikes || 0)} likes` },
      { label: 'Status', render: item => statusTag(item.status) },
      { label: 'Note', render: item => escapeHtml(item.portfolioNote || item.adminNote || '—') },
      { label: 'Action', render: item => item.status === 'pending' ? `<div class="flex"><button class="primary-btn small-btn" onclick="approveMonetization('${item.id}')">Approve</button><button class="danger-btn small-btn" onclick="rejectMonetization('${item.id}')">Reject</button></div>` : escapeHtml(item.adminNote || 'Resolved') }
    ], 'No monetization applications.');
  } catch (error) { showNotice(error.message, 'error'); }
}

async function loadAdminReports() {
  try {
    const data = await api('/api/admin/reports');
    $('#adminReports').innerHTML = tableRows(data.reports || [], [
      { label: 'Story', render: item => escapeHtml(item.story?.title || 'Deleted story') },
      { label: 'Reporter', render: item => escapeHtml(item.reporter?.name || 'Unknown') },
      { label: 'Author', render: item => escapeHtml(item.author?.name || 'Unknown') },
      { label: 'Reason', render: item => `<strong>${escapeHtml(item.reason)}</strong><br><small>${escapeHtml(item.details || '')}</small>` },
      { label: 'Status', render: item => statusTag(item.status) },
      { label: 'Date', render: item => formatDate(item.createdAt) },
      { label: 'Action', render: item => item.status === 'open' ? `<button class="primary-btn small-btn" onclick="resolveReport('${item.id}')">Resolve</button>` : escapeHtml(item.adminNote || 'Resolved') }
    ], 'No story reports.');
  } catch (error) { showNotice(error.message, 'error'); }
}

async function loadAdminTransactions() {
  try {
    const data = await api('/api/admin/transactions');
    $('#adminTransactions').innerHTML = tableRows(data.transactions || [], [
      { label: 'User', render: item => escapeHtml(item.user?.name || item.userId || 'Platform') },
      { label: 'Type', render: item => escapeHtml(item.type) },
      { label: 'Amount', render: item => Number(item.amount) },
      { label: 'Note', render: item => escapeHtml(item.note) },
      { label: 'Date', render: item => formatDate(item.createdAt) }
    ], 'No transactions.');
  } catch (error) { showNotice(error.message, 'error'); }
}

async function loadAllAdminSections() {
  await loadAdminOverview();
  await Promise.allSettled([loadAdminUsers(), loadAdminTopups(), loadAdminWithdrawals(), loadAdminStories(), loadAdminMonetization(), loadAdminReports(), loadAdminTransactions()]);
}

async function approveCoinRequest(id) {
  try { await api(`/api/admin/coin-requests/${id}/approve`, { method: 'POST', body: JSON.stringify({ adminNote: 'Verified and approved.' }) }); showNotice('Top-up approved.'); await loadAdminTopups(); await loadAdminOverview(); } catch (error) { showNotice(error.message, 'error'); }
}

async function rejectCoinRequest(id) {
  try { const reason = prompt('Reason for rejection:', 'Invalid or unverified payment reference.'); await api(`/api/admin/coin-requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ adminNote: reason || 'Rejected by admin.' }) }); showNotice('Top-up rejected.'); await loadAdminTopups(); await loadAdminOverview(); } catch (error) { showNotice(error.message, 'error'); }
}

async function approveWithdrawal(id) {
  try { await api(`/api/admin/withdrawals/${id}/approve`, { method: 'POST', body: JSON.stringify({ adminNote: 'Payout released.' }) }); showNotice('Withdrawal approved.'); await loadAdminWithdrawals(); await loadAdminOverview(); } catch (error) { showNotice(error.message, 'error'); }
}

async function rejectWithdrawal(id) {
  try { const reason = prompt('Reason for rejection:', 'Payout details need correction.'); await api(`/api/admin/withdrawals/${id}/reject`, { method: 'POST', body: JSON.stringify({ adminNote: reason || 'Rejected by admin.' }) }); showNotice('Withdrawal rejected and earnings refunded.'); await loadAdminWithdrawals(); await loadAdminOverview(); } catch (error) { showNotice(error.message, 'error'); }
}

async function approveMonetization(id) {
  try { await api(`/api/admin/monetization/${id}/approve`, { method: 'POST', body: JSON.stringify({ adminNote: 'Approved for story monetization.' }) }); showNotice('Monetization approved.'); await loadAdminMonetization(); await loadAdminUsers(); await loadAdminOverview(); } catch (error) { showNotice(error.message, 'error'); }
}

async function rejectMonetization(id) {
  try { const reason = prompt('Reason for rejection:', 'Please improve engagement and resubmit.'); await api(`/api/admin/monetization/${id}/reject`, { method: 'POST', body: JSON.stringify({ adminNote: reason || 'Rejected by admin.' }) }); showNotice('Monetization rejected.'); await loadAdminMonetization(); await loadAdminUsers(); await loadAdminOverview(); } catch (error) { showNotice(error.message, 'error'); }
}

async function toggleUserStatus(id, status) {
  try { await api(`/api/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); showNotice(`User ${status}.`); await loadAdminUsers(); await loadAdminOverview(); } catch (error) { showNotice(error.message, 'error'); }
}

async function toggleFeaturedStory(id, featured) {
  try { await api(`/api/admin/stories/${id}/featured`, { method: 'PATCH', body: JSON.stringify({ featured }) }); showNotice(featured ? 'Story featured.' : 'Story unfeatured.'); await loadAdminStories(); } catch (error) { showNotice(error.message, 'error'); }
}

async function adminUnpublishStory(id) {
  try { if (!confirm('Unpublish this story?')) return; await api(`/api/admin/stories/${id}/unpublish`, { method: 'POST' }); showNotice('Story unpublished by admin.'); await loadAdminStories(); await loadAdminOverview(); } catch (error) { showNotice(error.message, 'error'); }
}

async function adminDeleteStory(id) {
  try { if (!confirm('Delete this story permanently?')) return; await api(`/api/stories/${id}`, { method: 'DELETE' }); showNotice('Story deleted by admin.'); await loadAdminStories(); await loadAdminOverview(); } catch (error) { showNotice(error.message, 'error'); }
}

async function resolveReport(id) {
  try { const note = prompt('Resolution note:', 'Reviewed and resolved.'); await api(`/api/admin/reports/${id}/resolve`, { method: 'PATCH', body: JSON.stringify({ adminNote: note || 'Reviewed and resolved.' }) }); showNotice('Report resolved.'); await loadAdminReports(); await loadAdminOverview(); } catch (error) { showNotice(error.message, 'error'); }
}


function setupMobileInstall() {
  const installBtn = $('#installAppBtn');
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    });
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installBtn?.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installBtn?.classList.add('hidden');
    showNotice('InkTales is installed as a mobile app.');
  });
}

async function installMobileApp() {
  if (!deferredInstallPrompt) {
    showNotice('On mobile, open browser menu then choose Add to Home screen or Install app.', 'success');
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  $('#installAppBtn')?.classList.add('hidden');
}

function bindEvents() {
  $('#loginBtn').addEventListener('click', login);
  $('#registerBtn').addEventListener('click', register);
  $('#logoutBtn').addEventListener('click', logout);
  $('#installAppBtn')?.addEventListener('click', installMobileApp);
  $('#saveStoryBtn').addEventListener('click', saveStory);
  $('#cancelEditBtn').addEventListener('click', clearStoryForm);
  $('#clearStoryBtn').addEventListener('click', clearStoryForm);
  $('#previewStoryBtn')?.addEventListener('click', previewDraft);
  $('#finishStoryBtn')?.addEventListener('click', markStoryFinished);
  $('#storyContent')?.addEventListener('input', updateWordCounter);
  $('#closeStoryModeBtn')?.addEventListener('click', closeStoryMode);
  $('#storyModeModal')?.addEventListener('click', event => { if (event.target.id === 'storyModeModal') closeStoryMode(); });
  $('#saveProfileBtn')?.addEventListener('click', saveProfile);
  $('#requestCoinsBtn').addEventListener('click', requestCoins);
  $('#requestWithdrawalBtn').addEventListener('click', requestWithdrawal);
  $('#applyMonetizationBtn').addEventListener('click', applyMonetization);
  $('#refreshMarketBtn').addEventListener('click', loadPublicStories);
  $('#refreshMonetizationBtn').addEventListener('click', loadMonetization);
  $('#refreshAdminBtn').addEventListener('click', loadAllAdminSections);
  $$('.side-menu button[data-tab]').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
  $$('[data-open-tab]').forEach(button => button.addEventListener('click', () => setTab(button.dataset.openTab)));
}

async function init() {
  setupMobileInstall();
  bindEvents();
  try {
    const data = await api('/api/me');
    setUser(data.user);
    if (data.user) setTab(data.user.role === 'admin' ? 'admin' : 'reader');
  } catch {
    setUser(null);
  }
}

window.convertStory = convertStory;
window.publishStory = publishStory;
window.unpublishStory = unpublishStory;
window.editStory = editStory;
window.deleteStory = deleteStory;
window.unlockStory = unlockStory;
window.tipStory = tipStory;
window.likeStory = likeStory;
window.reportStory = reportStory;
window.openStoryDetails = openStoryDetails;
window.openStoryMode = openStoryMode;
window.closeStoryMode = closeStoryMode;
window.toggleStoryFullscreen = toggleStoryFullscreen;
window.approveCoinRequest = approveCoinRequest;
window.rejectCoinRequest = rejectCoinRequest;
window.approveWithdrawal = approveWithdrawal;
window.rejectWithdrawal = rejectWithdrawal;
window.approveMonetization = approveMonetization;
window.rejectMonetization = rejectMonetization;
window.toggleUserStatus = toggleUserStatus;
window.toggleFeaturedStory = toggleFeaturedStory;
window.adminUnpublishStory = adminUnpublishStory;
window.adminDeleteStory = adminDeleteStory;
window.resolveReport = resolveReport;

init();
