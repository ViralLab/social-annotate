// ── Theme ──────────────────────────────────────────────────
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    let icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = theme === 'light' ? '🌙' : '☀️';
}

chrome.storage.local.get(['theme'], function (data) {
    applyTheme(data.theme || 'light');
});

const themeToggleEl = document.getElementById('theme-toggle');
if (themeToggleEl) {
    themeToggleEl.addEventListener('click', function () {
        let current = document.documentElement.getAttribute('data-theme') || 'light';
        let next = current === 'dark' ? 'light' : 'dark';
        chrome.storage.local.set({ theme: next }, function () {
            applyTheme(next);
        });
    });
}

// ── Tab navigation ────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function () {
        let target = document.getElementById('tab-' + this.dataset.tab);
        if (!target) return;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        target.classList.add('active');
    });
});

// ── About modal ───────────────────────────────────────────
(function () {
    let modal = document.getElementById('about-modal');
    document.getElementById('about-btn').addEventListener('click', () => modal.classList.add('visible'));
    document.getElementById('about-close').addEventListener('click', () => modal.classList.remove('visible'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('visible'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.classList.remove('visible'); });
})();

// ── Page init ─────────────────────────────────────────────
$('#save-button').click(saveOptionsPage);
$('#export-button').click(exportOptions);
const uploadFileEl = document.getElementById('upload-file');
if (uploadFileEl) uploadFileEl.addEventListener('change', handleFileSelect, false);
$('#import-button').click(importOptions);

loadPage();

// ── State tracking ────────────────────────────────────────
// Track which mode each survey card is in: 'visual' or 'json'
let cardModes = {};
// Monotonic counter for unique field IDs
let fieldIdCounter = 0;
// EasyMDE instances keyed by survey key — initialized lazily on card expand
let consentEditors = {};

function wireCardTabs(key) {
    let card = document.getElementById('card_' + key);
    if (!card) return;
    card.querySelectorAll('.card-tab-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            card.querySelectorAll('.card-tab-btn').forEach(b => b.classList.remove('active'));
            card.querySelectorAll('.card-tab-pane').forEach(p => p.classList.remove('active'));
            this.classList.add('active');
            let pane = document.getElementById(this.dataset.cardTab);
            if (pane) pane.classList.add('active');
            if (this.dataset.cardTab === key + '_tab_consent') initConsentEditor(key);
        });
    });
}

function initConsentEditor(key) {
    if (consentEditors[key]) return;
    let el = document.getElementById(key + '_consent-text');
    if (!el) return;
    consentEditors[key] = new EasyMDE({
        element: el,
        spellChecker: false,
        status: false,
        minHeight: '140px',
        sideBySideFullscreen: false,
        toolbar: ['bold', 'italic', 'heading', '|', 'unordered-list', 'ordered-list', '|', 'preview', 'side-by-side']
    });
    setTimeout(() => {
        if (!consentEditors[key].isSideBySideActive()) {
            consentEditors[key].toggleSideBySide();
        }
    }, 50);
}

