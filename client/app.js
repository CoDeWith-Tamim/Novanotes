/**
 * DevNotes v6 — Bug-Fixed Production Build
 * Fixed: preview scroll, autosave race condition,
 *        sw.js optional clean, mobile CSS in stylesheet,
 *        save guard on note switch
 */

// ═══════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════
const STORAGE_KEY = 'devnotes_v6';
const AUTOSAVE_MS = 1500;
const SEARCH_MS   = 150;
const WPM         = 200;
const COLOR_MAP   = {
  '':      'var(--bg5)',
  blue:    '#3b6fd4',
  green:   '#2d8a5e',
  amber:   '#b07d2a',
  red:     '#a03535',
  purple:  '#6b3fa0'
};

// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════
let notes         = [];
let activeId      = null;
let activeTag     = 'all';
let splitOpen     = true;
let splitPercent  = 50;
let autosaveTimer = null;
let searchTimer   = null;
let saveInFlight  = false;   // ✅ race condition guard
let deferredPWA   = null;
let editorColor   = '';
let editorPinned  = false;
let editorAttach  = null;

// ═══════════════════════════════════════
// DOM
// ═══════════════════════════════════════
const $ = id => document.getElementById(id);
const DOM = {
  notesContainer : $('notes-container'),
  emptyMsg       : $('empty-message'),
  titleInput     : $('note-title'),
  contentInput   : $('note-content'),
  searchInput    : $('search-input'),
  fileUpload     : $('file-upload'),
  fileName       : $('file-name'),
  countBadge     : $('note-count-badge'),
  statusEl       : $('editor-status'),
  wordCount      : $('word-count'),
  charCount      : $('char-count'),
  readTime       : $('read-time'),
  lastSaved      : $('last-saved'),
  tagSelect      : $('note-tag'),
  tagFilterList  : $('tag-filter-list'),
  previewContent : $('preview-content'),
  splitContainer : $('split-container'),
  writePane      : $('write-pane'),
  previewPane    : $('preview-pane'),
  divider        : $('pane-divider'),
  editorPanel    : $('editor-panel'),
  welcomeScreen  : $('welcome-screen'),
  colorDot       : $('color-dot'),
  colorDropdown  : $('color-dropdown'),
  installBtn     : $('install-btn'),
  splitBtn       : $('split-btn'),
  pinBtn         : $('pin-btn'),
  backBtn        : $('back-btn'),
  deleteBtn      : $('delete-btn'),
  exportBtn      : $('export-btn'),
};

// ═══════════════════════════════════════
// TOAST
// ═══════════════════════════════════════
(function() {
  const el = document.createElement('div');
  el.id = 'dn-toasts';
  el.style.cssText = 'position:fixed;bottom:22px;right:22px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
  document.body.appendChild(el);
})();

function toast(msg, type = 'info') {
  const c = { info:'#5b8af5', success:'#3ecf8e', error:'#f26b6b', warn:'#f5a623' };
  const accent = c[type] || c.info;
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `
    background:var(--bg3);border-left:3px solid ${accent};border:1px solid ${accent}44;
    color:var(--text);font-family:var(--mono);font-size:12px;padding:9px 16px;
    border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.5);
    opacity:0;transform:translateY(8px);transition:opacity 0.2s,transform 0.2s;
  `;
  $('dn-toasts').appendChild(el);
  requestAnimationFrame(() => { el.style.opacity='1'; el.style.transform='translateY(0)'; });
  setTimeout(() => {
    el.style.opacity='0'; el.style.transform='translateY(8px)';
    setTimeout(() => el.remove(), 220);
  }, 2400);
}

// ═══════════════════════════════════════
// STORAGE  (requestIdleCallback)
// ═══════════════════════════════════════
// ✅ ১০০% ক্র্যাশ-প্রুফ গ্লোবাল মেকানিজম
const idle = (fn) => setTimeout(fn, 50);

function persist() {
  idle(() => {
    try { 
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); 
    } 
    catch { 
      toast('Storage full — export a backup!', 'error'); 
    }
  });
}
function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { notes = JSON.parse(raw).map(normalizeNote); return; }
    for (const k of ['devnotes_v5','devnotes_v4','devnotes_v3','devnotes_v2']) {
      const leg = localStorage.getItem(k);
      if (leg) {
        const parsed = JSON.parse(leg);
        notes = (Array.isArray(parsed) ? parsed : parsed.notes || []).map(normalizeNote);
        persist();
        return;
      }
    }
  } catch { notes = []; }
  notes = [];
}

function normalizeNote(r) {
  return {
    id:         String(r?.id         ?? Date.now()),
    title:      String(r?.title      ?? ''),
    content:    String(r?.content    ?? ''),
    tag:        String(r?.tag        ?? ''),
    color:      String(r?.color      ?? ''),
    pinned:     Boolean(r?.pinned    ?? false),
    created:    Number(r?.created    ?? r?.createdAt  ?? Date.now()),
    updated:    Number(r?.updated    ?? r?.updatedAt  ?? Date.now()),
    attachment: r?.attachment
      ? { name: String(r.attachment.name??''), type: String(r.attachment.type??''), size: Number(r.attachment.size??0) }
      : null
  };
}

