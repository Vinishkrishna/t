// static/js/main.js
/**
 * Translation Management Tool - Frontend
 * Production-ready with error handling, loading states, and user feedback
 */

const API = window.location.origin + "/api";
let LANGS = [];
let STANDARD_LANGS = [];
let currentPage = 1;
let isLoading = false;

// Initialize app
document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    bindActions();
    loadLanguages();
    loadStandardLanguages();
    loadTranslations();
    initSSE();
    setupKeyboardShortcuts();
});

// Tab Management
function initTabs() {
    document.querySelectorAll(".tab").forEach(btn => {
        btn.addEventListener("click", () => {
            if (isLoading) return;
            
            document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
            btn.classList.add("active");
            
            const tabName = btn.dataset.tab;
            document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
            
            const targetPanel = document.getElementById("tab-" + tabName);
            if (targetPanel) {
                targetPanel.classList.add("active");
                
                // Refresh data when switching tabs
                if (tabName === "manage") {
                    loadTranslations();
                } else if (tabName === "languages") {
                    loadLanguages();
                }
            }
        });
    });
}

// Bind Event Listeners
function bindActions() {
    // Add translation
    document.getElementById("generateBtn").addEventListener("click", onGenerate);
    document.getElementById("clearBtn").addEventListener("click", onClearForm);
    
    // Manage translations
    document.getElementById("searchBtn").addEventListener("click", () => {
        currentPage = 1;
        loadTranslations();
    });
    
    // Search on Enter key
    document.getElementById("searchInput").addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            currentPage = 1;
            loadTranslations();
        }
    });
    
    // Languages
    document.getElementById("addLanguageBtn").addEventListener("click", onAddLanguage);
    document.getElementById("exportBtn").addEventListener("click", onExport);
    
    // Standard language selector
    const standardLangSelect = document.getElementById("standardLangSelect");
    if (standardLangSelect) {
        standardLangSelect.addEventListener("change", (e) => {
            const selectedLang = STANDARD_LANGS.find(l => l.code === e.target.value);
            if (selectedLang) {
                document.getElementById("languageCode").value = selectedLang.code;
                document.getElementById("languageName").value = selectedLang.name;
            }
        });
    }
}

// Keyboard Shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
        // Ctrl/Cmd + K for search focus
        if ((e.ctrlKey || e.metaKey) && e.key === "k") {
            e.preventDefault();
            document.getElementById("searchInput").focus();
        }
        
        // Ctrl/Cmd + N for new translation
        if ((e.ctrlKey || e.metaKey) && e.key === "n") {
            e.preventDefault();
            document.querySelector('[data-tab="add"]').click();
            document.getElementById("translationKey").focus();
        }
    });
}

// Load Languages
async function loadLanguages() {
    try {
        const res = await fetch(API + "/languages");
        const data = await res.json();
        
        if (!data.success) {
            throw new Error(data.error || "Failed to load languages");
        }
        
        LANGS = data.languages || [];
        displayLanguagesList();
        updateLanguageCount();
        
    } catch (err) {
        console.error("Error loading languages:", err);
        showToast("Failed to load languages", "error");
    }
}

// Update language count display
function updateLanguageCount() {
    const countEl = document.getElementById("languageCount");
    if (countEl) {
        countEl.textContent = LANGS.length;
    }
}

// Load Standard Languages
async function loadStandardLanguages() {
    try {
        const res = await fetch(API + "/languages/standard");
        const data = await res.json();
        
        if (!data.success) {
            throw new Error(data.error || "Failed to load standard languages");
        }
        
        STANDARD_LANGS = data.languages || [];
        buildStandardLangSelector();
        
    } catch (err) {
        console.error("Error loading standard languages:", err);
    }
}

