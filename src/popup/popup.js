'use strict';

// ── Theme ──────────────────────────────────────────────────
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    let icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = theme === 'light' ? '🌙' : '☀️';
}

chrome.storage.local.get(['theme'], function (data) {
    applyTheme(data.theme || 'light');
});

document.getElementById('theme-toggle').addEventListener('click', function () {
    let current = document.documentElement.getAttribute('data-theme') || 'light';
    let next = current === 'dark' ? 'light' : 'dark';
    chrome.storage.local.set({ theme: next }, function () {
        applyTheme(next);
    });
});

// ── Options link ──────────────────────────────────────────
document.getElementById('go-to-options').addEventListener('click', function () {
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open(chrome.runtime.getURL('options.html'));
    }
});

// ── Helpers ───────────────────────────────────────────────
function refresh_page() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.update(tabs[0].id, { url: tabs[0].url });
    });
}

// ── Survey dropdowns ──────────────────────────────────────
let platformDropdownEl = document.getElementById('platform-dropdown');
let platformTrigger    = document.getElementById('platform-trigger');
let platformMenu       = document.getElementById('platform-menu');
let typeDropdownEl     = document.getElementById('type-dropdown');
let typeTrigger        = document.getElementById('type-trigger');
let typeMenu           = document.getElementById('type-menu');

platformTrigger.addEventListener('click', function () {
    platformDropdownEl.classList.toggle('open');
    typeDropdownEl.classList.remove('open');
});
typeTrigger.addEventListener('click', function () {
    typeDropdownEl.classList.toggle('open');
    platformDropdownEl.classList.remove('open');
});
document.addEventListener('click', function (e) {
    if (!platformDropdownEl.contains(e.target)) platformDropdownEl.classList.remove('open');
    if (!typeDropdownEl.contains(e.target)) typeDropdownEl.classList.remove('open');
});

// ── Feed health ───────────────────────────────────────────
function updateHealthStats() {
    let dot = document.getElementById('health-dot');
    let val = document.getElementById('health-value');
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (!tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, { action: 'getHealthStats' }, function (resp) {
            if (chrome.runtime.lastError || !resp) {
                dot.className = 'health-dot health-dot--off';
                val.textContent = 'n/a';
                return;
            }
            let n = resp.processedCount || 0;
            dot.className = 'health-dot ' + (n > 0 ? 'health-dot--ok' : 'health-dot--idle');
            val.textContent = n > 0 ? n + ' seen' : 'idle';
        });
    });
}

// ── Annotation count ──────────────────────────────────────
function updateAnnotationCount() {
    chrome.storage.local.get(['config', 'annotatedElements'], function (data) {
        if (!data || !data.config || !data.config.activeSurveys) return;
        let activeSurvey = data.config.activeSurveys[0];
        let count = (data.annotatedElements && data.annotatedElements[activeSurvey]) ? data.annotatedElements[activeSurvey].length : 0;
        let el = document.getElementById('annotationCount'); if (el) el.textContent = count;
    });
}