// ═══════════════════════════════════════
// MARKED SETUP
// ═══════════════════════════════════════
function setupMarked() {
  if (!window.marked) return;
  marked.setOptions({
    gfm: true, breaks: true,
    highlight(code, lang) {
      if (!window.hljs) return code;
      const l = hljs.getLanguage(lang) ? lang : null;
      return l ? hljs.highlight(code, { language: l }).value : hljs.highlightAuto(code).value;
    }
  });
}

function renderMarkdown(raw) {
  if (!raw.trim()) return '<p style="color:var(--text3);font-size:13px;padding:2px 0">Nothing to preview yet…</p>';
  try {
    const html = window.marked ? marked.parse(raw) : fallbackMd(raw);
    return window.DOMPurify ? DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) : html;
  } catch { return fallbackMd(raw); }
}

function fallbackMd(md) {
  // escHtml first, then safe transforms
  return escHtml(md)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,    '<em>$1</em>')
    .replace(/`(.+?)`/g,      '<code>$1</code>')
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- \[(x|X)\] (.+)$/gm, '<li><input type="checkbox" checked disabled> $2</li>')
    .replace(/^- \[ \] (.+)$/gm,     '<li><input type="checkbox" disabled> $1</li>')
    .replace(/^- (.+)$/gm,    '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\n/g, '<br>');
}

function applySyntaxHighlight() {
  if (!window.hljs) return;
  DOM.previewContent.querySelectorAll('pre code').forEach(el => {
    try { hljs.highlightElement(el); } catch { /* ignore */ }
  });
}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  loadStorage();
  setupMarked();
  fixPreviewScroll();        // ✅ Fix applied once at init
  renderTagFilters();
  renderSidebar();
  setupResizableDivider();
  setupColorPicker();
  setupKeyboardShortcuts();
  setupPWA();
  setupOutsideClickDismiss();
  setupMobileSidebar();
  setupTheme();
  injectBackupButtons();

  if (notes.length) loadNote(getSortedNotes(notes)[0].id);
  else showWelcome();
});

// ═══════════════════════════════════════
// ✅ PREVIEW SCROLL FIX — done once at init
//    Wraps preview-content in a scrollable div
// ═══════════════════════════════════════
function fixPreviewScroll() {
  const pane    = DOM.previewPane;
  const content = DOM.previewContent;
  if (!pane || !content) return;

  // Only wrap if not already wrapped
  if (content.parentElement?.classList.contains('preview-scroll')) return;

  const label = pane.querySelector('.pane-label');

  const wrapper = document.createElement('div');
  wrapper.className = 'preview-scroll';
  wrapper.style.cssText = 'flex:1;overflow-y:auto;padding:18px 24px;scrollbar-width:thin;scrollbar-color:var(--bg5) transparent;';

  // Move content into wrapper, append wrapper to pane
  pane.appendChild(wrapper);
  wrapper.appendChild(content);
}

// ═══════════════════════════════════════
// JSON BACKUP
// ═══════════════════════════════════════
function exportBackup() {
  const data = JSON.stringify({ version: 6, exported: new Date().toISOString(), notes }, null, 2);
  triggerDownload(data, `devnotes-backup-${new Date().toISOString().slice(0,10)}.json`, 'application/json');
  toast('Backup exported ✓', 'success');
}
window.exportBackup = exportBackup;

function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const raw    = JSON.parse(e.target.result);
      const list   = Array.isArray(raw) ? raw : (raw.notes || []);
      if (!list.length) { toast('No notes found in file', 'warn'); return; }
      const valid      = list.map(normalizeNote);
      const existingIds = new Set(notes.map(n => n.id));
      const incoming   = valid.filter(n => !existingIds.has(n.id));
      notes = [...notes, ...incoming];
      persist();
      renderSidebar();
      renderTagFilters();
      toast(`Imported ${incoming.length} note${incoming.length!==1?'s':''} ✓`, 'success');
    } catch { toast('Invalid backup file', 'error'); }
  };
  reader.readAsText(file);
}

function injectBackupButtons() {
  const body = document.querySelector('#export-modal .modal-body');
  if (!body) return;

  const hr = document.createElement('hr');
  hr.style.cssText = 'border:none;border-top:1px solid var(--line);margin:4px 0';
  body.appendChild(hr);

  // Export all
  const expBtn = document.createElement('button');
  expBtn.className = 'export-opt';
  expBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export All Notes (.json backup)`;
  expBtn.onclick = () => { exportBackup(); closeModal('export-modal'); };
  body.appendChild(expBtn);

  // Import
  const impLabel = document.createElement('label');
  impLabel.className = 'export-opt';
  impLabel.style.cursor = 'pointer';
  impLabel.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Import Notes (.json backup)`;
  const impInput = document.createElement('input');
  impInput.type = 'file'; impInput.accept = '.json'; impInput.style.display = 'none';
  impInput.addEventListener('change', () => { importBackup(impInput.files[0]); closeModal('export-modal'); impInput.value = ''; });
  impLabel.appendChild(impInput);
  body.appendChild(impLabel);
}

