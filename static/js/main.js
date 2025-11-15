// static/js/main.js
const API = window.location.origin + "/api";

let LANGS = [];
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  bindActions();
  loadLanguages();
  loadTranslations();
  initSSE();
});

// Tabs
function initTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      const name = btn.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      document.getElementById("tab-" + name).classList.add("active");
    });
  });
}

// Bind
function bindActions() {
  document.getElementById("generateBtn").addEventListener("click", onGenerate);
  document.getElementById("clearBtn").addEventListener("click", () => {
    document.getElementById("translationKey").value = "";
    document.getElementById("englishValue").value = "";
    hideGenerated();
  });
  document.getElementById("searchBtn").addEventListener("click", () => loadTranslations());
  document.getElementById("addLanguageBtn").addEventListener("click", onAddLanguage);
  document.getElementById("exportBtn").addEventListener("click", () => window.open("/api/export/json", "_blank"));

  // dropdown toggle
  document.getElementById("langDropdown").addEventListener("click", (e) => {
    document.querySelector(".dropdown-container").classList.toggle("dropdown-active");
  });
  document.addEventListener("click", (e) => {
    const container = document.querySelector(".dropdown-container");
    if (!container.contains(e.target)) container.classList.remove("dropdown-active");
  });
}

// Load languages and build dropdown & list
async function loadLanguages() {
  const res = await fetch(API + "/languages");
  const j = await res.json();
  if (!j.success) return showToast("Failed to load languages");
  LANGS = j.languages;
  buildLangDropdown();
  const list = document.getElementById("languagesList");
  list.innerHTML = "";
  for (const l of LANGS) {
    const chip = document.createElement("div");
    chip.className = "language-chip";
    chip.textContent = `${l.name} (${l.code})`;
    list.appendChild(chip);
  }
}

function buildLangDropdown() {
  const menu = document.getElementById("langDropdownMenu");
  menu.innerHTML = "";
  for (const l of LANGS) {
    if (l.code === "en") continue;
    const item = document.createElement("div");
    item.className = "dropdown-item";
    item.innerHTML = `<input type="checkbox" class="lang-checkbox" value="${l.code}"><label>${l.name} (${l.code})</label>`;
    menu.appendChild(item);
  }
}

// Generate (create) a new translation
async function onGenerate() {
  const key = document.getElementById("translationKey").value.trim();
  const en = document.getElementById("englishValue").value.trim();
  if (!key || !en) return showToast("Key and English value are required");

  // selected languages
  const checked = [...document.querySelectorAll(".lang-checkbox:checked")].map(c => c.value);
  const targetLangs = checked.length ? checked : LANGS.filter(l => l.code !== "en").map(l => l.code);

  // Build request body but backend handles translation of all configured languages
  showLoadingGenerated("Generating translations — please wait...");
  try {
    const resp = await fetch(API + "/translations", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ key, value: en })
    });
    const j = await resp.json();
    if (!j.success) {
      hideGenerated();
      return showToast(j.error || "Failed to generate");
    }
    showGenerated(j.translation);
    showToast("Saved successfully");
    loadTranslations();
  } catch (err) {
    hideGenerated();
    console.error(err);
    showToast("Network error");
  }
}

function showLoadingGenerated(msg) {
  const area = document.getElementById("generatedArea");
  area.innerHTML = `<div class="translation-card"><div class="translation-left"><div class="translation-key">Generating...</div><div class="muted">${msg}</div></div></div>`;
}

function hideGenerated() {
  document.getElementById("generatedArea").innerHTML = "";
}

function showGenerated(t) {
  const area = document.getElementById("generatedArea");
  area.innerHTML = "";
  const card = document.createElement("div"); card.className = "translation-card";
  const left = document.createElement("div"); left.className = "translation-left";
  left.innerHTML = `<div class="translation-key">${t.key}</div>`;
  const vals = document.createElement("div"); vals.className = "translation-values";
  for (const [k,v] of Object.entries(t.values)) {
    const row = document.createElement("div"); row.className = "item";
    row.innerHTML = `<div class="lang">${k}</div><div class="text">${escapeHtml(String(v))}</div>`;
    vals.appendChild(row);
  }
  left.appendChild(vals);
  card.appendChild(left);
  area.appendChild(card);
}

