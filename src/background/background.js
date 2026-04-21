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
            "instagram-user": []
        },  // @TODO pull these from a supported types list somewhere.
        "annotatedElements": {
            "twitter-user": [],
            "twitter-tweet": [],
            "instagram-user": []
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
            initialStorage.selectors = { twitter: {}, instagram: {} };
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