// ═══════════════════════════════════════
// NOTE CRUD
// ═══════════════════════════════════════
function startNewNote() {
  flushAutosave();   // ✅ save pending work before clearing
  activeId = null; editorColor = ''; editorPinned = false; editorAttach = null;
  DOM.titleInput.value = ''; DOM.contentInput.value = '';
  DOM.tagSelect.value = ''; DOM.fileName.textContent = '';
  DOM.lastSaved.textContent = 'Never saved';
  setStatus('Unsaved', false);
  setColorDot(''); setPinUI(false);
  refreshCounts(); refreshPreview();
  showEditor(); deselectCards();
  DOM.titleInput.focus();
}

// ✅ Race condition fix: flush pending save immediately
function flushAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    saveNote(true);
  }
}

function saveNote(silent = true) {
  if (saveInFlight) return null;   // ✅ prevent concurrent saves
  const title   = DOM.titleInput.value.trim();
  const content = DOM.contentInput.value;
  const tag     = DOM.tagSelect.value;
  const now     = Date.now();

  if (!title && !content.trim()) {
    if (!silent) setStatus('Nothing to save', false);
    return null;
  }

  saveInFlight = true;

  const resolvedTitle = title ||
    content.trim().split('\n')[0].replace(/[#*`]/g,'').trim().slice(0,60) ||
    'Untitled';

  if (activeId) {
    const idx = notes.findIndex(n => n.id === activeId);
    if (idx !== -1) {
      notes[idx] = { ...notes[idx], title: resolvedTitle, content, tag,
        color: editorColor, pinned: editorPinned, attachment: editorAttach, updated: now };
    }
  } else {
    const note = { id: String(now), title: resolvedTitle, content, tag,
      color: editorColor, pinned: editorPinned, attachment: editorAttach, created: now, updated: now };
    notes.unshift(note);
    activeId = note.id;
  }

  persist();
  saveInFlight = false;   // ✅ release lock

  renderSidebar();
  renderTagFilters();
  setStatus('Auto Saved ✓', true);
  DOM.lastSaved.textContent = 'Saved ' + fmtTime(now);
  return activeId;
}

function deleteActiveNote() {
  if (!activeId) return;
  clearTimeout(autosaveTimer);   // ✅ cancel pending save before delete
  notes = notes.filter(n => n.id !== activeId);
  persist();
  activeId = null;
  renderSidebar(); renderTagFilters();
  closeModal('delete-modal');
  const remaining = getSortedNotes(notes);
  if (remaining.length) loadNote(remaining[0].id);
  else showWelcome();
  toast('Note deleted', 'warn');
}
window.confirmDelete = deleteActiveNote;

function loadNote(id) {
  flushAutosave();   // ✅ save current note before switching
  const note = notes.find(n => n.id === id);
  if (!note) return;
  activeId      = note.id;
  editorColor   = note.color  || '';
  editorPinned  = note.pinned || false;
  editorAttach  = note.attachment ? { ...note.attachment } : null;

  DOM.titleInput.value   = note.title;
  DOM.contentInput.value = note.content;
  DOM.tagSelect.value    = note.tag || '';
  DOM.fileName.textContent = editorAttach ? '📎 ' + editorAttach.name : '';

  setColorDot(editorColor);
  setPinUI(editorPinned);
  setStatus('Saved', true);
  DOM.lastSaved.textContent = 'Saved ' + fmtTime(note.updated);
  refreshCounts();
  refreshPreview();
  showEditor();
  renderSidebar();
}
window.loadNote = loadNote;

// ═══════════════════════════════════════
// AUTO-SAVE
// ═══════════════════════════════════════
function onEditorInput() {
  setStatus('Saving…', 'saving');
  refreshCounts();
  refreshPreview();
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { autosaveTimer = null; saveNote(true); }, AUTOSAVE_MS);
}

DOM.titleInput.addEventListener('input', onEditorInput);
DOM.contentInput.addEventListener('input', onEditorInput);
DOM.tagSelect.addEventListener('change', onEditorInput);

// ═══════════════════════════════════════
// SIDEBAR — debounced search
// ═══════════════════════════════════════
DOM.searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderSidebar, SEARCH_MS);
});

function getSortedNotes(list) {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.updated||0) - (a.updated||0);
  });
}

