'use strict';

// ── Theme ──────────────────────────────────────────────────
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    let icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = theme === 'light' ? '🌙' : '☀️';
}

chrome.storage.local.get(['theme'], function (data) {
    applyTheme(data.theme || 'dark');
});

document.getElementById('theme-toggle').addEventListener('click', function () {
    let current = document.documentElement.getAttribute('data-theme') || 'dark';
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

// ── Custom dropdown ───────────────────────────────────────
let dropdownEl = document.getElementById('survey-dropdown');
let triggerBtn = document.getElementById('dropdown-trigger');
let menuList = document.getElementById('dropdown-menu');

triggerBtn.addEventListener('click', function () {
    dropdownEl.classList.toggle('open');
});

// Close dropdown when clicking outside
document.addEventListener('click', function (e) {
    if (!dropdownEl.contains(e.target)) {
        dropdownEl.classList.remove('open');
    }
});

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
                    } else {
                        baseUrl = 'https://x.com/';
                    }

                    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                        chrome.tabs.update(tabs[0].id, { url: baseUrl + target });
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

// ── Populate dropdown ─────────────────────────────────────
chrome.storage.local.get('config', function (data) {
    if (!data || !data.config || !data.config.surveys) return;
    for (let key in data.config.surveys) {
        let li = document.createElement('li');
        li.textContent = key;
        li.dataset.key = key;

        li.addEventListener('click', function () {
            let chosenSurvey = this.dataset.key;
            document.getElementById('survey-id').textContent = chosenSurvey;
            dropdownEl.classList.remove('open');

            // Mark active
            menuList.querySelectorAll('li').forEach(l => l.classList.remove('active'));
            this.classList.add('active');

            // Update stored config
            chrome.storage.local.get('config', function (d) {
                d.config.activeSurveys = [chosenSurvey];
                let newTargetList = d.config.surveys[chosenSurvey] && d.config.surveys[chosenSurvey].screenNameList
                    ? [...d.config.surveys[chosenSurvey].screenNameList] : [];

                chrome.storage.local.set({
                    'config': d.config,
                    'activeTargetList': newTargetList
                }, function () {
                    updateAnnotationCount();
                    updateGuidedPanel();
                    updateMediaToggles(chosenSurvey);
                    refresh_page();
                });
            });
        });

        menuList.appendChild(li);
    }

    // Set the default active survey
    let activeSurvey = data.config.activeSurveys[0];
    document.getElementById('survey-id').textContent = activeSurvey;

    // Mark the active item in dropdown
    menuList.querySelectorAll('li').forEach(li => {
        if (li.dataset.key === activeSurvey) li.classList.add('active');
    });

    updateAnnotationCount();
    updateGuidedPanel();
    updateMediaToggles(activeSurvey);
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
            exportStoredResults(filteredResults);
        }
    });
});

function exportStoredResults(resultArrays) {
    for (let surveyType in resultArrays) {
        if (resultArrays.hasOwnProperty(surveyType)) {
            let filedata = objectList2jsonl(resultArrays[surveyType]);
            let fileName = 'annotations-' + surveyType + '.jsonl';
            fileName = fileName.replace(/-/g, '_');
            let url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(filedata);
            chrome.downloads.download({
                url: url,
                filename: fileName
            });
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