// Build Standard Language Selector
function buildStandardLangSelector() {
    const select = document.getElementById("standardLangSelect");
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Select a standard language --</option>';
    
    // Filter out already added languages
    const existingCodes = LANGS.map(l => l.code.toLowerCase());
    const availableLanguages = STANDARD_LANGS.filter(lang => 
        !existingCodes.includes(lang.code.toLowerCase())
    );
    
    if (availableLanguages.length === 0) {
        select.innerHTML = '<option value="">All standard languages already added</option>';
        select.disabled = true;
        return;
    }
    
    select.disabled = false;
    availableLanguages.forEach(lang => {
        const option = document.createElement("option");
        option.value = lang.code;
        option.textContent = `${lang.name} (${lang.code})`;
        select.appendChild(option);
    });
}

// Build Language Dropdown for Translation Form
function buildLangDropdown() {
    // No longer needed - removed from UI
    // Translations now automatically go to all configured languages
}

// Display Languages List
function displayLanguagesList() {
    const list = document.getElementById("languagesList");
    if (!list) return;
    
    list.innerHTML = "";
    
    if (LANGS.length === 0) {
        list.innerHTML = '<div style="color:#64748b; padding:12px">No languages configured yet</div>';
        return;
    }
    
    LANGS.forEach(lang => {
        const chip = document.createElement("div");
        chip.className = "language-chip";
        chip.innerHTML = `
            ${escapeHtml(lang.name)} <strong>(${escapeHtml(lang.code)})</strong>
            ${lang.is_default ? '<span style="color:#16a34a">★</span>' : ''}
        `;
        list.appendChild(chip);
    });
    
    // Refresh the standard language dropdown to exclude already added languages
    buildStandardLangSelector();
}

// Generate Translation
async function onGenerate() {
    if (isLoading) return;
    
    const key = document.getElementById("translationKey").value.trim();
    const englishValue = document.getElementById("englishValue").value.trim();
    
    if (!key) {
        showToast("Please enter a translation key", "error");
        document.getElementById("translationKey").focus();
        return;
    }
    
    if (!englishValue) {
        showToast("Please enter an English value", "error");
        document.getElementById("englishValue").focus();
        return;
    }
    
    try {
        isLoading = true;
        setButtonLoading("generateBtn", true, "Generating...");
        showLoadingGenerated(`Generating translations for ${LANGS.length} languages, please wait...`);
        
        // Send empty array to translate to all configured languages
        const response = await fetch(API + "/translations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                key: key,
                value: englishValue,
                languages: [] // Empty array means ALL configured languages
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || "Failed to generate translation");
        }
        
        showGenerated(data.translation);
        showToast("Translation saved successfully!", "success");
        
        // Refresh translations list
        loadTranslations();
        
    } catch (err) {
        console.error("Generation error:", err);
        showToast(err.message || "Failed to generate translation", "error");
        hideGenerated();
    } finally {
        isLoading = false;
        setButtonLoading("generateBtn", false, "Generate & Save");
    }
}

// Clear Form
function onClearForm() {
    document.getElementById("translationKey").value = "";
    document.getElementById("englishValue").value = "";
    hideGenerated();
}

// Show Loading State in Generated Area
function showLoadingGenerated(message) {
    const area = document.getElementById("generatedArea");
    area.innerHTML = `
        <div class="translation-card" style="border:2px solid #eef2ff">
            <div class="translation-left">
                <div class="translation-key">
                    <span class="loading-spinner"></span> Generating...
                </div>
                <div class="muted">${escapeHtml(message)}</div>
            </div>
        </div>
    `;
}

// Hide Generated Area
function hideGenerated() {
    const area = document.getElementById("generatedArea");
    if (area) area.innerHTML = "";
}