function renderSidebar() {
  const q = DOM.searchInput.value.trim().toLowerCase();
  const filtered = getSortedNotes(notes).filter(n => {
    const ms = !q || n.title.toLowerCase().includes(q) ||
               n.content.toLowerCase().includes(q) || (n.tag||'').toLowerCase().includes(q);
    const mt = activeTag === 'all' || n.tag === activeTag;
    return ms && mt;
  });

  DOM.notesContainer.querySelectorAll('.note-card').forEach(c => c.remove());

  if (!filtered.length) {
    DOM.emptyMsg.style.display = 'flex';
    const p = DOM.emptyMsg.querySelector('p'), s = DOM.emptyMsg.querySelector('span');
    if (p) p.textContent = notes.length ? 'No matching notes' : 'No notes yet';
    if (s) s.textContent = notes.length ? 'Try another search' : 'Click "New" to start';
  } else {
    DOM.emptyMsg.style.display = 'none';
  }

  filtered.forEach(note => {
    const card = document.createElement('div');
    card.className = 'note-card' +
      (note.id === activeId ? ' active-note' : '') +
      (note.pinned ? ' pinned' : '');
    if (note.color) card.dataset.color = note.color;

    const preview = (note.content||'').replace(/[#*`>\-_~\[\]!]/g,'').trim()
      .slice(0,58) + ((note.content?.length||0) > 58 ? '…' : '');

    card.innerHTML = `
      <div class="note-card-top">
        <svg class="note-pin-icon" width="10" height="10" viewBox="0 0 24 24" fill="var(--amber)" stroke="none">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
        <span class="note-card-title">${escHtml(note.title||'Untitled')}</span>
        ${note.tag ? `<span class="note-tag-badge">${escHtml(note.tag)}</span>` : ''}
      </div>
      <div class="note-card-preview">${escHtml(preview||'No content')}</div>
    `;
    card.addEventListener("click", () => {

    loadNote(note.id);

    if (window.innerWidth <= 860) {

        document
            .querySelector(".sidebar")
            ?.classList.remove("mobile-open");

        document
            .querySelector(".dn-overlay")
            ?.classList.remove("on");

    }

});
    DOM.notesContainer.appendChild(card);
  });

  DOM.countBadge.textContent = String(notes.length);
}

function renderTagFilters() {
  const tags = ['all', ...[...new Set(notes.map(n=>n.tag).filter(Boolean))].sort()];
  DOM.tagFilterList.innerHTML = '';
  tags.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'tag-pill' + (tag === activeTag ? ' active' : '');
    btn.textContent = tag === 'all' ? 'All' : tag;
    btn.addEventListener('click', () => {
      activeTag = tag;
      DOM.tagFilterList.querySelectorAll('.tag-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      renderSidebar();
    });
    DOM.tagFilterList.appendChild(btn);
  });
}

// ═══════════════════════════════════════
// PREVIEW
// ═══════════════════════════════════════
function refreshPreview() {
  DOM.previewContent.innerHTML = renderMarkdown(DOM.contentInput.value);
  applySyntaxHighlight();
}

// ═══════════════════════════════════════
// COUNTS
// ═══════════════════════════════════════
function refreshCounts() {
  const t = DOM.contentInput.value || '';
  const w = t.trim() ? t.trim().split(/\s+/).filter(Boolean).length : 0;
  const m = w ? Math.max(1, Math.ceil(w / WPM)) : 0;
  DOM.wordCount.textContent = w + ' word' + (w!==1?'s':'');
  DOM.charCount.textContent = t.length + ' chars';
  DOM.readTime.textContent  = m + ' min read';
}

// ═══════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════
function showEditor() {
  DOM.welcomeScreen.classList.add('hidden');
  DOM.editorPanel.classList.remove('hidden');
}
function showWelcome() {
  clearTimeout(autosaveTimer);
  DOM.editorPanel.classList.add('hidden');
  DOM.welcomeScreen.classList.remove('hidden');
  deselectCards(); activeId = null;
}
function deselectCards() {
  DOM.notesContainer.querySelectorAll('.note-card').forEach(c => c.classList.remove('active-note'));
}
function setStatus(text, state) {
  DOM.statusEl.textContent = text;
  DOM.statusEl.className = 'editor-status' +
    (state === true ? ' saved' : state === 'saving' ? ' saving' : '');
}
function setColorDot(c) { DOM.colorDot.style.background = COLOR_MAP[c] || COLOR_MAP['']; }
function setPinUI(p)     { DOM.pinBtn.classList.toggle('pinned', p); }
function fmtTime(ts)     { return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
function escHtml(s)      { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function triggerDownload(data, filename, mime) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click(); URL.revokeObjectURL(url);
}
function openModal(id)  { const m=$(id); if(m) m.classList.remove('hidden'); }
function closeModal(id) { const m=$(id); if(m) m.classList.add('hidden'); }
window.closeModal = closeModal;

// ═══════════════════════════════════════
// BUTTON LISTENERS
// ═══════════════════════════════════════
$('new-note-btn').addEventListener('click', () => { startNewNote(); closeMobileSidebar(); });
$('welcome-new-btn').addEventListener('click', startNewNote);
DOM.backBtn.addEventListener('click', () => { flushAutosave(); showWelcome(); closeMobileSidebar(); });
DOM.deleteBtn.addEventListener('click', () => { if(activeId) { openModal('delete-modal'); closeMobileSidebar(); } });
DOM.exportBtn.addEventListener('click', () => { openModal('export-modal'); closeMobileSidebar(); });
DOM.pinBtn.addEventListener('click', () => {
  editorPinned = !editorPinned;
  setPinUI(editorPinned);
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { autosaveTimer=null; saveNote(true); }, AUTOSAVE_MS);
  toast(editorPinned ? 'Note pinned 📌' : 'Note unpinned', 'info');
  closeMobileSidebar();
});

DOM.splitBtn.addEventListener('click', () => {
  splitOpen = !splitOpen;
  if (splitOpen) {
    DOM.previewPane.classList.remove('hidden');
    DOM.divider.classList.remove('hidden');
    DOM.splitBtn.classList.add('active');
    DOM.writePane.style.flex  = 'none';
    DOM.writePane.style.width = splitPercent + '%';
    refreshPreview();
  } else {
    const r = DOM.splitContainer.getBoundingClientRect();
    const w = DOM.writePane.getBoundingClientRect();
    splitPercent = r.width ? (w.width / r.width) * 100 : 50;
    DOM.previewPane.classList.add('hidden');
    DOM.divider.classList.add('hidden');
    DOM.splitBtn.classList.remove('active');
    DOM.writePane.style.flex  = '1';
    DOM.writePane.style.width = '100%';
  }
});

DOM.fileUpload.addEventListener('change', () => {
  const f = DOM.fileUpload.files[0];
  if (!f) return;
  // Note: browsers cannot persist actual file bytes in localStorage (security restriction)
  // We store metadata only; name shows in UI and is saved with note
  editorAttach = { name: f.name, type: f.type||'', size: f.size||0 };
  DOM.fileName.textContent = '📎 ' + f.name;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { autosaveTimer=null; saveNote(true); }, AUTOSAVE_MS);
  toast('File attached: ' + f.name, 'info');
});