// ── Load ──────────────────────────────────────────────────
function loadPage() {
    chrome.storage.local.get(['config', 'isEnabled', 'clientID', 'manipulationMaps'], function (result) {
        if (!result || !result.config) {
            const sc = document.getElementById('survey-container');
            if (sc) sc.textContent = 'No configuration found.';
            return;
        }
        const apiEl = document.getElementById('api-endpoint');
        if (apiEl) apiEl.value = result.config.apiEndpoint || '';

        const downloadFolderEl = document.getElementById('download-folder');
        if (downloadFolderEl) downloadFolderEl.value = result.config.downloadFolder || '';

        let html = '';
        for (let key in result.config.surveys) {
            let survey = result.config.surveys[key];
            html += buildSurveyCard(key, survey);
        }
        const sc = document.getElementById('survey-container');
        if (sc) sc.innerHTML = html;

        // Wire collapse toggles
        document.querySelectorAll('.card-header').forEach(header => {
            header.addEventListener('click', function (e) {
                if (e.target.closest('.btn-preview')) return;
                this.closest('.survey-card').classList.toggle('expanded');
            });
        });

        // Wire preview buttons
        document.querySelectorAll('.btn-preview').forEach(btn => {
            btn.addEventListener('click', function () {
                previewSurvey(this.dataset.key);
            });
        });
        document.querySelectorAll('.btn-close-preview').forEach(btn => {
            btn.addEventListener('click', function () {
                closePreview(this.dataset.key);
            });
        });

        // Populate field values and initialize builders
        for (let key in result.config.surveys) {
            let survey = result.config.surveys[key];
            let studyIdEl = document.getElementById(key + '_study-id');
            if (studyIdEl) studyIdEl.value = survey.studyID || '';
            if (survey.hasOwnProperty('injectElement')) {
                let insertEl = document.getElementById(key + '_insert-location');
                if (insertEl) insertEl.value = survey.injectElement.name || '';
            }
            if (survey.hasOwnProperty('screenNameList')) {
                let listArr = Array.isArray(survey.screenNameList) ? survey.screenNameList : [];
                let annEl = document.getElementById(key + '_annotation-list');
                if (annEl) annEl.value = listArr.join(',\n');
            }
            let consentEnabledEl = document.getElementById(key + '_consent-enabled');
            if (consentEnabledEl) consentEnabledEl.checked = !!(survey.informedConsent && survey.informedConsent.enabled);
            let consentText = (survey.informedConsent && survey.informedConsent.text) || '';
            let consentTextEl = document.getElementById(key + '_consent-text');
            if (consentEditors[key]) {
                consentEditors[key].value(consentText);
            } else if (consentTextEl) {
                consentTextEl.value = consentText;
            }
            let themeEl = document.getElementById(key + '_theme');
            if (themeEl) {
                themeEl.value = survey.theme || 'light';
            }
            if (survey.hasOwnProperty('surveyFormSchema')) {
                let jsonStr = JSON.stringify(survey.surveyFormSchema, null, '\t');
                document.getElementById(key + '_form-template').value = jsonStr;
                // Initialize visual builder from the schema
                cardModes[key] = 'visual';
                jsonToBuilder(key, survey.surveyFormSchema);
            }

            // Manipulation settings
            let manip = survey.manipulation || {};
            let manipEnabledEl = document.getElementById(key + '_manip-enabled');
            if (manipEnabledEl) manipEnabledEl.checked = !!manip.enabled;
            let manipModeEl = document.getElementById(key + '_manip-mode');
            if (manipModeEl) {
                let mode = manip.mode || 'blind';
                manipModeEl.value = mode;
                let card = document.getElementById('card_' + key);
                if (card) {
                    card.querySelectorAll('.manip-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.value === mode));
                    let descEl = document.getElementById(key + '_manip-mode-desc');
                    if (descEl) descEl.textContent = mode === 'aware' ? 'Annotator can toggle to see original text' : 'Annotator sees rewritten text only';
                }
            }
            let manipLogEl = document.getElementById(key + '_manip-log-original');
            if (manipLogEl) manipLogEl.checked = !!manip.logOriginal;
            let loadedMap = result.manipulationMaps && result.manipulationMaps[key];
            showManipMapStatus(key, loadedMap || null);

            // Wire card-level tabs
            wireCardTabs(key);
            // Wire mode toggle buttons
            wireModeTabs(key);
            // Wire add field button
            wireAddField(key);
            // Wire annotation list file upload
            wireAnnotationUpload(key);
            // Wire manipulation map upload
            wireManipulationUpload(key);
            // Wire manip mode pill buttons
            wireManipModeToggle(key);
        }
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"'`=\/]/g, function (s) {
        return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;","/":"&#x2F;","`":"&#x60;","=":"&#x3D;"})[s];
    });
}

// ── Wire mode toggle ──────────────────────────────────────
function wireModeTabs(key) {
    let container = document.getElementById('card_' + key);
    if (!container) return;
    container.querySelectorAll('.mode-toggle-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            let mode = this.dataset.mode;
            let card = this.closest('.survey-card');
            card.querySelectorAll('.mode-toggle-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            let builderEl = document.getElementById(key + '_builder-view');
            let jsonEl = document.getElementById(key + '_json-view');

            if (mode === 'visual') {
                // Sync JSON → builder
                try {
                    let json = JSON.parse(document.getElementById(key + '_form-template').value);
                    jsonToBuilder(key, json);
                } catch (e) { /* keep existing builder state on parse error */ }
                builderEl.style.display = 'block';
                jsonEl.style.display = 'none';
                cardModes[key] = 'visual';
            } else {
                // Sync builder → JSON
                let json = builderToJson(key);
                document.getElementById(key + '_form-template').value = JSON.stringify(json, null, '\t');
                builderEl.style.display = 'none';
                jsonEl.style.display = 'block';
                cardModes[key] = 'json';
            }
        });
    });
}

// ── Wire add field ────────────────────────────────────────
function wireAddField(key) {
    let container = document.getElementById('card_' + key);
    if (!container) return;
    let addBtn = container.querySelector('.btn-add-field');
    let selectEl = container.querySelector('.add-field-select');
    if (addBtn && selectEl) {
        addBtn.addEventListener('click', function () {
            let type = selectEl.value;
            addBuilderField(key, type);
        });
    }
}

// ── Wire annotation list upload ───────────────────────────
function wireAnnotationUpload(key) {
    let fileInput = document.getElementById(key + '_annotation-file');
    let textarea = document.getElementById(key + '_annotation-list');
    let container = document.getElementById('card_' + key);
    if (!fileInput || !textarea) return;

    fileInput.addEventListener('change', function (e) {
        let file = e.target.files[0];
        if (!file) return;
        let reader = new FileReader();
        reader.onload = function (evt) {
            let text = evt.target.result.trim();
            // Parse: split by newlines first, then by commas, trim and deduplicate
            let entries = text.split(/[\n\r]+/)
                .flatMap(line => line.split(','))
                .map(s => s.trim())
                .filter(s => s.length > 0);
            // Append to existing content
            let existing = textarea.value.trim();
            if (existing) {
                let existingEntries = existing.split(',').map(s => s.trim()).filter(s => s);
                entries = existingEntries.concat(entries);
            }
            // Deduplicate
            entries = [...new Set(entries)];
            textarea.value = entries.join(',\n');
            // Reset input so the same file can be re-selected
            fileInput.value = '';
        };
        reader.onerror = function () { alert('Error reading file'); };
        reader.readAsText(file);
    });

    // Wire clear button
    if (container) {
        let clearBtn = container.querySelector('.btn-clear-list');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                textarea.value = '';
            });
        }
    }
}