// Show Generated Translation
function showGenerated(translation) {
    const area = document.getElementById("generatedArea");
    area.innerHTML = "";
    
    const card = document.createElement("div");
    card.className = "translation-card";
    card.style.border = "2px solid #16a34a";
    
    const left = document.createElement("div");
    left.className = "translation-left";
    
    const keyDiv = document.createElement("div");
    keyDiv.className = "translation-key";
    keyDiv.innerHTML = `✓ ${escapeHtml(translation.key)}`;
    keyDiv.style.color = "#16a34a";
    left.appendChild(keyDiv);
    
    const values = document.createElement("div");
    values.className = "translation-values";
    
    Object.entries(translation.values).forEach(([langCode, text]) => {
        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML = `
            <div class="lang">${escapeHtml(langCode)}</div>
            <div class="text">${escapeHtml(String(text))}</div>
        `;
        values.appendChild(row);
    });
    
    left.appendChild(values);
    card.appendChild(left);
    area.appendChild(card);
}

// Load Translations
async function loadTranslations(page = 1) {
    if (isLoading) return;
    
    const searchQuery = document.getElementById("searchInput").value.trim();
    const sortBy = document.getElementById("sortBy").value;
    const orderBy = document.getElementById("orderBy").value;
    
    try {
        isLoading = true;
        showLoadingTranslations();
        
        const url = `${API}/translations?q=${encodeURIComponent(searchQuery)}&page=${page}&per=20&sort=${sortBy}&order=${orderBy}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || "Failed to load translations");
        }
        
        currentPage = data.page;
        displayTranslations(data.translations || []);
        buildPagination(data.page, data.per, data.total);
        
    } catch (err) {
        console.error("Error loading translations:", err);
        showToast("Failed to load translations", "error");
        document.getElementById("translationsList").innerHTML = 
            '<div style="padding:20px; text-align:center; color:#ef4444">Failed to load translations</div>';
    } finally {
        isLoading = false;
    }
}

// Show Loading Translations
function showLoadingTranslations() {
    const list = document.getElementById("translationsList");
    list.innerHTML = `
        <div style="padding:40px; text-align:center; color:#64748b">
            <div class="loading-spinner"></div>
            <div style="margin-top:12px">Loading translations...</div>
        </div>
    `;
}

// Display Translations
function displayTranslations(translations) {
    const list = document.getElementById("translationsList");
    list.innerHTML = "";
    
    if (translations.length === 0) {
        list.innerHTML = `
            <div style="padding:40px; text-align:center; color:#64748b">
                <div style="font-size:48px; margin-bottom:12px">📝</div>
                <div>No translations found</div>
                <div style="font-size:13px; margin-top:8px">Try a different search or add a new translation</div>
            </div>
        `;
        return;
    }
    
    translations.forEach(translation => {
        list.appendChild(buildTranslationCard(translation));
    });
}

// Build Translation Card
function buildTranslationCard(translation) {
    const card = document.createElement("div");
    card.className = "translation-card";
    card.dataset.id = translation._id;
    
    const left = document.createElement("div");
    left.className = "translation-left";
    
    const keyDiv = document.createElement("div");
    keyDiv.className = "translation-key";
    keyDiv.textContent = translation.key;
    left.appendChild(keyDiv);
    
    const values = document.createElement("div");
    values.className = "translation-values";
    
    Object.entries(translation.values || {}).forEach(([langCode, text]) => {
        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML = `
            <div class="lang">${escapeHtml(langCode)}</div>
            <div class="text">${escapeHtml(String(text))}</div>
        `;
        values.appendChild(row);
    });
    
    left.appendChild(values);
    
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.innerHTML = `
        <button class="btn btn-ghost" onclick="openEdit('${translation._id}')" title="Edit translation">
            ✏️ Edit
        </button>
        <button class="btn btn-ghost" onclick="regenerate('${translation._id}')" title="Regenerate from English">
            🔄 Regenerate
        </button>
        <button class="btn" style="background:linear-gradient(90deg,#ef4444,#dc2626);color:#fff" 
                onclick="deleteTranslation('${translation._id}')" title="Delete translation">
            🗑️ Delete
        </button>
    `;
    
    card.appendChild(left);
    card.appendChild(actions);
    
    return card;
}

// Build Pagination
function buildPagination(page, per, total) {
    const pagination = document.getElementById("pagination");
    pagination.innerHTML = "";
    
    const totalPages = Math.ceil(total / per);
    
    if (totalPages <= 1) return;
    
    const maxButtons = 7;
    let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    
    // Previous button
    if (page > 1) {
        const prevBtn = createPageButton("‹ Prev", page - 1);
        pagination.appendChild(prevBtn);
    }
    
    // First page
    if (startPage > 1) {
        pagination.appendChild(createPageButton(1, 1));
        if (startPage > 2) {
            const ellipsis = document.createElement("span");
            ellipsis.textContent = "...";
            ellipsis.style.padding = "8px";
            pagination.appendChild(ellipsis);
        }
    }
    
    // Page numbers
    for (let p = startPage; p <= endPage; p++) {
        const btn = createPageButton(p, p);
        if (p === page) {
            btn.style.background = "linear-gradient(90deg, #4f46e5, #7c3aed)";
            btn.style.color = "#fff";
        }
        pagination.appendChild(btn);
    }
    
    // Last page
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement("span");
            ellipsis.textContent = "...";
            ellipsis.style.padding = "8px";
            pagination.appendChild(ellipsis);
        }
        pagination.appendChild(createPageButton(totalPages, totalPages));
    }
    
    // Next button
    if (page < totalPages) {
        const nextBtn = createPageButton("Next ›", page + 1);
        pagination.appendChild(nextBtn);
    }
}

function createPageButton(text, pageNum) {
    const btn = document.createElement("button");
    btn.className = "btn btn-secondary";
    btn.textContent = text;
    btn.onclick = () => loadTranslations(pageNum);
    return btn;
}

// Edit Translation
window.openEdit = async function(id) {
    if (isLoading) return;
    
    try {
        const response = await fetch(`${API}/translations?q=`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error("Failed to fetch translation");
        }
        
        const translation = (data.translations || []).find(t => t._id === id);
        
        if (!translation) {
            showToast("Translation not found", "error");
            return;
        }
        
        const newValues = {};
        let hasChanges = false;
        
        for (const [langCode, value] of Object.entries(translation.values)) {
            const newValue = prompt(`Edit value for ${langCode}:`, value);
            if (newValue !== null && newValue !== value) {
                newValues[langCode] = newValue;
                hasChanges = true;
            } else if (newValue !== null) {
                newValues[langCode] = value;
            } else {
                // User cancelled
                return;
            }
        }
        
        if (!hasChanges) {
            showToast("No changes made", "info");
            return;
        }
        
        // Update translation
        const updateResponse = await fetch(`${API}/translations/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ values: newValues })
        });
        
        const updateData = await updateResponse.json();
        
        if (updateData.success) {
            showToast("Translation updated successfully!", "success");
            loadTranslations(currentPage);
        } else {
            throw new Error(updateData.error || "Update failed");
        }
        
    } catch (err) {
        console.error("Edit error:", err);
        showToast(err.message || "Failed to update translation", "error");
    }
};