// ── Guided panel update ───────────────────────────────────
function updateGuidedPanel() {
    chrome.storage.local.get(['config', 'isGuided', 'activeTargetList', 'annotatedElements'], function (data) {
        if (!data || !data.config || !data.config.activeSurveys) return;
        let panel = document.getElementById('guided-panel');
        let activeSurvey = data.config.activeSurveys[0];
        let survey = data.config.surveys ? data.config.surveys[activeSurvey] : null;
        let fullList = (survey && survey.screenNameList) ? survey.screenNameList : [];
        let remaining = data.activeTargetList || [];

        // Show panel only in guided mode AND when there's an annotation list
        if (data.isGuided && fullList.length > 0) {
            panel.style.display = 'block';

            let total = fullList.length;
            let done = total - remaining.length;
            let pct = total > 0 ? Math.round((done / total) * 100) : 0;

            document.getElementById('guided-done').textContent = done;
            document.getElementById('guided-total').textContent = total;
            document.getElementById('guided-bar').style.width = pct + '%';

            // Current target
            let currentName = remaining.length > 0 ? remaining[0] : '✓ All done!';
            document.getElementById('guided-current-name').textContent = currentName;

            // Figure out position in the full list
            let currentIdx = remaining.length > 0
                ? fullList.findIndex(item => item.toLowerCase() === remaining[0].toLowerCase())
                : -1;

            if (remaining.length > 0 && currentIdx >= 0) {
                document.getElementById('nav-position').textContent = (currentIdx + 1) + ' of ' + total;
            } else if (remaining.length > 0) {
                document.getElementById('nav-position').textContent = (done + 1) + ' of ' + total;
            } else {
                document.getElementById('nav-position').textContent = 'Done';
            }

            // Prev/Next buttons
            let prevBtn = document.getElementById('nav-prev');
            let nextBtn = document.getElementById('nav-next');

            // Prev: go to the item before current in the full list
            if (currentIdx > 0) {
                prevBtn.disabled = false;
                prevBtn.dataset.target = fullList[currentIdx - 1];
            } else {
                prevBtn.disabled = true;
                prevBtn.dataset.target = '';
            }

            // Next: go to the item after current in the full list
            if (currentIdx >= 0 && currentIdx < total - 1) {
                nextBtn.disabled = false;
                nextBtn.dataset.target = fullList[currentIdx + 1];
            } else if (remaining.length > 1) {
                nextBtn.disabled = false;
                nextBtn.dataset.target = remaining[1];
            } else {
                nextBtn.disabled = true;
                nextBtn.dataset.target = '';
            }
        } else {
            panel.style.display = 'none';
        }
    });
}

// ── Navigate annotation list ──────────────────────────────
function navigateToTarget(target) {
    if (!target) return;

    chrome.storage.local.get(['config', 'activeTargetList'], function (data) {
        let activeSurvey = data.config.activeSurveys[0];
        let survey = data.config.surveys[activeSurvey];
        let platform = survey ? survey.socialMediaPlatform : 'twitter';

        // Rebuild activeTargetList starting from this target
        let fullList = (survey && survey.screenNameList) ? survey.screenNameList : [];
        let targetIdx = fullList.findIndex(item => item.toLowerCase() === target.toLowerCase());

        if (targetIdx >= 0) {
            // Set activeTargetList to everything from this target onwards (minus already annotated)
            chrome.storage.local.get(['annotatedElements'], function (aeData) {
                let annotated = aeData.annotatedElements[activeSurvey] || [];
                let newList = fullList.slice(targetIdx).filter(item => {
                    return !annotated.some(a => a.toLowerCase() === item.toLowerCase());
                });
                // Always ensure the target itself is at the front
                if (newList.length === 0 || newList[0].toLowerCase() !== target.toLowerCase()) {
                    newList.unshift(target);
                }

                chrome.storage.local.set({ 'activeTargetList': newList }, function () {
                    // Navigate browser tab
                    let baseUrl;
                    if (activeSurvey === 'x-post') {
                        baseUrl = 'https://x.com/i/web/status/';
                    } else if (platform === 'instagram') {
                        baseUrl = 'https://www.instagram.com/';
                    } else if (activeSurvey === 'bluesky-post') {
                        baseUrl = 'https://bsky.app/profile/';
                    } else if (activeSurvey === 'bluesky-user') {
                        baseUrl = 'https://bsky.app/profile/';
                    } else if (platform === 'tiktok') {
                        baseUrl = 'https://www.tiktok.com/@';
                    } else {
                        baseUrl = 'https://x.com/';
                    }

                    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                        chrome.tabs.update(tabs[0].id, { url: baseUrl + target.replace(/^\/+/, '') });
                    });

                    updateGuidedPanel();
                });
            });
        }
    });
}

document.getElementById('nav-prev').addEventListener('click', function () {
    if (!this.disabled && this.dataset.target) {
        navigateToTarget(this.dataset.target);
    }
});

document.getElementById('nav-next').addEventListener('click', function () {
    if (!this.disabled && this.dataset.target) {
        navigateToTarget(this.dataset.target);
    }
});