// ── Wire manipulation map upload ──────────────────────────
function wireManipulationUpload(key) {
    let fileInput = document.getElementById(key + '_manip-file');
    if (!fileInput) return;

    fileInput.addEventListener('change', function (e) {
        let file = e.target.files[0];
        if (!file) return;
        let reader = new FileReader();
        reader.onload = function (evt) {
            let map;
            try {
                map = JSON.parse(evt.target.result);
            } catch (err) {
                alert('Invalid JSON: ' + err.message);
                return;
            }
            let entries = Object.keys(map).filter(k => k !== '_meta');
            if (entries.length === 0) {
                alert('No post entries found in map (expected at least one non-_meta key).');
                return;
            }
            chrome.storage.local.get(['manipulationMaps'], function (stored) {
                let maps = stored.manipulationMaps || {};
                maps[key] = map;
                chrome.storage.local.set({ manipulationMaps: maps }, function () {
                    showManipMapStatus(key, map);
                    fileInput.value = '';
                });
            });
        };
        reader.onerror = function () { alert('Error reading file'); };
        reader.readAsText(file);
    });

    let card = document.getElementById('card_' + key);
    if (!card) return;
    let clearBtn = card.querySelector('.btn-clear-map');
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            chrome.storage.local.get(['manipulationMaps'], function (stored) {
                let maps = stored.manipulationMaps || {};
                delete maps[key];
                chrome.storage.local.set({ manipulationMaps: maps }, function () {
                    showManipMapStatus(key, null);
                });
            });
        });
    }
}

function wireManipModeToggle(key) {
    let card = document.getElementById('card_' + key);
    if (!card) return;
    let modeDescriptions = { blind: 'Annotator sees rewritten text only', aware: 'Annotator can toggle to see original text' };
    card.querySelectorAll('.manip-mode-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            let val = this.dataset.value;
            let hiddenEl = document.getElementById(key + '_manip-mode');
            if (hiddenEl) hiddenEl.value = val;
            card.querySelectorAll('.manip-mode-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            let descEl = document.getElementById(key + '_manip-mode-desc');
            if (descEl) descEl.textContent = modeDescriptions[val] || '';
        });
    });
}

function showManipMapStatus(key, map) {
    let statusEl = document.getElementById(key + '_manip-status');
    if (!statusEl) return;
    if (!map) {
        statusEl.textContent = 'No map loaded.';
        statusEl.className = 'manip-map-status';
        return;
    }
    let entries = Object.keys(map).filter(k => k !== '_meta');
    let meta = map._meta || {};
    let parts = [entries.length + ' posts'];
    if (meta.map_id)      parts.push('id: ' + meta.map_id);
    if (meta.prompt_label) parts.push('preset: ' + meta.prompt_label);
    if (meta.model)       parts.push('model: ' + meta.model);
    statusEl.textContent = '✓ ' + parts.join(' · ');
    statusEl.className = 'manip-map-status manip-map-status--loaded';
}

