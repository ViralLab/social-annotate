// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

importScripts('../config.js');

chrome.runtime.onInstalled.addListener(function () {

    // Pseudo-unique client ID: collision requires same millisecond install + matching 5-char random suffix.
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
        },  // @TODO pull these from a supported types list somewhere.
        "annotatedElements": {
            "x-user": [],
            "x-post": [],
            "instagram-user": [],
            "instagram-post": [],
            "bluesky-post": [],
            "bluesky-user": [],
            "whatsapp-post": []
        }, // @TODO pull these from a supported types list somewhere.
        "clientID": clientID,
        "config": config,
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


chrome.webNavigation.onHistoryStateUpdated.addListener(function (details) {
});

// Listen for download requests from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'downloadMedia') {
        const urls = message.urls;
        const userId = message.userId || 'unknown';
        const postId = message.postId || 'unknown';
        const surveyType = message.surveyType || 'x-post';

        chrome.storage.local.get(['config'], function (result) {
            let rootFolder = "SocialAnnotateMedia/" + surveyType + "/";
            if (surveyType && result.config && result.config.surveys && result.config.surveys[surveyType] && result.config.surveys[surveyType].mediaDownloadFolder) {
                let customFolder = result.config.surveys[surveyType].mediaDownloadFolder.trim().replace(/\\/g, '/');
                if (customFolder) {
                    rootFolder = "SocialAnnotateMedia/" + customFolder;
                    if (!rootFolder.endsWith('/')) rootFolder += '/';
                }
            }

            urls.forEach((url, index) => {
                let format = 'jpg';
                let cleanUrl = url.split('?')[0];
                let mediaToken = null;

                try {
                    if (url.startsWith('data:')) {
                        let mimeMatch = url.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.]+);/);
                        if (mimeMatch) {
                            let mimeType = mimeMatch[1].toLowerCase();
                            if (mimeType.includes('mp4')) format = 'mp4';
                            else if (mimeType.includes('webm')) format = 'webm';
                            else if (mimeType.includes('jpeg')) format = 'jpg';
                            else if (mimeType.includes('png')) format = 'png';
                            else if (mimeType.includes('gif')) format = 'gif';
                            else if (mimeType.includes('webp')) format = 'webp';
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

                // Keep filenames content-linkable: user + post + media token.
                let safeUserId = String(userId).replace(/[^a-zA-Z0-9._-]/g, '_');
                let safePostId = String(postId).replace(/[^a-zA-Z0-9._-]/g, '_');
                let safeToken = mediaToken ? String(mediaToken).replace(/[^a-zA-Z0-9._-]/g, '_') : String(index + 1);
                const filename = `${rootFolder}${typeSubfolder}${safeUserId}_${safePostId}_${safeToken}.${format}`;
                chrome.downloads.download({
                    url: url,
                    filename: filename
                }, function(downloadId) {
                    if (chrome.runtime.lastError) {
                        console.error('Download failed:', chrome.runtime.lastError.message, url);
                    } else {
                        console.log('Download started, id=', downloadId, url);
                    }
                });
            });
            sendResponse({ status: "started" });
        });
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