// ═══════════════════════════════════════
// EXPORT NOTE  (.md or .txt only — honest)
// ═══════════════════════════════════════
function exportAs(fmt) {
  const title   = (DOM.titleInput.value.trim()||'note').replace(/[^a-z0-9]/gi,'_');
  const content = DOM.contentInput.value;
  triggerDownload(content, title + '.' + fmt, 'text/plain;charset=utf-8');
  closeModal('export-modal');
  toast('Exported as .' + fmt + ' ✓', 'success');
}
window.exportAs = exportAs;

// ═══════════════════════════════════════
// COLOR PICKER
// ═══════════════════════════════════════
function setupColorPicker() {
  DOM.colorDot.addEventListener('click', e => {
    e.stopPropagation();
    DOM.colorDropdown.classList.toggle('hidden');
  });
  document.querySelectorAll('.cdot').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      editorColor = btn.dataset.color || '';
      setColorDot(editorColor);
      DOM.colorDropdown.classList.add('hidden');
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => { autosaveTimer=null; saveNote(true); }, AUTOSAVE_MS);
    });
  });
}
function setupOutsideClickDismiss() {
  document.addEventListener('click', e => {
    if (!DOM.colorDropdown.contains(e.target) && e.target !== DOM.colorDot)
      DOM.colorDropdown.classList.add('hidden');
  });
}

// ═══════════════════════════════════════
// RESIZABLE DIVIDER
// ═══════════════════════════════════════
function setupResizableDivider() {
  DOM.divider.addEventListener('mousedown', e => {
    e.preventDefault();
    DOM.divider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const rect = DOM.splitContainer.getBoundingClientRect();
    const onMove = ev => {
      const pct = Math.max(25, Math.min(75, ((ev.clientX - rect.left) / rect.width) * 100));
      splitPercent = pct;
      DOM.writePane.style.flex  = 'none';
      DOM.writePane.style.width = pct + '%';
    };
    const onUp = () => {
      DOM.divider.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ═══════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key==='s')  { e.preventDefault(); flushAutosave(); saveNote(false); toast('Saved ✓','success'); }
    if (mod && e.key==='n')  { e.preventDefault(); startNewNote(); }
    if (mod && e.key==='k')  { e.preventDefault(); DOM.searchInput.focus(); }
    if (mod && e.key==='\\') { e.preventDefault(); DOM.splitBtn.click(); }
    if (e.key==='Escape') {
      DOM.colorDropdown.classList.add('hidden');
      ['export-modal','delete-modal'].forEach(closeModal);
    }
  });
}

// ═══════════════════════════════════════
// MOBILE SIDEBAR
// ═══════════════════════════════════════
function setupMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  // ✅ CSS injected once only, minimal
  if (!$('dn-mobile-css')) {
    const style = document.createElement('style');
    style.id = 'dn-mobile-css';
    style.textContent = `
      @media(max-width:860px){
        .sidebar{position:fixed;left:-270px;top:0;height:100vh;z-index:200;transition:left .25s;box-shadow:4px 0 24px rgba(0,0,0,.5)}
        .sidebar.mobile-open{left:0}
        #dn-mobile-btn{display:flex!important}
        .dn-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:199;display:none}
        .dn-overlay.on{display:block}
      }
    `;
    document.head.appendChild(style);
  }

  const btn = document.createElement('button');
  btn.id = 'dn-mobile-btn';
  btn.style.cssText = 'display:none;position:fixed;top:12px;left:12px;z-index:201;width:34px;height:34px;background:var(--bg2);border:1px solid var(--line2);border-radius:8px;color:var(--text2);align-items:center;justify-content:center;cursor:pointer;font-size:16px';
  btn.textContent = '☰';
  document.body.appendChild(btn);

  const overlay = document.createElement('div');
  overlay.className = 'dn-overlay';
  document.body.appendChild(overlay);

  const toggle = () => { sidebar.classList.toggle('mobile-open'); overlay.classList.toggle('on'); };
  btn.addEventListener('click', toggle);
  overlay.addEventListener('click', toggle);
}