// ── Build survey card HTML ────────────────────────────────
function buildSurveyCard(key, survey) {
    let platform = survey.socialMediaPlatform || (key.startsWith('truthsocial') ? 'truthsocial' : (key.startsWith('instagram') ? 'instagram' : (key.startsWith('bluesky') ? 'bluesky' : (key.startsWith('whatsapp') ? 'whatsapp' : (key.startsWith('telegram') ? 'telegram' : (key.startsWith('linkedin') ? 'linkedin' : 'x'))))));
    let safeKey = escapeHtml(key);
    let safePlatform = escapeHtml(platform);
    const annotationHints = {
        'x-post':            'Tweet IDs',
        'x-user':            'X/Twitter usernames (screen names)',
        'instagram-post':    'Instagram post shortcodes or URLs',
        'instagram-user':    'Instagram usernames',
        'bluesky-post':      'Bluesky post URLs',
        'bluesky-user':      'Bluesky handles (e.g. user.bsky.social)',
        'whatsapp-post':     'WhatsApp message identifiers',
        'telegram-post':     'Telegram message IDs',
        'linkedin-post':     'LinkedIn post URLs',
        'linkedin-user':     'LinkedIn profile usernames',
        'truthsocial-post':  'Truth Social post IDs',
        'truthsocial-user':  'Truth Social usernames',
    };
    let annotationHint = annotationHints[key] || 'Comma-separated identifiers';
    const noManipulationPlatforms = ['tiktok', 'facebook', 'youtube', 'mastodon'];
    let hasManipulation = !noManipulationPlatforms.some(function(p) { return key.startsWith(p); });
    return `
<div class="survey-card" id="card_${key}">
  <div class="card-header">
    <div class="card-header-left">
      <img src="../images/${safePlatform}.png" class="platform-icon" alt="${safePlatform}">
      <span class="survey-name">${safeKey}</span>
      <span class="platform-badge">${safePlatform}</span>
    </div>
    <span class="card-toggle">▾</span>
  </div>
  <div class="card-body">
    <div class="card-tabs">
      <button class="card-tab-btn active" data-card-tab="${key}_tab_basic">Basic</button>
      <button class="card-tab-btn" data-card-tab="${key}_tab_consent">Consent</button>
      <button class="card-tab-btn" data-card-tab="${key}_tab_form">Form</button>
      ${hasManipulation ? `<button class="card-tab-btn" data-card-tab="${key}_tab_manipulation">Manipulation</button>` : ''}
    </div>

    <!-- Basic -->
    <div class="card-tab-pane active" id="${key}_tab_basic">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="field-group" style="margin:0;">
          <label class="field-label" for="${key}_study-id">
            Study ID
            <span class="field-hint">Identifier for this study</span>
          </label>
          <input type="text" class="field-input" id="${key}_study-id" placeholder="e.g. ${key}-study">
        </div>
        <div class="field-group" style="margin:0;">
          <label class="field-label" for="${key}_insert-location">Insert Location</label>
          <input type="text" class="field-input" id="${key}_insert-location" placeholder="HTML element name">
        </div>
      </div>
      <div class="field-group" style="margin-top:16px;">
        <label class="field-label" for="${key}_annotation-list">
          Annotation List
          <span class="field-hint">${annotationHint}</span>
        </label>
        <div class="annotation-upload-row">
          <input type="file" id="${key}_annotation-file" class="file-input" accept=".txt,.csv">
          <label for="${key}_annotation-file" class="btn-upload-list">📄 Load from file</label>
          <button class="btn-clear-list" data-key="${key}">✕ Clear</button>
        </div>
        <textarea id="${key}_annotation-list" class="field-textarea field-textarea--short" rows="2" spellcheck="false"></textarea>
      </div>
    </div>

    <!-- Consent -->
    <div class="card-tab-pane" id="${key}_tab_consent">
      <div class="field-group">
        <label class="toggle-label" style="margin-bottom:14px;">
          <input type="checkbox" id="${key}_consent-enabled"> Enable Consent Popup
        </label>
        <textarea id="${key}_consent-text" class="field-textarea" rows="6" spellcheck="false"
          placeholder="Consent text… Supports Markdown. Use {platform} as a placeholder."></textarea>
      </div>
    </div>

    <!-- Form -->
    <div class="card-tab-pane" id="${key}_tab_form">
      <div class="mode-toggle-row">
        <label class="field-label" style="margin-bottom:0;">Form Template</label>
        <div class="mode-toggle">
          <button class="mode-toggle-btn active" data-mode="visual">⚡ Visual</button>
          <button class="mode-toggle-btn" data-mode="json">{ } JSON</button>
        </div>
      </div>
      <div id="${key}_builder-view">
        <div class="builder-toolbar">
          <select class="add-field-select">
            <option value="radiobuttons">Radio Buttons</option>
            <option value="range">Range / Slider</option>
            <option value="text">Text Input</option>
            <option value="checkbox">Checkbox</option>
          </select>
          <button class="btn-add-field">+ Add Field</button>
        </div>
        <div class="builder-fields" id="${key}_builder-fields"></div>
      </div>
      <div id="${key}_json-view" style="display:none;">
        <textarea id="${key}_form-template" class="field-textarea" rows="10" spellcheck="false"></textarea>
        <div class="json-error" id="${key}_json-error"></div>
      </div>
      <div class="field-group" style="margin-top:16px;">
        <label class="field-label" for="${key}_theme">
          Survey Theme
          <span class="field-hint">Dark (glassmorphism) or light</span>
        </label>
        <select class="field-input" id="${key}_theme">
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>
    </div>

    <!-- Manipulation -->
    ${hasManipulation ? `
    <div class="card-tab-pane" id="${key}_tab_manipulation">
      <div class="field-group">
        <label class="manip-toggle-label" style="margin-bottom:16px;">
          <input type="checkbox" id="${key}_manip-enabled"> Enable Manipulation
        </label>
        <div class="manip-settings-row">
          <div class="field-group" style="margin:0;">
            <label class="field-label">Study Mode</label>
            <input type="hidden" id="${key}_manip-mode" value="blind">
            <div class="manip-mode-toggle" data-key="${key}">
              <button type="button" class="manip-mode-btn active" data-value="blind">🙈 Blind</button>
              <button type="button" class="manip-mode-btn" data-value="aware">👁 Aware</button>
            </div>
            <div class="manip-mode-desc" id="${key}_manip-mode-desc">Annotator sees rewritten text only</div>
          </div>
          <div class="field-group" style="margin:0;display:flex;align-items:center;padding-top:24px;">
            <label class="manip-toggle-label">
              <input type="checkbox" id="${key}_manip-log-original"> Log original text in annotations
            </label>
          </div>
        </div>
        <label class="field-label" style="margin-top:16px;">Manipulation Map
          <span class="field-hint">JSON from manipulation/rewriter.py or any external tool</span>
        </label>
        <div class="annotation-upload-row">
          <input type="file" id="${key}_manip-file" class="file-input" accept=".json">
          <label for="${key}_manip-file" class="btn-upload-list">📂 Load map</label>
          <button class="btn-clear-map" data-key="${key}">✕ Clear</button>
        </div>
        <div class="manip-map-status" id="${key}_manip-status">No map loaded.</div>
      </div>
    </div>` : ''}

    <div class="card-actions">
      <button class="btn-preview" data-key="${key}">▶ Preview Survey</button>
    </div>
  </div>
  <div class="preview-panel" id="${key}_preview-panel" style="display:none;">
    <div class="preview-panel-header">
      <span class="preview-panel-title"><span class="preview-dot"></span> Live Preview</span>
      <button class="btn-close-preview" data-key="${key}">✕ Close</button>
    </div>
    <div class="preview-body" id="${key}_preview-body"></div>
  </div>
</div>`;
}