// ── Populate dropdowns ────────────────────────────────────
var SURVEY_GROUPS = [
    { label: 'X',           keys: ['x-user', 'x-post'] },
    { label: 'Bluesky',     keys: ['bluesky-user', 'bluesky-post'] },
    { label: 'Mastodon',    keys: ['mastodon-user', 'mastodon-post'] },
    { label: 'TruthSocial', keys: ['truthsocial-user', 'truthsocial-post'] },
    { label: 'Instagram',   keys: ['instagram-user', 'instagram-post', 'instagram-reel', 'instagram-comment'] },
    { label: 'TikTok',      keys: ['tiktok-user', 'tiktok-reel'] },
    { label: 'Facebook',    keys: ['facebook-user', 'facebook-post'] },
    { label: 'Telegram',    keys: ['telegram-post'] },
    { label: 'WhatsApp',    keys: ['whatsapp-post'] },
    { label: 'YouTube',     keys: ['youtube-user', 'youtube-video', 'youtube-comment'] },
    { label: 'Reddit',      keys: ['reddit-user', 'reddit-post', 'reddit-comment'] },
    { label: 'LinkedIn',    keys: ['linkedin-user', 'linkedin-post'] },
];

function getTypeLabel(surveyKey, group) {
    let prefix = group.keys[0].slice(0, group.keys[0].lastIndexOf('-') + 1);
    return surveyKey.startsWith(prefix) ? surveyKey.slice(prefix.length) : surveyKey;
}

var _surveysConfig = {};
var _activeGroup = null;

function selectSurvey(surveyKey) {
    if (!_activeGroup) return;
    document.getElementById('type-id').textContent = getTypeLabel(surveyKey, _activeGroup);
    typeMenu.querySelectorAll('li').forEach(l => l.classList.remove('active'));
    let li = typeMenu.querySelector('li[data-key="' + surveyKey + '"]');
    if (li) li.classList.add('active');

    chrome.storage.local.get('config', function (d) {
        d.config.activeSurveys = [surveyKey];
        let newTargetList = d.config.surveys[surveyKey] && d.config.surveys[surveyKey].screenNameList
            ? [...d.config.surveys[surveyKey].screenNameList] : [];
        chrome.storage.local.set({
            'config': d.config,
            'activeTargetList': newTargetList
        }, function () {
            updateAnnotationCount();
            updateGuidedPanel();
            updateMediaToggles(surveyKey);
            refresh_page();
        });
    });
}

function populateTypeMenu(group, surveys, activeSurvey) {
    typeMenu.innerHTML = '';
    group.keys.filter(k => surveys[k]).forEach(function (key) {
        let li = document.createElement('li');
        li.textContent = getTypeLabel(key, group);
        li.dataset.key = key;
        if (key === activeSurvey) li.classList.add('active');
        li.addEventListener('click', function () {
            typeDropdownEl.classList.remove('open');
            selectSurvey(this.dataset.key);
        });
        typeMenu.appendChild(li);
    });
}

chrome.storage.local.get('config', function (data) {
    if (!data || !data.config || !data.config.surveys) return;
    _surveysConfig = data.config.surveys;
    let activeSurvey = data.config.activeSurveys[0];

    SURVEY_GROUPS.forEach(function (group) {
        let groupKeys = group.keys.filter(k => _surveysConfig[k]);
        if (groupKeys.length === 0) return;

        let li = document.createElement('li');
        li.textContent = group.label;
        li.dataset.label = group.label;
        li.addEventListener('click', function () {
            _activeGroup = group;
            document.getElementById('platform-id').textContent = group.label;
            platformMenu.querySelectorAll('li').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            platformDropdownEl.classList.remove('open');

            let firstKey = group.keys.find(k => _surveysConfig[k]);
            populateTypeMenu(group, _surveysConfig, null);
            if (firstKey) selectSurvey(firstKey);
        });
        platformMenu.appendChild(li);
    });

    let activeGroup = SURVEY_GROUPS.find(g => g.keys.includes(activeSurvey));
    if (activeGroup) {
        _activeGroup = activeGroup;
        document.getElementById('platform-id').textContent = activeGroup.label;
        platformMenu.querySelectorAll('li').forEach(function (li) {
            if (li.dataset.label === activeGroup.label) li.classList.add('active');
        });
        populateTypeMenu(activeGroup, _surveysConfig, activeSurvey);
        document.getElementById('type-id').textContent = getTypeLabel(activeSurvey, activeGroup);
    }

    updateAnnotationCount();
    updateGuidedPanel();
    updateMediaToggles(activeSurvey);
    updateHealthStats();
});