// ═══════════════════════════════════════
// PWA  (sw.js optional — no 404 crash)
// ═══════════════════════════════════════
function setupPWA() {
  if (DOM.installBtn) DOM.installBtn.classList.add('hidden');
  if ('serviceWorker' in navigator) {
    // Only register if sw.js actually exists (HEAD check)
    fetch('./sw.js', { method: 'HEAD' })
      .then(r => { if (r.ok) navigator.serviceWorker.register('./sw.js'); })
      .catch(() => { /* sw.js not present — offline mode unavailable */ });
  }
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredPWA = e;
  if (DOM.installBtn) DOM.installBtn.classList.remove('hidden');
});
DOM.installBtn?.addEventListener('click', async () => {
  if (!deferredPWA) return;
  deferredPWA.prompt();
  const { outcome } = await deferredPWA.userChoice;
  deferredPWA = null;
  DOM.installBtn.classList.add('hidden');
  if (outcome === 'accepted') toast('App installed 🎉', 'success');
});
window.addEventListener('appinstalled', () => {
  deferredPWA = null;
  if (DOM.installBtn) DOM.installBtn.classList.add('hidden');
});

// ═══════════════════════════════════════
// GLOBAL ERROR GUARD
// ═══════════════════════════════════════
window.addEventListener('error', e => {
  console.error('[DevNotes v6]', e.message);
  toast('Unexpected error — check console', 'error');
});

// ════════════════════════════════════════════════════════════
// THEME TOGGLE — Ultimate Perfected Code
// ════════════════════════════════════════════════════════════

const THEME_KEY = 'devnotes_theme';

const MOON_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
</svg>`;

const SUN_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
  <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
</svg>`;

function setupTheme() {
  // ১. ডুপ্লিকেট বাটন তৈরি হওয়া থেকে বাঁচার গার্ড (ChatGPT Fix)
  if (document.getElementById('theme-toggle-btn')) return;

  // ২. থিম ডিটেকশন ও লোকালস্টোরেজ ফলব্যাক
  const savedTheme = localStorage.getItem(THEME_KEY);
  let themeToApply = 'dark';

  if (savedTheme) {
    themeToApply = savedTheme;
  } else {
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    themeToApply = prefersLight ? 'light' : 'dark';
  }
  
  applyTheme(themeToApply);

  // ৩. সাইডবারে বাটন ইনজেকশন
  const actions = document.querySelector('.sidebar-top-actions');
  if (!actions) return;

  const btn = document.createElement('button');
  btn.id = 'theme-toggle-btn';
  btn.className = 'theme-toggle-btn';
  btn.title = 'Toggle theme';
  
  // ডার্ক মোডে সান আইকন এবং লাইট মোডে মুন আইকন দেখাবে (ChatGPT UX Fix)
  btn.innerHTML = themeToApply === 'dark' ? SUN_ICON : MOON_ICON;

  actions.insertBefore(btn, actions.firstChild);

  // ৪. ক্লিক ইভেন্ট লিসেনার
  btn.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
    btn.innerHTML = next === 'dark' ? SUN_ICON : MOON_ICON;
    toast(next === 'light' ? '☀️ Light mode' : '🌙 Dark mode', 'info');
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;

  // highlight.js সেফ থিম সুইচার
  const hlLink = document.querySelector('link[href*="highlight"]') || document.getElementById('hl-theme');
  if (hlLink) {
    if (theme === 'light') {
      hlLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
    } else {
      hlLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css';
    }
  }

  // মেটা থিম কালার আপডেট
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f5f6fa' : '#0b0d12';
}

// ═══════════════════════════════════════
// DEV_AI ENGINE (SPRINT 3 - PRODUCTION READY)
// ═══════════════════════════════════════

// ডাইনামিক ইউআরএল সেটিং (লোকাল ও ভিপিএস ডেপ্লয়মেন্ট ফ্রেন্ডলি)
const BACKEND_URL = "https://novanotes-j6ku.onrender.com/api/ai";
// ডাবল রিকোয়েস্ট প্রোটেকশন লক (Race Condition Guard)
let isDevAIBusy = false;

// ======================================
// NOVA AI MODE CONTROLLER
// ======================================

let currentAIMode = "general";


// Variant Button Control

document.querySelectorAll(".ai-variant-btn")
.forEach(btn => {

    btn.addEventListener("click",()=>{

        document
        .querySelectorAll(".ai-variant-btn")
        .forEach(b=>b.classList.remove("active"));


        btn.classList.add("active");


        currentAIMode =
        btn.dataset.variant;


        console.log(
        "NovaAI Mode:",
        currentAIMode
        );

    });

});
// লোকালস্টোরেজ থেকে সেফলি ফ্রেশ নোট স্ন্যাপশট নেওয়া (RAG Layer 1)
function getCurrentNotes() {
  try {
    const rawNotes = localStorage.getItem(STORAGE_KEY);
    return rawNotes ? JSON.parse(rawNotes) : [];
  } catch (e) {
    console.error("Failed to parse notes from localStorage:", e);
    return [];
  }
}

// UI প্যানেল টগল লজিক
$('toggle-ai-float').addEventListener('click', () => {
  const panel = $('ai-chat-panel');
  panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
  if (panel.style.display === 'flex') {
    $('ai-user-input').focus(); // প্যানেল খুললেই ইনপুটে অটো ফোকাস
  }
});

$('close-ai-btn').addEventListener('click', () => {
  $('ai-chat-panel').style.display = 'none';
});

// মেসেজ রেন্ডারার হেল্পার
function appendAIMessage(sender, text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `ai-msg ${sender}`;
  if (sender === 'assistant') {
    msgDiv.innerHTML = DOMPurify.sanitize(marked.parse(text));
  } else {
    msgDiv.innerText = text;
  }
  $('ai-messages').appendChild(msgDiv);
  $('ai-messages').scrollTop = $('ai-messages').scrollHeight;
}