// ═══════════════════════════════════════════════════════════
//  VISUAL FORM BUILDER
// ═══════════════════════════════════════════════════════════

// ── JSON → Builder ────────────────────────────────────────
// Parse a jsonform schema and populate the visual builder
function jsonToBuilder(key, formSchema) {
    let container = document.getElementById(key + '_builder-fields');
    if (!container) return;
    container.innerHTML = '';

    if (!formSchema || !formSchema.schema || !formSchema.form) {
        container.innerHTML = '<div class="builder-empty">No fields yet. Add one above.</div>';
        return;
    }

    let schema = formSchema.schema;
    let form = formSchema.form;

    // Build fields for each form entry (skip submit button)
    for (let formEntry of form) {
        if (formEntry.type === 'submit' || formEntry.type === 'hidden') continue;
        let fieldKey = formEntry.key;
        if (!fieldKey || !schema[fieldKey]) continue;

        let schemaDef = schema[fieldKey];
        let fieldType = formEntry.type || inferType(schemaDef);

        let fieldData = {
            key: fieldKey,
            type: fieldType,
            title: schemaDef.title || '',
            required: schemaDef.required || false,
            options: schemaDef.enum || [],
            min: schemaDef.minimum != null ? schemaDef.minimum : 0,
            max: schemaDef.maximum != null ? schemaDef.maximum : 10,
            defaultVal: schemaDef.default != null ? schemaDef.default : 0
        };

        let fieldEl = createFieldElement(key, fieldData);
        container.appendChild(fieldEl);
    }

    if (container.children.length === 0) {
        container.innerHTML = '<div class="builder-empty">No fields yet. Add one above.</div>';
    }

    setupDragDrop(key);
}

function inferType(schemaDef) {
    if (schemaDef.enum && schemaDef.enum.length > 0) return 'radiobuttons';
    if (schemaDef.type === 'integer' || schemaDef.type === 'number') return 'range';
    if (schemaDef.type === 'boolean') return 'checkbox';
    return 'text';
}

// ── Builder → JSON ────────────────────────────────────────
// Read builder DOM and generate { schema, form }
function builderToJson(key) {
    let container = document.getElementById(key + '_builder-fields');
    let schema = {};
    let form = [];

    if (!container) return { schema: {}, form: [{ type: 'submit', title: 'Submit', htmlClass: 'surveySubmitBtn' }] };

    let fields = container.querySelectorAll('.builder-field');
    fields.forEach(fieldEl => {
        let fieldKey = fieldEl.querySelector('.builder-field-key').value.trim();
        if (!fieldKey) return;

        let fieldType = fieldEl.dataset.type;
        let title = fieldEl.querySelector('.builder-inline-input[data-prop="title"]');
        let required = fieldEl.querySelector('.builder-required-cb');

        let schemaDef = {};
        let formEntry = { key: fieldKey };

        if (fieldType === 'radiobuttons') {
            schemaDef.type = 'string';
            schemaDef.title = title ? title.value : '';
            let options = [];
            fieldEl.querySelectorAll('.option-pill-text').forEach(input => {
                let val = input.value.trim();
                if (val) options.push(val);
            });
            if (options.length > 0) schemaDef.enum = options;
            schemaDef.required = required ? required.checked : false;
            formEntry.type = 'radiobuttons';
        } else if (fieldType === 'range') {
            schemaDef.type = 'integer';
            schemaDef.title = title ? title.value : '';
            let minEl = fieldEl.querySelector('input[data-prop="min"]');
            let maxEl = fieldEl.querySelector('input[data-prop="max"]');
            let defEl = fieldEl.querySelector('input[data-prop="default"]');
            schemaDef.minimum = minEl ? parseInt(minEl.value, 10) || 0 : 0;
            schemaDef.maximum = maxEl ? parseInt(maxEl.value, 10) || 10 : 10;
            schemaDef.default = defEl ? parseInt(defEl.value, 10) || 0 : 0;
            schemaDef.required = required ? required.checked : false;
            formEntry.type = 'range';
        } else if (fieldType === 'text') {
            schemaDef.type = 'string';
            schemaDef.title = title ? title.value : '';
            schemaDef.required = required ? required.checked : false;
            formEntry.type = 'text';
        } else if (fieldType === 'checkbox') {
            schemaDef.type = 'boolean';
            schemaDef.title = title ? title.value : '';
            schemaDef.required = required ? required.checked : false;
            formEntry.type = 'checkbox';
        }

        schema[fieldKey] = schemaDef;
        form.push(formEntry);
    });

    // Always append submit
    form.push({ type: 'submit', title: 'Submit', htmlClass: 'surveySubmitBtn' });
    return { schema, form };
}

