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
            "twitter-user": [],
            "twitter-tweet": [],
            "instagram-user": [],
            "bluesky-post": [],
            "bluesky-user": []
        },  // @TODO pull these from a supported types list somewhere.
        "annotatedElements": {
            "twitter-user": [],
            "twitter-tweet": [],
            "instagram-user": [],
            "bluesky-post": [],
            "bluesky-user": []
        }, // @TODO pull these from a supported types list somewhere.
        "clientID": clientID,
        "config": config,
        "isEnabled": true,
        "isGuided": false,
        "activeTargetList": [...config.surveys["twitter-user"].screenNameList]  // clone the array, keep the initial list for future reference.
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
            initialStorage.selectors = { twitter: {}, instagram: {}, bluesky: {} };
            chrome.storage.local.set(initialStorage, function () {
                console.log('Storage arrays initialized (without selectors).');
            });
        });
});


// Catches HTML5 pushState page transitions so we can react to SPA navigation.
// https://stackoverflow.com/questions/20865581/chrome-extension-content-script-not-loaded-until-page-is-refreshed
chrome.webNavigation.onHistoryStateUpdated.addListener(function (details) {
    // @TODO: send a message to the content script to re-run survey initialization on navigation.
});

// Listen for download requests from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'downloadMedia') {
        const urls = message.urls;
        const userId = message.userId || 'unknown';
        const postId = message.postId || 'unknown';
        const surveyType = message.surveyType || 'twitter-tweet';
        
        chrome.storage.local.get(['config'], function(result) {
            let folderPrefix = "";
            if (surveyType && result.config && result.config.surveys && result.config.surveys[surveyType] && result.config.surveys[surveyType].mediaDownloadFolder) {
                folderPrefix = result.config.surveys[surveyType].mediaDownloadFolder.trim();
                // Replace backslashes with forward slashes for cross-platform compatibility
                folderPrefix = folderPrefix.replace(/\\/g, '/');
                if (folderPrefix && !folderPrefix.endsWith('/')) {
                    folderPrefix += '/';
                }
            }

            urls.forEach((url, index) => {
                let format = 'jpg';
                let cleanUrl = url.split('?')[0];
                
                try {
                    let urlObj = new URL(url);
                    if (urlObj.searchParams.has('format')) {
                        format = urlObj.searchParams.get('format');
                    } else {
                        let ext = cleanUrl.split('.').pop();
                        if (['jpg', 'jpeg', 'png', 'gif', 'mp4'].includes(ext.toLowerCase())) {
                            format = ext;
                        }
                    }
                } catch(e) {}
                
                const filename = `${folderPrefix}${userId}_${postId}_${index + 1}.${format}`;
                chrome.downloads.download({
                    url: url,
                    filename: filename
                });
            });
            sendResponse({status: "started"});
        });
    }
    return true;
});