// ── Enable/Disable toggle ─────────────────────────────────
let toggleEnabled = document.getElementById('toggleEnabled');
let statusText = document.getElementById('status-text');

chrome.storage.local.get(['isEnabled'], function (data) {
    let enabled = data.isEnabled !== false;
    toggleEnabled.checked = enabled;
    statusText.textContent = enabled ? 'Enabled' : 'Disabled';
    statusText.style.color = enabled ? 'var(--green)' : 'var(--danger)';
});

toggleEnabled.addEventListener('change', function () {
    let enabled = this.checked;
    chrome.storage.local.set({ 'isEnabled': enabled }, function () {
        statusText.textContent = enabled ? 'Enabled' : 'Disabled';
        statusText.style.color = enabled ? 'var(--green)' : 'var(--danger)';
        refresh_page();
    });
});

// ── Guided mode toggle ────────────────────────────────────
let toggleGuided = document.getElementById('toggleGuidedMode');

chrome.storage.local.get(['isGuided'], function (data) {
    toggleGuided.checked = data.isGuided === true;
});

toggleGuided.addEventListener('change', function () {
    chrome.storage.local.set({ 'isGuided': toggleGuided.checked }, function () {
        updateGuidedPanel();
        if (toggleGuided.checked) {
            chrome.storage.local.get(['activeTargetList'], function (data) {
                let remaining = data.activeTargetList || [];
                if (remaining.length > 0) navigateToTarget(remaining[0]);
            });
        }
    });
});

// ── Media toggle visibility ───────────────────────────────
function updateMediaToggles(surveyName) {
    let isUserSurvey = surveyName && surveyName.endsWith('-user');
    document.getElementById('post-media-toggles').style.display = isUserSurvey ? 'none' : 'flex';
    document.getElementById('user-media-toggles').style.display = isUserSurvey ? 'flex' : 'none';
}

// ── Media download toggle ─────────────────────────────────
let toggleMediaDownload = document.getElementById('toggleMediaDownload');
let toggleProfileDownload = document.getElementById('toggleProfileDownload');
let toggleBannerDownload = document.getElementById('toggleBannerDownload');

chrome.storage.local.get(['isMediaDownloadEnabled', 'isProfileDownloadEnabled', 'isBannerDownloadEnabled'], function (data) {
    toggleMediaDownload.checked = data.isMediaDownloadEnabled === true;
    toggleProfileDownload.checked = data.isProfileDownloadEnabled === true;
    toggleBannerDownload.checked = data.isBannerDownloadEnabled === true;
});

toggleMediaDownload.addEventListener('change', function () {
    chrome.storage.local.set({ 'isMediaDownloadEnabled': toggleMediaDownload.checked });
});

toggleProfileDownload.addEventListener('change', function () {
    chrome.storage.local.set({ 'isProfileDownloadEnabled': toggleProfileDownload.checked });
});

toggleBannerDownload.addEventListener('change', function () {
    chrome.storage.local.set({ 'isBannerDownloadEnabled': toggleBannerDownload.checked });
});

// ── Export ─────────────────────────────────────────────────
document.getElementById('exportLink').addEventListener('click', function () {
    chrome.storage.local.get(['resultsArrays', 'config'], function (data) {
        let activeSurvey = data.config.activeSurveys[0];
        if (data.resultsArrays && data.resultsArrays[activeSurvey]) {
            let filteredResults = {};
            filteredResults[activeSurvey] = data.resultsArrays[activeSurvey];
            exportStoredResults(filteredResults, data.config);
        }
    });
});

