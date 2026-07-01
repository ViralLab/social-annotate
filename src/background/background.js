// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

importScripts('../config.js');

// Keyed by random key embedded in download URL fragment (#sa_fn=KEY).
// Lets onDeterminingFilename set the path reliably, bypassing Chrome's
// silent rejection of subdirectory paths in the downloads.download filename param.
const pendingFilenames = {};

chrome.runtime.onInstalled.addListener(function () {

    let clientID = crypto.randomUUID();

    let initialStorage = {
        "resultsArrays": {
            "x-user": [],
            "x-post": [],
            "instagram-user": [],
            "instagram-post": [],
            "instagram-reel": [],
            "instagram-comment": [],
            "bluesky-post": [],
            "bluesky-user": [],
            "whatsapp-post": [],
            "mastodon-post": [],
            "mastodon-user": [],
            "youtube-video": [],
            "youtube-user": []
        },  // @TODO pull these from a supported types list somewhere.
        "annotatedElements": {
            "x-user": [],
            "x-post": [],
            "instagram-user": [],
            "instagram-post": [],
            "instagram-reel": [],
            "instagram-comment": [],
            "bluesky-post": [],
            "bluesky-user": [],
            "whatsapp-post": [],
            "mastodon-post": [],
            "mastodon-user": [],
            "youtube-video": [],
            "youtube-user": []
        }, // @TODO pull these from a supported types list somewhere.
        "clientID": clientID,
        "config": config,
        "theme": "light",
        "isEnabled": true,
        "isGuided": false,
        "isMediaDownloadEnabled": false,
        "isProfileDownloadEnabled": false,
        "isBannerDownloadEnabled": false,
        "activeTargetList": [...config.surveys["x-user"].screenNameList]  // clone the array, keep the initial list for future reference.
    };

    // Load default selectors from selectors.json and store them.
    fetch(chrome.runtime.getURL('selectors.json'))
        .then(response => response.json())
        .then(selectors => {
            initialStorage.selectors = selectors;
            chrome.storage.local.set(initialStorage, function () {
                console.log('Storage arrays and selectors initialized.');
            });
        })
        .catch(err => {
            console.error('Failed to load selectors.json, using empty defaults:', err);
            initialStorage.selectors = { x: {}, instagram: {}, bluesky: {}, whatsapp: {} };
            chrome.storage.local.set(initialStorage, function () {
                console.log('Storage arrays initialized (without selectors).');
            });
        });
});


// ── Merge new survey types into stored config ──────────────────────────────
// Runs on every service-worker start so new surveys added to config.js are
// available without clearing storage.
function mergeSurveysIntoStorage() {
    chrome.storage.local.get(['config', 'resultsArrays', 'annotatedElements', 'selectors'], function (stored) {
        if (!stored.config) return; // first-run handled by onInstalled

        let changed = false;

        // 1. Merge missing survey definitions
        for (let key in config.surveys) {
            if (!stored.config.surveys[key]) {
                stored.config.surveys[key] = config.surveys[key];
                changed = true;
                console.log('[SA] Migrated new survey into storage:', key);
            }
        }

        // 2. Ensure resultsArrays and annotatedElements have entries for all surveys
        let ra = stored.resultsArrays || {};
        let ae = stored.annotatedElements || {};
        for (let key in config.surveys) {
            if (!ra[key]) { ra[key] = []; changed = true; }
            if (!ae[key]) { ae[key] = []; changed = true; }
        }

        // 3. Always re-sync selectors from selectors.json so healer patches are picked up on reload
        fetch(chrome.runtime.getURL('selectors.json'))
            .then(r => r.json())
            .then(selectors => {
                chrome.storage.local.set({
                    config: stored.config,
                    resultsArrays: ra,
                    annotatedElements: ae,
                    selectors: selectors
                });
            })
            .catch(() => {
                if (changed) {
                    chrome.storage.local.set({
                        config: stored.config,
                        resultsArrays: ra,
                        annotatedElements: ae
                    });
                }
            });
    });
}

// Run migration on every extension start (handles dev reloads)
chrome.runtime.onInstalled.addListener(mergeSurveysIntoStorage);
chrome.runtime.onStartup.addListener(mergeSurveysIntoStorage);

chrome.webNavigation.onHistoryStateUpdated.addListener(function (details) {
});