// Regenerate Translation
window.regenerate = async function(id) {
    if (isLoading) return;
    
    if (!confirm("Regenerate all translations from English? This will overwrite existing non-English values.")) {
        return;
    }
    
    try {
        isLoading = true;
        showToast("Regenerating translations...", "info");
        
        const response = await fetch(`${API}/translations/${id}/regenerate`, {
            method: "POST"
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || "Regeneration failed");
        }
        
        showToast("Translation regenerated successfully!", "success");
        loadTranslations(currentPage);
        
    } catch (err) {
        console.error("Regenerate error:", err);
        showToast(err.message || "Failed to regenerate translation", "error");
    } finally {
        isLoading = false;
    }
};

// Delete Translation
window.deleteTranslation = async function(id) {
    if (isLoading) return;
    
    if (!confirm("Are you sure you want to delete this translation? This action cannot be undone.")) {
        return;
    }
    
    try {
        isLoading = true;
        
        const response = await fetch(`${API}/translations/${id}`, {
            method: "DELETE"
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || "Delete failed");
        }
        
        showToast("Translation deleted successfully", "success");
        loadTranslations(currentPage);
        
    } catch (err) {
        console.error("Delete error:", err);
        showToast(err.message || "Failed to delete translation", "error");
    } finally {
        isLoading = false;
    }
};