// ── Create field element ──────────────────────────────────
function createFieldElement(surveyKey, data) {
    let id = 'field_' + (fieldIdCounter++);
    let el = document.createElement('div');
    el.className = 'builder-field';
    el.dataset.fieldId = id;
    el.dataset.type = data.type;
    el.draggable = true;

    let typeLabelMap = {
        'radiobuttons': 'Radio',
        'range': 'Range',
        'text': 'Text',
        'checkbox': 'Check'
    };

    let bodyHTML = '';

    // Title input (all types)
    bodyHTML += `
      <div style="margin-bottom:8px;">
        <span class="builder-inline-label">Question / Title</span>
        <input class="builder-inline-input" data-prop="title" value="${escapeAttr(data.title)}" placeholder="Enter question text...">
      </div>`;

    // Type-specific controls
    if (data.type === 'radiobuttons') {
        let pillsHTML = '';
        (data.options || []).forEach(opt => {
            pillsHTML += `
              <span class="option-pill">
                <input class="option-pill-text" value="${escapeAttr(opt)}">
                <button class="btn-remove-option" title="Remove">✕</button>
              </span>`;
        });
        bodyHTML += `
          <span class="builder-inline-label">Options</span>
          <div class="option-pills">
            ${pillsHTML}
            <button class="btn-add-option">+ Add</button>
          </div>`;
    } else if (data.type === 'range') {
        bodyHTML += `
          <div class="range-inputs-row">
            <div class="range-input-group">
              <label>Min</label>
              <input type="number" data-prop="min" value="${data.min}">
            </div>
            <div class="range-input-group">
              <label>Max</label>
              <input type="number" data-prop="max" value="${data.max}">
            </div>
            <div class="range-input-group">
              <label>Default</label>
              <input type="number" data-prop="default" value="${data.defaultVal}">
            </div>
          </div>`;
    }
    // text and checkbox only need the title input — already added above

    el.innerHTML = `
      <div class="builder-field-header">
        <span class="drag-handle">⠿</span>
        <input class="builder-field-key" value="${escapeAttr(data.key)}" placeholder="field_key" spellcheck="false">
        <span class="builder-type-badge">${typeLabelMap[data.type] || data.type}</span>
        <label class="builder-required-toggle">
          <input type="checkbox" class="builder-required-cb" ${data.required ? 'checked' : ''}> Req
        </label>
        <button class="btn-delete-field" title="Delete field">🗑</button>
      </div>
      <div class="builder-field-body">${bodyHTML}</div>`;

    // Wire delete button
    el.querySelector('.btn-delete-field').addEventListener('click', function () {
        el.remove();
        let container = document.getElementById(surveyKey + '_builder-fields');
        if (container && container.children.length === 0) {
            container.innerHTML = '<div class="builder-empty">No fields yet. Add one above.</div>';
        }
    });

    // Wire add/remove option buttons for radio
    if (data.type === 'radiobuttons') {
        wireOptionButtons(el);
    }

    return el;
}

function wireOptionButtons(fieldEl) {
    // Wire remove buttons
    fieldEl.querySelectorAll('.btn-remove-option').forEach(btn => {
        btn.addEventListener('click', function () {
            this.closest('.option-pill').remove();
        });
    });
    // Wire add button
    let addBtn = fieldEl.querySelector('.btn-add-option');
    if (addBtn) {
        addBtn.addEventListener('click', function () {
            let pill = document.createElement('span');
            pill.className = 'option-pill';
            pill.innerHTML = `<input class="option-pill-text" value="Option" placeholder="value"><button class="btn-remove-option" title="Remove">✕</button>`;
            pill.querySelector('.btn-remove-option').addEventListener('click', function () {
                pill.remove();
            });
            // Insert before the add button
            this.parentNode.insertBefore(pill, this);
            pill.querySelector('.option-pill-text').focus();
            pill.querySelector('.option-pill-text').select();
        });
    }
}

// ── Add field ─────────────────────────────────────────────
function addBuilderField(surveyKey, type) {
    let container = document.getElementById(surveyKey + '_builder-fields');
    if (!container) return;

    // Remove empty state
    let emptyMsg = container.querySelector('.builder-empty');
    if (emptyMsg) emptyMsg.remove();

    // Generate a default key
    let idx = container.querySelectorAll('.builder-field').length + 1;
    let defaults = {
        'radiobuttons': { key: 'question_' + idx, type: 'radiobuttons', title: '', required: true, options: ['Yes', 'No'] },
        'range': { key: 'scale_' + idx, type: 'range', title: '', required: true, min: 0, max: 5, defaultVal: 3 },
        'text': { key: 'text_' + idx, type: 'text', title: '', required: false },
        'checkbox': { key: 'check_' + idx, type: 'checkbox', title: '', required: false }
    };

    let data = defaults[type] || defaults['radiobuttons'];
    let fieldEl = createFieldElement(surveyKey, data);
    container.appendChild(fieldEl);
    setupDragDrop(surveyKey);

    // Focus the title input
    let titleInput = fieldEl.querySelector('.builder-inline-input[data-prop="title"]');
    if (titleInput) {
        titleInput.focus();
    }
}