// Intercept downloads to apply our folder/filename scheme reliably.
// Using onDeterminingFilename instead of the filename param in downloads.download
// because Chrome silently drops subdirectory paths in the filename param on some
// versions/OS combinations, falling back to the URL-derived name.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    // Our downloads (media + export) embed a key in the URL fragment: #sa_fn=KEY
    if (item.url) {
        let idx = item.url.lastIndexOf('#sa_fn=');
        if (idx !== -1) {
            let key = item.url.substring(idx + 7);
            if (pendingFilenames[key]) {
                let filename = pendingFilenames[key];
                delete pendingFilenames[key];
                suggest({ filename });
            } else {
                suggest();
            }
            return; // suggest called synchronously
        }
    }

    // TikTok blob downloads: key is embedded in the suggested filename as tiktok__KEY__
    if (item.filename && item.filename.startsWith('tiktok__')) {
        let m = item.filename.match(/^tiktok__([a-z0-9]+)__/);
        if (m && pendingFilenames[m[1]]) {
            let filename = pendingFilenames[m[1]];
            delete pendingFilenames[m[1]];
            suggest({ filename });
            return;
        }
    }

    // Facebook MediaRecorder blob downloads: key embedded as facebook__KEY__
    if (item.filename && item.filename.startsWith('facebook__')) {
        let m = item.filename.match(/^facebook__([a-z0-9]+)__/);
        if (m && pendingFilenames[m[1]]) {
            let filename = pendingFilenames[m[1]];
            delete pendingFilenames[m[1]];
            suggest({ filename });
            return;
        }
    }

    // Telegram stream downloads embed metadata in the URL hash (#sa_post=...)
    if (item.url && item.url.includes('#sa_post=')) {
        try {
            let urlObj = new URL(item.url);
            let params = new URLSearchParams(urlObj.hash.substring(1));
            let surveyType = params.get('sa_type') || 'telegram-post';
            let userId = params.get('sa_user') || 'user';
            let postId = params.get('sa_post') || 'unknown';
            let format = params.get('sa_format') || 'mp4';

            let safeUserId = String(userId).replace(/[^a-zA-Z0-9._-]/g, '_');
            let safePostId = String(postId).replace(/[^a-zA-Z0-9._-]/g, '_');

            chrome.storage.local.get(['config'], function (result) {
                let platform = surveyType.substring(0, surveyType.lastIndexOf('-')) || surveyType;
                let baseRoot = (result.config && result.config.downloadFolder && result.config.downloadFolder.trim())
                    ? result.config.downloadFolder.trim().replace(/\\/g, '/')
                    : 'SocialAnnotateExports';
                if (!baseRoot.endsWith('/')) baseRoot += '/';
                let rootFolder = `${baseRoot}${platform}/${surveyType}/media/`;
                suggest({ filename: `${rootFolder}videos/${safeUserId}_${safePostId}_video.${format}` });
            });
            return true; // async suggest
        } catch (e) {
            console.error('[Social Annotate] Error renaming intercepted download:', e);
            suggest();
        }
    } else {
        suggest();
    }
});