// নির্দিষ্ট আইডি ভিত্তিক নিরাপদ লোডিং ইন্ডিকেটর
function showAILoading() {
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'devai-loading';
  loadingDiv.className = 'ai-msg loading';
  loadingDiv.innerText = 'DevAI ভাবছে... ⚡';
  $('ai-messages').appendChild(loadingDiv);
  $('ai-messages').scrollTop = $('ai-messages').scrollHeight;
}

function removeAILoading() {
  const loadingElement = document.getElementById('devai-loading');
  if (loadingElement) {
    loadingElement.remove();
  }
}

// মেইন এপিআই সাবমিট ও স্মার্ট রাউটিং হ্যান্ডলার
async function handleAISubmit() {
  // যদি অলরেডি একটা রিকোয়েস্ট প্রসেস হতে থাকে, নতুন ক্লিক ব্লক হবে
  if (isDevAIBusy) return;

  const queryText = $('ai-user-input').value.trim();
  if (!queryText) return;

  // স্ক্রিনে ইউজারের টেক্সট পুশ এবং ইনপুট ফিল্ড খালি করা
  appendAIMessage('user', queryText);
  $('ai-user-input').value = ''; 
  
  // স্টেট লক করা
  isDevAIBusy = true;
  showAILoading();

  try {
    let endpoint = '/chat';
    let requestBody = { message: queryText, mode: currentAiMode, notes: getCurrentNotes() };

// যদি file attached থাকে, সেটা request এ যুক্ত করো
if (attachedFileContent) {
  requestBody.file = {
    name: attachedFileName,
    content: attachedFileContent
  };
}

    // কন্টেন্ট ডিটেকশন ফর আরএজি (Smart RAG Routing)
    // file attached থাকলে সবসময় /chat এ যাবে, /find এ যাবে না
    const lowerQuery = queryText.toLowerCase();
    if (!attachedFileContent && (lowerQuery.includes('খুঁজে') || lowerQuery.includes('কোথায়') || lowerQuery.includes('find') || lowerQuery.includes('নোট') || lowerQuery.includes('আছে'))) {
      endpoint = '/find';
      requestBody = { query: queryText, notes: getCurrentNotes() };
    }

    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    removeAILoading();

    if (data.success) {
      appendAIMessage('assistant', data.reply);
    } else {
      appendAIMessage('assistant', '⚠️ NovaAI: Something went wrong. Try again.');
    }

  } catch (error) {
    console.error("DevAI Production Error:", error);
    removeAILoading();
    appendAIMessage('assistant', '❌ সার্ভার কানেকশন এরর! ব্যাকএন্ড রান করা আছে তো?');
  } finally {
    // কাজ শেষ হলে লক আনলক করা, যেন ইউজার পরে আবার মেসেজ দিতে পারে
    isDevAIBusy = false;
    // file attachment reset করা — পরের message এ পুরনো file না যায়
    attachedFileContent = null;
    attachedFileName = null;
  }
}

// ==========================================
// NovaAI Variant Controller
// ==========================================

let currentAiMode = "general";

document.querySelectorAll('.ai-variant-btn')
.forEach(btn => {

  btn.addEventListener('click', () => {

    // active remove
    document.querySelectorAll('.ai-variant-btn')
    .forEach(b => b.classList.remove('active'));

    // clicked active
    btn.classList.add('active');

    // mode update
    currentAiMode = btn.dataset.variant;

    console.log("NovaAI Mode:", currentAiMode);

  });

});
// ইভেন্ট বাইন্ডিং
$('send-ai-btn').addEventListener('click', handleAISubmit);

// মর্ডার্ন ব্রাউজার ফ্রেন্ডলি keydown ইভেন্ট লিসেনার
$('ai-user-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault(); 
    handleAISubmit();
  }
});

// ==========================================
// NovaNotes Advanced Multi-Feature Dropdown
// ==========================================
let attachedFileContent = null;
let attachedFileName = null;
let pendingFileAction = null;

const plusBtn = document.getElementById('ai-plus-btn');
const actionMenu = document.getElementById('ai-action-menu');
const fileUpload = document.getElementById('ai-file-upload');
const chatInput = document.getElementById('ai-user-input');
const chatMessagesContainer = document.querySelector('.ai-messages-container');

// ১. প্লাস বাটনে ক্লিক করলে মেনু টগল (Toggle) হবে
if (plusBtn && actionMenu) {
    plusBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // মেনু খোলার সময় যেন ডকুমেন্টের ক্লিক ইভেন্ট ট্রিগার না হয়
        actionMenu.classList.toggle('hidden');
    });
}

// ২. স্ক্রিনের বাইরে কোথাও ক্লিক করলে মেনু স্বয়ংক্রিয়ভাবে বন্ধ হবে
document.addEventListener('click', () => {
    if (actionMenu) actionMenu.classList.add('hidden');
});