// ── Drag and drop ─────────────────────────────────────────
function setupDragDrop(surveyKey) {
    let container = document.getElementById(surveyKey + '_builder-fields');
    if (!container) return;

    let fields = container.querySelectorAll('.builder-field');
    let draggedEl = null;

    fields.forEach(field => {
        field.addEventListener('dragstart', function (e) {
            draggedEl = this;
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            // Need to set data for Firefox
            e.dataTransfer.setData('text/plain', '');
        });

        field.addEventListener('dragend', function () {
            this.classList.remove('dragging');
            container.querySelectorAll('.builder-field').forEach(f => f.classList.remove('drag-over'));
            draggedEl = null;
        });

        field.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (this !== draggedEl) {
                this.classList.add('drag-over');
            }
        });

        field.addEventListener('dragleave', function () {
            this.classList.remove('drag-over');
        });

        field.addEventListener('drop', function (e) {
            e.preventDefault();
            this.classList.remove('drag-over');
            if (draggedEl && this !== draggedEl) {
                // Determine insertion position
                let allFields = Array.from(container.querySelectorAll('.builder-field'));
                let dragIdx = allFields.indexOf(draggedEl);
                let dropIdx = allFields.indexOf(this);
                if (dragIdx < dropIdx) {
                    container.insertBefore(draggedEl, this.nextSibling);
                } else {
                    container.insertBefore(draggedEl, this);
                }
            }
        });
    });
}


// ═══════════════════════════════════════════════════════════
//  PREVIEW
// ═══════════════════════════════════════════════════════════

function getFormJson(key) {
    if (cardModes[key] === 'visual') {
        return builderToJson(key);
    } else {
        return JSON.parse(document.getElementById(key + '_form-template').value);
    }
}

function previewSurvey(key) {
    let errorEl = document.getElementById(key + '_json-error');
    let previewPanel = document.getElementById(key + '_preview-panel');
    let previewBody = document.getElementById(key + '_preview-body');

    let formTemplate;
    try {
        formTemplate = getFormJson(key);
        if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
    } catch (e) {
        if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = '✕ Invalid JSON: ' + e.message; }
        return;
    }

    let card = document.getElementById('card_' + key);
    card.classList.add('expanded');
    previewPanel.style.display = 'block';

    previewBody.innerHTML = '';
    let iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('sandbox/survey.html');
    iframe.style.cssText = 'border:none; width:100%; height:auto; display:block; background:transparent;';

    let platform = key.startsWith('truthsocial') ? 'truthsocial' : (key.startsWith('instagram') ? 'instagram' : (key.startsWith('bluesky') ? 'bluesky' : (key.startsWith('whatsapp') ? 'whatsapp' : (key.startsWith('telegram') ? 'telegram' : (key.startsWith('linkedin') ? 'linkedin' : 'x')))));
    let cssUrl = chrome.runtime.getURL('content-scripts/' + platform + '/inject.css');

    let themeEl = document.getElementById(key + '_theme');
    let themeVal = themeEl ? themeEl.value : 'light';

    iframe.onload = function () {
        console.debug('[Options] preview iframe loaded for', key);
        const token = Math.random().toString(36).slice(2);
        iframe.contentWindow.postMessage({
            type: 'render',
            cssUrl: cssUrl,
            formTemplate: formTemplate,
            callId: 'preview-' + key,
            surveyType: key,
            theme: themeVal,
            token: token
        }, '*');
        console.debug('[Options] posted render to preview iframe for', key);
    };

    previewBody.appendChild(iframe);
    previewPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Auto-resize preview iframes when the sandbox reports its content height
window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'resize' && e.data.callId) {
        let callId = e.data.callId;
        // callId format is 'preview-<surveyKey>'
        if (!callId.startsWith('preview-')) return;
        let key = callId.slice('preview-'.length);
        let panel = document.getElementById(key + '_preview-body');
        if (!panel) return;
        let iframe = panel.querySelector('iframe');
        if (iframe) {
            iframe.style.height = (e.data.height + 16) + 'px';
        }
    }
});

function closePreview(key) {
    document.getElementById(key + '_preview-panel').style.display = 'none';
    document.getElementById(key + '_preview-body').innerHTML = '';
}


// ═══════════════════════════════════════════════════════════
//  SAVE / EXPORT / IMPORT
// ═══════════════════════════════════════════════════════════