// Listen for download requests from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'downloadMedia') {
        const urls = message.urls;
        const userId = message.userId || 'unknown';
        const postId = message.postId || 'unknown';
        const surveyType = message.surveyType || 'x-post';

        chrome.storage.local.get(['config'], function (result) {
            let platform = surveyType.substring(0, surveyType.lastIndexOf('-')) || surveyType;
            let baseRoot = (result.config && result.config.downloadFolder && result.config.downloadFolder.trim())
                ? result.config.downloadFolder.trim().replace(/\\/g, '/')
                : 'SocialAnnotateExports';
            if (!baseRoot.endsWith('/')) baseRoot += '/';
            let rootFolder = `${baseRoot}${platform}/${surveyType}/media/`;

            urls.forEach((url, index) => {
                let format = 'jpg';
                let cleanUrl = url.split('?')[0];
                let mediaToken = null;

                try {
                    if (url.startsWith('data:')) {
                        let mimeMatch = url.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.]+);/);
                        if (mimeMatch) {
                            let mimeType = mimeMatch[1].toLowerCase();
                            if (mimeType.includes('mp4'))        format = 'mp4';
                            else if (mimeType.includes('webm'))  format = 'webm';
                            else if (mimeType.includes('jpeg'))  format = 'jpg';
                            else if (mimeType.includes('png'))   format = 'png';
                            else if (mimeType.includes('gif'))   format = 'gif';
                            else if (mimeType.includes('webp'))  format = 'webp';
                            else if (mimeType.startsWith('video/')) format = 'mp4';  // mp2t, ogg, etc.
                            else if (mimeType.startsWith('audio/')) format = 'mp3';
                        }
                    } else {
                        let urlObj = new URL(url);
                        if (urlObj.searchParams.has('format')) {
                            format = urlObj.searchParams.get('format');
                        } else {
                            let ext = cleanUrl.split('.').pop();
                            if (['jpg', 'jpeg', 'png', 'gif', 'mp4', 'webp', 'webm'].includes(ext.toLowerCase())) {
                                format = ext;
                            }
                        }
                        // TikTok CDN URLs have no extension — parse mime_type query param instead
                        if (urlObj.searchParams.has('mime_type')) {
                            let mt = urlObj.searchParams.get('mime_type').toLowerCase();
                            if (mt.includes('mp4')) format = 'mp4';
                            else if (mt.includes('webm')) format = 'webm';
                            else if (mt.startsWith('video')) format = 'mp4';
                        }

                        // Build a stable media token from path to help trace files back to content.
                        let pathParts = urlObj.pathname.split('/').filter(Boolean);
                        if (pathParts.length > 0) {
                            let last = pathParts[pathParts.length - 1];
                            mediaToken = last.replace(/\.[a-zA-Z0-9]+$/, '');
                        }
                    }
                } catch (e) { }

                // Determine subfolder based on media type and survey context
                let typeSubfolder = "others/";
                const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
                const videoExtensions = ['mp4', 'webm', 'mov', 'avi'];

                const isUserSurvey = surveyType.endsWith('-user');

                if (isUserSurvey) {
                    if (postId === 'profile') {
                        typeSubfolder = "profile_pictures/";
                    } else if (postId === 'banner') {
                        typeSubfolder = "profile_banner/";
                    } else if (imageExtensions.includes(format.toLowerCase())) {
                        typeSubfolder = "pictures/";
                    } else if (videoExtensions.includes(format.toLowerCase())) {
                        typeSubfolder = "videos/";
                    }
                } else {
                    if (imageExtensions.includes(format.toLowerCase())) {
                        typeSubfolder = "pictures/";
                    } else if (videoExtensions.includes(format.toLowerCase())) {
                        typeSubfolder = "videos/";
                    }
                }

                // Keep filenames content-linkable: user + post + index/token.
                // For multi-media posts always enumerate (1, 2, …) so filenames are clean.
                // For single-media posts keep the CDN token for traceability.
                let safeUserId = String(userId).replace(/[^a-zA-Z0-9._-]/g, '_');
                let safePostId = String(postId).replace(/[^a-zA-Z0-9._-]/g, '_');
                let safeToken = (urls.length > 1)
                    ? String(index + 1)
                    : (mediaToken ? String(mediaToken).replace(/[^a-zA-Z0-9._-]/g, '_') : '1');
                const filename = `${rootFolder}${typeSubfolder}${safeUserId}_${safePostId}_${safeToken}.${format}`;

                // Embed a key in the URL fragment so onDeterminingFilename can set the path.
                let key = Math.random().toString(36).substr(2, 9);
                pendingFilenames[key] = filename;
                let dlUrl = url + (url.includes('#') ? '&sa_fn=' : '#sa_fn=') + key;
                chrome.downloads.download({ url: dlUrl }, function(downloadId) {
                    if (chrome.runtime.lastError) {
                        console.error('Download failed:', chrome.runtime.lastError.message, url);
                        delete pendingFilenames[key];
                    } else {
                        console.log('Download started, id=', downloadId, 'file:', filename);
                    }
                });
            });
            sendResponse({ status: "started" });
        });
    }
    else if (message.action === 'fetchReelUrl') {
        // Fallback for reels whose CDN URL was never intercepted by inject-api.js.
        // Fetches the reel page with the user's session cookies and extracts og:video.
        const shortcode = message.shortcode;
        (async () => {
            try {
                console.log('[SA-BG] fetchReelUrl start | shortcode:', shortcode);
                const res = await fetch(`https://www.instagram.com/reel/${shortcode}/`, {
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    },
                    credentials: 'include',
                });
                const html = await res.text();
                // og:video appears as: property="og:video" content="URL" or reversed
                const m = html.match(/property="og:video"\s+content="([^"]+)"|content="([^"]+)"\s+property="og:video"/);
                const videoUrl = m && (m[1] || m[2]);
                if (videoUrl) {
                    console.log('[SA-BG] fetchReelUrl found og:video | shortcode:', shortcode);
                    sendResponse({ url: videoUrl });
                } else {
                    console.warn('[SA-BG] fetchReelUrl: og:video not found | shortcode:', shortcode);
                    sendResponse({ error: 'og:video not found' });
                }
            } catch (e) {
                console.error('[SA-BG] fetchReelUrl error:', e.message);
                sendResponse({ error: String(e) });
            }
        })();
        return true; // keep channel open for async sendResponse
    }
    else if (message.action === 'registerTikTokDownload') {
        // Pre-register an organized filename so onDeterminingFilename can route the
        // anchor-triggered download (from page context) into the right subfolder.
        let key = message.key;
        let userId = message.userId || 'unknown';
        let postId = message.postId || 'unknown';
        let surveyType = message.surveyType || 'tiktok-reel';
        let platform = surveyType.split('-')[0] || 'tiktok';
        chrome.storage.local.get(['config'], function(result) {
            let baseRoot = (result.config && result.config.downloadFolder && result.config.downloadFolder.trim())
                ? result.config.downloadFolder.trim().replace(/\\/g, '/')
                : 'SocialAnnotateExports';
            if (!baseRoot.endsWith('/')) baseRoot += '/';
            let safeUserId = String(userId).replace(/[^a-zA-Z0-9._-]/g, '_');
            let safePostId = String(postId).replace(/[^a-zA-Z0-9._-]/g, '_');
            pendingFilenames[key] = `${baseRoot}${platform}/${surveyType}/media/videos/${safeUserId}_${safePostId}_video.mp4`;
            sendResponse({ ok: true });
        });
        return true; // async sendResponse
    }
    else if (message.action === 'registerFBVideoDownload') {
        let key = message.key;
        let userId = message.userId || 'unknown';
        let postId = message.postId || 'unknown';
        chrome.storage.local.get(['config'], function(result) {
            let baseRoot = (result.config && result.config.downloadFolder && result.config.downloadFolder.trim())
                ? result.config.downloadFolder.trim().replace(/\\/g, '/')
                : 'SocialAnnotateExports';
            if (!baseRoot.endsWith('/')) baseRoot += '/';
            let safeUserId = String(userId).replace(/[^a-zA-Z0-9._-]/g, '_');
            let safePostId = String(postId).replace(/[^a-zA-Z0-9._-]/g, '_');
            pendingFilenames[key] = `${baseRoot}facebook/facebook-post/media/videos/${safeUserId}_${safePostId}_video.webm`;
            sendResponse({ ok: true });
        });
        return true; // async sendResponse
    }
    else if (message.action === 'saveConsentRecord') {
        chrome.storage.local.get(['config', 'clientID'], function(result) {
            let baseRoot = (result.config && result.config.downloadFolder && result.config.downloadFolder.trim())
                ? result.config.downloadFolder.trim().replace(/\\/g, '/')
                : 'SocialAnnotateExports';
            if (!baseRoot.endsWith('/')) baseRoot += '/';

            let manifest = chrome.runtime.getManifest();
            let record = {
                event: 'consent_given',
                timestamp_iso: message.timestampIso,
                timestamp_unix: message.timestampUnix,
                platform: message.platform,
                survey_type: message.surveyType,
                study_id: message.studyID || '',
                client_id: result.clientID || '',
                consent_text_markdown: message.consentTextMarkdown || '',
                consent_text_html: message.consentTextHtml || '',
                user_agent: message.userAgent || '',
                extension_version: manifest.version
            };

            let safeType = String(message.surveyType).replace(/[^a-zA-Z0-9_-]/g, '_');
            let filename = `${baseRoot}consent_records/${message.platform}_${safeType}_${message.timestampUnix}.json`;
            let key = Math.random().toString(36).substr(2, 9);
            pendingFilenames[key] = filename;
            let url = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record, null, 2)) + '#sa_fn=' + key;
            chrome.downloads.download({ url }, function(downloadId) {
                if (chrome.runtime.lastError) {
                    console.error('[SA] Consent record download failed:', chrome.runtime.lastError.message);
                    delete pendingFilenames[key];
                } else {
                    console.log('[SA] Consent record saved:', filename);
                }
            });
        });
    }
    else if (message.action === 'exportAnnotations') {
        let key = Math.random().toString(36).substr(2, 9);
        pendingFilenames[key] = message.filename;
        let url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(message.data) + '#sa_fn=' + key;
        chrome.downloads.download({ url }, function(downloadId) {
            if (chrome.runtime.lastError) {
                console.error('Export failed:', chrome.runtime.lastError.message);
                delete pendingFilenames[key];
            }
        });
        sendResponse({ status: 'started' });
    }
    else if (message.action === 'postApi') {
        // Proxy an API POST through the background service worker so we can handle CORS and report status.
        (async () => {
            try {
                const endpoint = message.endpoint;
                const body = message.body || null;
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: typeof body === 'string' ? body : JSON.stringify(body)
                });
                const ok = res && res.ok;
                sendResponse({ ok: ok, status: res.status });
            } catch (err) {
                console.error('postApi error', err);
                sendResponse({ ok: false, error: String(err) });
            }
        })();
        return true; // indicate we will call sendResponse asynchronously
    }
    return true;
});