// Add Language
async function onAddLanguage() {
    if (isLoading) return;
    
    const code = document.getElementById("languageCode").value.trim().toLowerCase();
    const name = document.getElementById("languageName").value.trim();
    
    if (!code) {
        showToast("Please enter a language code", "error");
        document.getElementById("languageCode").focus();
        return;
    }
    
    if (!name) {
        showToast("Please enter a language name", "error");
        document.getElementById("languageName").focus();
        return;
    }
    
    // Check if language already exists
    const existingLang = LANGS.find(l => l.code.toLowerCase() === code.toLowerCase());
    if (existingLang) {
        showToast(`Language "${existingLang.name}" (${existingLang.code}) is already configured`, "error");
        return;
    }
    
    try {
        isLoading = true;
        setButtonLoading("addLanguageBtn", true, "Adding...");
        
        const response = await fetch(API + "/languages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, name })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || "Failed to add language");
        }
        
        showToast(`Language "${name}" added successfully! ${data.translations_updated || 0} translations updated.`, "success");
        
        // Clear form
        document.getElementById("languageCode").value = "";
        document.getElementById("languageName").value = "";
        document.getElementById("standardLangSelect").value = "";
        
        // Refresh languages and translations
        await loadLanguages();
        await loadTranslations();
        
    } catch (err) {
        console.error("Add language error:", err);
        showToast(err.message || "Failed to add language", "error");
    } finally {
        isLoading = false;
        setButtonLoading("addLanguageBtn", false, "Add Language");
    }
}

// Export Translations
function onExport() {
    window.open("/api/export/json", "_blank");
    showToast("Downloading translations...", "info");
}

// SSE - Server Sent Events
function initSSE() {
    if (!window.EventSource) {
        console.warn("SSE not supported");
        return;
    }
    
    try {
        const eventSource = new EventSource("/stream");
        
        eventSource.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                handleSSEEvent(data);
            } catch (err) {
                console.error("SSE parse error:", err);
            }
        };
        
        eventSource.onerror = function(err) {
            console.error("SSE error:", err);
        };
        
    } catch (err) {
        console.error("SSE initialization error:", err);
    }
}

function handleSSEEvent(data) {
    const type = data.type;
    
    if (type === "translation_added" && data.key) {
        showToast(`New translation added: ${data.key}`, "info");
        if (document.getElementById("tab-manage").classList.contains("active")) {
            loadTranslations(currentPage);
        }
    } else if (type === "translation_updated") {
        if (document.getElementById("tab-manage").classList.contains("active")) {
            loadTranslations(currentPage);
        }
    } else if (type === "language_added" && data.name) {
        showToast(`New language added: ${data.name}`, "info");
        loadLanguages();
    }
}

// Button Loading State
function setButtonLoading(buttonId, loading, text) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    
    if (loading) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.innerHTML = `<span class="loading-spinner"></span> ${text}`;
    } else {
        btn.disabled = false;
        btn.textContent = text || btn.dataset.originalText || "Submit";
    }
}

// Toast Notifications
let toastTimer = null;
function showToast(message, type = "info", duration = 3000) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    
    // Set color based on type
    let bgColor = "#111827";
    if (type === "success") bgColor = "#16a34a";
    else if (type === "error") bgColor = "#ef4444";
    else if (type === "warning") bgColor = "#f59e0b";
    
    toast.style.background = bgColor;
    toast.textContent = message;
    toast.classList.add("show");
    
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, duration);
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// Add loading spinner CSS
const style = document.createElement("style");
style.textContent = `
    .loading-spinner {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);