function saveOptionsPage() {
    chrome.storage.local.get(['config'], function (result) {
        let configData = result.config;
        configData.apiEndpoint = document.getElementById('api-endpoint').value;
        configData.downloadFolder = document.getElementById('download-folder').value.trim();

        for (let key in configData.surveys) {
            let survey = configData.surveys[key];
            let studyIdInput = document.getElementById(key + '_study-id');
            if (studyIdInput) configData.surveys[key].studyID = studyIdInput.value.trim();
            if (survey.hasOwnProperty('injectElement')) {
                configData.surveys[key].injectElement.name = document.getElementById(key + '_insert-location').value;
            }
            if (survey.hasOwnProperty('screenNameList')) {
                let valStr = document.getElementById(key + '_annotation-list').value;
                configData.surveys[key].screenNameList = valStr.split(',').map(s => s.trim()).filter(s => s);
            }
            let themeEl = document.getElementById(key + '_theme');
            if (themeEl) {
                configData.surveys[key].theme = themeEl.value;
            }
            let consentEnabledEl = document.getElementById(key + '_consent-enabled');
            if (consentEnabledEl) {
                let consentTextEl = document.getElementById(key + '_consent-text');
                let mdText = consentEditors[key]
                    ? consentEditors[key].value()
                    : (consentTextEl ? consentTextEl.value : '');
                configData.surveys[key].informedConsent = {
                    enabled: consentEnabledEl.checked,
                    text: mdText,
                    html: mdText ? marked.parse(mdText) : ''
                };
            }
            // Manipulation settings
            let manipEnabledSave = document.getElementById(key + '_manip-enabled');
            let manipModeSave    = document.getElementById(key + '_manip-mode');
            let manipLogSave     = document.getElementById(key + '_manip-log-original');
            if (manipEnabledSave) {
                configData.surveys[key].manipulation = {
                    enabled:     manipEnabledSave.checked,
                    mode:        manipModeSave ? manipModeSave.value : 'blind',
                    logOriginal: manipLogSave ? manipLogSave.checked : false,
                };
            }

            // Read from visual builder or JSON textarea depending on mode
            try {
                configData.surveys[key].surveyFormSchema = getFormJson(key);
            } catch (e) {
                alert('Invalid form configuration for "' + key + '": ' + e.message);
                return;
            }
        }

        let activeSurvey = configData.activeSurveys && configData.activeSurveys.length > 0 ? configData.activeSurveys[0] : null;
        let newTargetList = (activeSurvey && configData.surveys[activeSurvey] && configData.surveys[activeSurvey].screenNameList)
            ? [...configData.surveys[activeSurvey].screenNameList] : [];

        chrome.storage.local.set({ 'config': configData, 'activeTargetList': newTargetList }, function () {
            console.log('Config data updated');
            alert('Configuration saved successfully!');
        });
    });
}

function exportOptions() {
    chrome.storage.local.get(['config'], function (result) {
        let url = 'data:text/plain;charset=utf-8,' + JSON.stringify(result.config, null, '\t');
        chrome.downloads.download({ url: url, filename: 'config.json' });
    });
}

function importOptions() {
    let input = document.getElementById('import-button');
    let raw = input.getAttribute('import-data');
    if (!raw || !raw.trim()) {
        alert('Please choose a config file first.');
        return;
    }
    let configData;
    try {
        configData = JSON.parse(raw);
    } catch (e) {
        alert('Invalid config file: ' + e.message);
        return;
    }
    if (configData.hasOwnProperty('surveys')) {
        chrome.storage.local.set({ 'config': configData }, function () {
            console.log('Config data updated', configData);
        });
    }
    location.reload();
}

function handleFileSelect(evt) {
    let files = evt.target.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) {
        alert('Select only one file!');
    } else {
        let reader = new FileReader();
        reader.onload = function (evt) {
            document.getElementById('import-button').setAttribute('import-data', evt.target.result);
        };
        reader.onerror = function () { alert('Error reading file'); };
        reader.readAsText(files[0]);
    }
}


// ── Utility ───────────────────────────────────────────────
function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


// ═══════════════════════════════════════════════════════════
//  FACTORY RESET
// ═══════════════════════════════════════════════════════════

(function initFactoryReset() {
    let modal = document.getElementById('reset-modal');
    let openBtn = document.getElementById('factory-reset-button');
    let cancelBtn = document.getElementById('reset-cancel');
    let confirmBtn = document.getElementById('reset-confirm');

    if (!modal || !openBtn) return;

    openBtn.addEventListener('click', function () {
        modal.classList.add('visible');
    });

    cancelBtn.addEventListener('click', function () {
        modal.classList.remove('visible');
    });

    // Close on backdrop click
    modal.addEventListener('click', function (e) {
        if (e.target === modal) modal.classList.remove('visible');
    });

    // Close on Escape key
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.classList.contains('visible')) {
            modal.classList.remove('visible');
        }
    });

    confirmBtn.addEventListener('click', function () {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '⏳ Resetting…';

        // Generate a fresh client ID (same algorithm as background.js)
        let clientID = '_' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);

        let initialStorage = {
            "resultsArrays": {
                "x-user": [],
                "x-post": [],
                "instagram-user": [],
                "instagram-post": [],
                "bluesky-post": [],
                "bluesky-user": [],
                "whatsapp-post": []
            },
            "annotatedElements": {
                "x-user": [],
                "x-post": [],
                "instagram-user": [],
                "instagram-post": [],
                "bluesky-post": [],
                "bluesky-user": [],
                "whatsapp-post": []
            },
            "clientID": clientID,
            "config": config,  // default config from config.js
            "theme": "light",
            "isEnabled": true,
            "isGuided": false,
            "isMediaDownloadEnabled": false,
            "isProfileDownloadEnabled": false,
            "isBannerDownloadEnabled": false,
            "activeTargetList": [...config.surveys["x-user"].screenNameList]
        };

        // Load default selectors, then clear & re-initialize storage
        fetch(chrome.runtime.getURL('selectors.json'))
            .then(response => response.json())
            .then(selectors => {
                initialStorage.selectors = selectors;
            })
            .catch(() => {
                initialStorage.selectors = { x: {}, instagram: {}, bluesky: {}, whatsapp: {} };
            })
            .finally(() => {
                chrome.storage.local.clear(function () {
                    chrome.storage.local.set(initialStorage, function () {
                        console.log('Factory reset complete.');
                        location.reload();
                    });
                });
            });
    });
})();