function exportDatetime() {
    let d = new Date();
    let pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function exportStoredResults(resultArrays, config) {
    let dt = exportDatetime();
    let baseRoot = (config && config.downloadFolder && config.downloadFolder.trim())
        ? config.downloadFolder.trim().replace(/\\/g, '/')
        : 'SocialAnnotateExports';
    if (!baseRoot.endsWith('/')) baseRoot += '/';
    for (let surveyType in resultArrays) {
        if (resultArrays.hasOwnProperty(surveyType)) {
            let filedata = objectList2jsonl(resultArrays[surveyType]);
            let platform = surveyType.substring(0, surveyType.lastIndexOf('-')) || surveyType;
            let safeSurveyType = surveyType.replace(/-/g, '_');
            let filename = `${baseRoot}${platform}/${surveyType}/annotations_${safeSurveyType}_${dt}.jsonl`;
            chrome.runtime.sendMessage({ action: 'exportAnnotations', data: filedata, filename });
        }
    }
}

function objectList2jsonl(items) {
    let jsonl = '';
    for (let row = 0; row < items.length; row++) {
        jsonl += JSON.stringify(items[row]) + '\n';
    }
    return jsonl;
}

// ── Debug ──────────────────────────────────────────────────
document.getElementById('debugCapture').addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (!tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, { action: 'debugCapture' }, function (payload) {
            if (chrome.runtime.lastError || !payload) {
                renderDebugError(chrome.runtime.lastError && chrome.runtime.lastError.message);
                return;
            }
            renderDebugPayload(payload);
        });
    });
});

function renderDebugPayload(payload) {
    window.__debugPayload = payload;

    let meta = document.getElementById('debug-meta');
    let st = payload.storage || {};
    let urlShort = (payload.url || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 40) || payload.url;
    meta.innerHTML =
        '<span>platform:</span> ' + (payload.platform || '—') +
        ' &nbsp;•&nbsp; <span>survey:</span> ' + (payload.surveyType || '—') +
        '<br><span>enabled:</span> ' + (st.isEnabled !== undefined ? st.isEnabled : '—') +
        ' &nbsp;•&nbsp; <span>url:</span> ' + urlShort;

    let tbody = document.getElementById('debug-tbody');
    tbody.innerHTML = '';

    let diagnostics = payload.selectorDiagnostics || [];
    if (diagnostics.length === 0) {
        let tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="3" style="padding:10px 18px;color:var(--text-3);">No diagnostics returned (platform not recognized on this page).</td>';
        tbody.appendChild(tr);
    }
    diagnostics.forEach(function (d) {
        let tr = document.createElement('tr');
        let isWarn = d.note === 'not in selectors.json';
        let isFail = !isWarn && !d.matched;
        let isOk   = !isWarn && d.matched;
        tr.className = isWarn ? 'debug-row--warn' : (isFail ? 'debug-row--fail' : 'debug-row--ok');

        let icon = isWarn ? '⚠' : (isOk ? '✓' : '✕');
        let displayVal = isWarn ? 'not configured' : (d.value ? String(d.value).slice(0, 60) : '—');

        tr.innerHTML =
            '<td>' + d.field + '</td>' +
            '<td style="text-align:center;">' + icon + '</td>' +
            '<td title="' + (d.value || '').replace(/"/g, '&quot;') + '">' + displayVal + '</td>';
        tbody.appendChild(tr);
    });

    document.getElementById('debug-panel').style.display = 'block';
}

function renderDebugError(msg) {
    window.__debugPayload = null;
    let tbody = document.getElementById('debug-tbody');
    tbody.innerHTML = '';
    document.getElementById('debug-meta').innerHTML =
        '<span class="debug-error">Could not reach content script. Make sure you are on a supported page and the extension is enabled.</span>';
    document.getElementById('debug-panel').style.display = 'block';
}

document.getElementById('debug-copy').addEventListener('click', function () {
    if (window.__debugPayload) {
        navigator.clipboard.writeText(JSON.stringify(window.__debugPayload, null, 2));
    }
});

document.getElementById('debug-close').addEventListener('click', function () {
    document.getElementById('debug-panel').style.display = 'none';
});