// ৩. প্রতিটি বাটনের জন্য ওয়ার্কিং প্লেসহোল্ডার ফাংশনালিটি
  const setupMenuItem = (id, text) => {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener('click', () => {
            if (id === 'menu-upload') {
                pendingFileAction = 'upload';
                fileUpload.click();
            } else if (id === 'menu-analyze') {
                pendingFileAction = 'analyze';
                fileUpload.click();
            } else if (id === 'menu-pdf') {
                pendingFileAction = 'pdf';
                fileUpload.click();
            } else if (id === 'menu-search') {
                const query = chatInput.value.trim();
                if (!query) {
                    chatInput.placeholder = "প্রথমে কী খুঁজছো লিখো...";
                    chatInput.focus();
                } else {
                    chatInput.value = `খুঁজে দাও: ${query}`;
                    handleAISubmit();
                }
            } else {
                chatInput.value = `[Running: ${text}] ` + chatInput.value;
                chatInput.focus();
            }
            actionMenu.classList.add('hidden');
        });
    }
}; 


// ৬টি অপশনকেই ড্রপডাউন ইভেন্টের সাথে কানেক্ট করা হলো
setupMenuItem('menu-upload', 'Upload File');
setupMenuItem('menu-analyze', 'Analyze Code');
setupMenuItem('menu-pdf', 'Summarize PDF');
setupMenuItem('menu-search', 'Search Notes');
setupMenuItem('menu-github', 'GitHub Agent');
setupMenuItem('menu-debug', 'Debug Mode');

// ৪. ফাইল ম্যানেজার থেকে ফাইল সিলেক্ট করার পর যা ঘটবে
if (fileUpload)
    fileUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // File type security check
    const allowed = ['js','py','json','txt','html','css','md','pdf'];
    const ext = file.name.split('.').pop().toLowerCase();
    if(!allowed.includes(ext)){
        alert("Unsupported file type");
        fileUpload.value = "";
        return;
    }

    // Size check — 2MB limit for PDF, 100KB for text files
    const maxSize = ext === 'pdf' ? 2 * 1024 * 1024 : 100 * 1024;
    if (file.size > maxSize) {
        alert(ext === 'pdf' ? "PDF too large. Max 2MB." : "File too large. Max 100KB.");
        fileUpload.value = "";
        return;
    }

    const showAttachmentNote = (name, sizeKB, extraText) => {
        if (chatMessagesContainer) {
            const attachmentNote = document.createElement('div');
            attachmentNote.className = 'ai-msg system-update';
            attachmentNote.style.cssText =
            "color:#38bdf8;font-size:13px;padding:5px 10px;font-style:italic;margin-top:5px;";
            attachmentNote.innerHTML =
            `📎 <b>${name}</b> attached (${sizeKB} KB). ${extraText}`;
            chatMessagesContainer.appendChild(attachmentNote);
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }
    };

    if (ext === 'pdf') {
        // PDF থেকে text extract করো
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const typedArray = new Uint8Array(event.target.result);
                const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;

                let fullText = '';
                const maxPages = Math.min(pdf.numPages, 20); // max 20 pages

                for (let i = 1; i <= maxPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n\n';
                }

                attachedFileContent = fullText.slice(0, 15000);
                attachedFileName = file.name;

                chatInput.value = `এই PDF টির একটি সংক্ষিপ্ত সারাংশ দাও — মূল পয়েন্টগুলো bullet point এ লিখো।`;
                chatInput.focus();

                showAttachmentNote(file.name, (file.size/1024).toFixed(1),
                    `Extracted ${maxPages} page(s) of text. Ready for summary.`);
            } catch (err) {
                console.error("PDF read error:", err);
                alert("PDF পড়তে সমস্যা হয়েছে। ফাইলটি কি scanned/image-based PDF?");
            }
            pendingFileAction = null;
        };
        reader.onerror = () => alert("Failed to read PDF");
        reader.readAsArrayBuffer(file);
    } else {
        // Text-based files
        const reader = new FileReader();
        reader.onload = (event) => {
            attachedFileContent = event.target.result;
            attachedFileName = file.name;

            if (pendingFileAction === 'analyze') {
                chatInput.value = `এই কোডটি Review করো:

1. Bugs/Issues খুঁজে বের করো
2. Architecture এবং code structure নিয়ে মতামত দাও
3. Improvement suggestions দাও
4. প্রয়োজন হলে fix করার জন্য concrete code suggestion দাও`;
            }

            chatInput.focus();
            showAttachmentNote(file.name, (file.size/1024).toFixed(1),
                pendingFileAction === 'analyze' ? 'Ready for code review — review prompt added.' : 'Type your question and send.');
            pendingFileAction = null;
        };
        reader.onerror = () => alert("Failed to read file");
        reader.readAsText(file);
    }

    fileUpload.value = "";
});
// ==========================================
// More Menu (⋮) Toggle
// ==========================================
const moreBtn = document.getElementById('more-btn');
const moreDropdown = document.getElementById('more-dropdown');
const printBtn = document.getElementById('print-btn');

if (moreBtn && moreDropdown) {
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moreDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    moreDropdown.classList.add('hidden');
  });

  moreDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

if (printBtn) {
  printBtn.addEventListener('click', () => {
    moreDropdown.classList.add('hidden');
    window.print();
  });
}
// ==========================================
// Mobile Sidebar Auto-Close
// ==========================================
function closeMobileSidebar() {
  if (window.innerWidth <= 860) {
    document.querySelector('.sidebar')?.classList.remove('mobile-open');
    document.querySelector('.dn-overlay')?.classList.remove('on');
  }
}