// Load translations list
async function loadTranslations(page = 1) {
  const q = document.getElementById("searchInput").value.trim();
  const sort = document.getElementById("sortBy").value;
  const order = document.getElementById("orderBy").value;
  const url = `${API}/translations?q=${encodeURIComponent(q)}&page=${page}&per=20&sort=${sort}&order=${order}`;
  const resp = await fetch(url);
  const j = await resp.json();
  if (!j.success) return showToast("Failed loading translations");
  const list = document.getElementById("translationsList"); list.innerHTML = "";
  for (const t of j.translations) list.appendChild(buildTranslationCard(t));
  buildPagination(j.page, j.per, j.total);
}

function buildTranslationCard(t) {
  const card = document.createElement("div"); card.className = "translation-card";
  const left = document.createElement("div"); left.className = "translation-left";
  left.innerHTML = `<div class="translation-key">${t.key}</div>`;
  const vals = document.createElement("div"); vals.className = "translation-values";
  for (const [k,v] of Object.entries(t.values)) {
    const row = document.createElement("div"); row.className = "item";
    row.innerHTML = `<div class="lang">${k}</div><div class="text">${escapeHtml(String(v))}</div>`;
    vals.appendChild(row);
  }
  left.appendChild(vals);
  const actions = document.createElement("div"); actions.className = "actions";
  actions.innerHTML = `
    <button class="btn btn-ghost" onclick='openEdit("${t._id}")'>Edit</button>
    <button class="btn btn-ghost" onclick='regenerate("${t._id}")'>Regenerate</button>
    <button class="btn" style="background:linear-gradient(90deg,#ef4444,#dc2626);color:#fff" onclick='del("${t._id}")'>Delete</button>
  `;
  card.appendChild(left); card.appendChild(actions);
  return card;
}

function buildPagination(page, per, total) {
  const pag = document.getElementById("pagination"); pag.innerHTML = "";
  const pages = Math.ceil((total || 0) / per);
  if (pages <= 1) return;
  for (let p = 1; p <= pages; p++) {
    const b = document.createElement("button"); b.className = "btn btn-secondary";
    b.textContent = p; if (p === page) b.style.fontWeight = "900";
    b.onclick = () => loadTranslations(p);
    pag.appendChild(b);
  }
}

// Edit translation - opens small form modal (simple)
async function openEdit(id) {
  // fetch full list (simple)
  const resp = await fetch(API + "/translations");
  const j = await resp.json();
  const doc = (j.translations || []).find(x => x._id === id);
  if (!doc) {
    showToast("Translation not found");
    return;
  }

  // Build editable form inside prompt-like UI (for speed)
  const edits = {};
  for (const [k,v] of Object.entries(doc.values)) {
    const nv = prompt(`Edit value for ${k}`, v);
    if (nv !== null) edits[k] = nv;
  }
  if (Object.keys(edits).length === 0) return;
  const put = await fetch(`${API}/translations/${id}`, {method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify({values: edits})});
  const pj = await put.json();
  if (pj.success) { showToast("Updated"); loadTranslations(); } else showToast(pj.error || "Update failed");
}

async function regenerate(id) {
  if (!confirm("Regenerate translations from English? This will overwrite non-English values.")) return;
  const res = await fetch(`${API}/translations/${id}/regenerate`, {method:"POST"});
  const j = await res.json();
  if (j.success) { showToast("Regenerated"); loadTranslations(); } else showToast(j.error || "Regenerate failed");
}

async function del(id) {
  if (!confirm("Delete this translation?")) return;
  const res = await fetch(`${API}/translations/${id}`, {method:"DELETE"});
  const j = await res.json();
  if (j.success) { showToast("Deleted"); loadTranslations(); } else showToast(j.error || "Delete failed");
}

async function onAddLanguage() {
  const code = document.getElementById("languageCode").value.trim().toLowerCase();
  const name = document.getElementById("languageName").value.trim();
  if (!code || !name) return showToast("code & name required");
  const res = await fetch(API + "/languages", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({code,name})});
  const j = await res.json();
  if (j.success) { showToast("Language added"); document.getElementById("languageCode").value = ""; document.getElementById("languageName").value = ""; loadLanguages(); loadTranslations(); } else showToast(j.error || "Add failed");
}

// SSE notifications (simple toast)
function initSSE() {
  if (!!window.EventSource) {
    const es = new EventSource("/stream");
    es.onmessage = function(e) {
      try {
        const d = JSON.parse(e.data);
        if (d.type === "translation_added") showToast("New translation added: " + d.key);
      } catch (err) { console.error(err); }
    };
  }
}

// Toaster
let toastTimer = null;
function showToast(msg, time=3000) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove("show"), time);
}

// Helpers
function escapeHtml(s) {
  const d = document.createElement("div"); d.textContent = s; return d.innerHTML;
}
