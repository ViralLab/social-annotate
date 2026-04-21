// ── Tab navigation ────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        document.getElementById('tab-' + this.dataset.tab).classList.add('active');
    });
});

// ── Page init ─────────────────────────────────────────────
$('#save-button').click(saveOptionsPage);
$('#export-button').click(exportOptions);
document.getElementById('upload-file').addEventListener('change', handleFileSelect, false);
$('#import-button').click(importOptions);

loadPage();

// ── Load ──────────────────────────────────────────────────
// @TODO handle clientID in the forms (make it editable)
function loadPage() {
    chrome.storage.local.get(['config', 'isEnabled', 'clientID'], function (result) {
        document.getElementById('api-endpoint').value = result.config.apiEndpoint;

        let html = '';
        for (let key in result.config.surveys) {
            let survey = result.config.surveys[key];
            html += buildSurveyCard(key, survey);
        }
        document.getElementById('survey-container').innerHTML = html;

        // Wire collapse toggles
        document.querySelectorAll('.card-header').forEach(header => {
            header.addEventListener('click', function (e) {
                if (e.target.closest('.btn-preview')) return;
                this.closest('.survey-card').classList.toggle('expanded');
            });
        });

        // Wire preview buttons (inline onclick blocked by extension CSP)
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

        // Populate field values
        for (let key in result.config.surveys) {
            let survey = result.config.surveys[key];
            if (survey.hasOwnProperty('injectElement')) {
                document.getElementById(key + '_insert-location').value = survey.injectElement.name || '';
            }
            if (survey.hasOwnProperty('screenNameList')) {
                let listArr = Array.isArray(survey.screenNameList) ? survey.screenNameList : [];
                document.getElementById(key + '_annotation-list').value = listArr.join(',\n');
            }
            if (survey.hasOwnProperty('surveyFormSchema')) {
                document.getElementById(key + '_form-template').value = JSON.stringify(survey.surveyFormSchema, null, '\t');
            }
        }
    });
}

function buildSurveyCard(key, survey) {
    let platform = survey.socialMediaPlatform || 'twitter';
    return `
    <div class="survey-card" id="card_${key}">
      <div class="card-header">
        <div class="card-header-left">
          <img src="../images/${platform}.png" class="platform-icon" alt="${platform}">
          <span class="survey-name">${key}</span>
          <span class="platform-badge">${platform}</span>
        </div>
        <span class="card-toggle">▾</span>
      </div>
      <div class="card-body">
        <div class="field-group">
          <label class="field-label" for="${key}_insert-location">Insert Location</label>
          <input type="text" class="field-input" id="${key}_insert-location" placeholder="HTML element name">
        </div>
        <div class="field-group">
          <label class="field-label" for="${key}_form-template">
            Form Template (JSON)
            <a href="https://jsonform.github.io/jsonform/playground/index.html" target="_blank" class="about-link" style="font-size:11px; font-weight:400; margin-left:8px;">Validate ↗</a>
          </label>
          <textarea id="${key}_form-template" class="field-textarea" rows="10" spellcheck="false"></textarea>
          <div class="json-error" id="${key}_json-error"></div>
        </div>
        <div class="field-group">
          <label class="field-label" for="${key}_annotation-list">
            Annotation List
            <span class="field-hint">Comma-separated usernames or tweet IDs</span>
          </label>
          <textarea id="${key}_annotation-list" class="field-textarea" rows="3" spellcheck="false"></textarea>
        </div>
        <div class="card-actions">
          <button class="btn-preview" data-key="${key}">▶ Preview Survey</button>
        </div>
      </div>
      <div class="preview-panel" id="${key}_preview-panel" style="display:none;">
        <div class="preview-panel-header">
          <span class="preview-panel-title">
            <span class="preview-dot"></span> Live Preview
          </span>
          <button class="btn-close-preview" data-key="${key}">✕ Close</button>
        </div>
        <div class="preview-body" id="${key}_preview-body"></div>
      </div>
    </div>`;
}

// ── Live Survey Preview ───────────────────────────────────
function previewSurvey(key) {
    let textareaEl = document.getElementById(key + '_form-template');
    let errorEl = document.getElementById(key + '_json-error');
    let previewPanel = document.getElementById(key + '_preview-panel');
    let previewBody = document.getElementById(key + '_preview-body');

    // Validate JSON first
    let formTemplate;
    try {
        formTemplate = JSON.parse(textareaEl.value);
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    } catch (e) {
        errorEl.style.display = 'block';
        errorEl.textContent = '✕ Invalid JSON: ' + e.message;
        return;
    }

    // Show the panel and expand the card
    let card = document.getElementById('card_' + key);
    card.classList.add('expanded');
    previewPanel.style.display = 'block';

    // Clear any existing iframe and rebuild
    previewBody.innerHTML = '';
    let iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('sandbox/survey.html');
    iframe.style.cssText = 'border:none; width:100%; min-height:280px; background:transparent;';

    // Determine the platform CSS to style the rendered form
    let platform = key.startsWith('instagram') ? 'instagram' : 'twitter';
    let cssUrl = chrome.runtime.getURL('content-scripts/' + platform + '/inject.css');

    iframe.onload = function () {
        iframe.contentWindow.postMessage({
            type: 'render',
            cssUrl: cssUrl,
            formTemplate: formTemplate,
            callId: 'preview-' + key,
            surveyType: key
        }, '*');
    };

    previewBody.appendChild(iframe);
    // Scroll preview into view smoothly
    previewPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closePreview(key) {
    document.getElementById(key + '_preview-panel').style.display = 'none';
    document.getElementById(key + '_preview-body').innerHTML = '';
}

// ── Save ──────────────────────────────────────────────────
function saveOptionsPage() {
    chrome.storage.local.get(['config'], function (result) {
        let configData = result.config;
        configData.apiEndpoint = document.getElementById('api-endpoint').value;

        for (let key in configData.surveys) {
            let survey = configData.surveys[key];
            if (survey.hasOwnProperty('injectElement')) {
                configData.surveys[key].injectElement.name = document.getElementById(key + '_insert-location').value;
            }
            if (survey.hasOwnProperty('screenNameList')) {
                let valStr = document.getElementById(key + '_annotation-list').value;
                configData.surveys[key].screenNameList = valStr.split(',').map(s => s.trim()).filter(s => s);
            }
            if (survey.hasOwnProperty('surveyFormSchema')) {
                try {
                    configData.surveys[key].surveyFormSchema = JSON.parse(document.getElementById(key + '_form-template').value);
                } catch (e) {
                    alert('Invalid JSON in form template for "' + key + '": ' + e.message);
                    return;
                }
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

// ── Export ────────────────────────────────────────────────
function exportOptions() {
    chrome.storage.local.get(['config'], function (result) {
        let url = 'data:text/plain;charset=utf-8,' + JSON.stringify(result.config, null, '\t');
        chrome.downloads.download({ url: url, filename: 'config.json' });
    });
}

// ── Import ────────────────────────────────────────────────
function importOptions() {
    let input = document.getElementById('import-button');
    let configData = JSON.parse(input.getAttribute('import-data'));
    if (configData.hasOwnProperty('surveys')) {
        chrome.storage.local.set({ 'config': configData }, function () {
            console.log('Config data updated', configData);
        });
    }
    location.reload();
}

function handleFileSelect(evt) {
    let files = evt.target.files;
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
