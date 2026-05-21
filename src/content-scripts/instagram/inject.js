// Context class is defined in shared.js
const availableContextsInstagram = [
    new Context('instagram-user', injectInstagramUserSurvey, checkUserURL),
    new Context('instagram-post', () => {}, () => true) // Injection is handled by observer
];

// Selectors loaded from storage (populated by initializeSurveys)
let SEL_IG = {};

if (!window.__socialAnnotate__) window.__socialAnnotate__ = {};
if (!window.__socialAnnotate__.instagramApiMediaMap) window.__socialAnnotate__.instagramApiMediaMap = {};
document.addEventListener('mh:media-response-ig', function(e) {
    if (e.detail) {
        Object.keys(e.detail).forEach(k => {
            if (!window.__socialAnnotate__.instagramApiMediaMap[k]) window.__socialAnnotate__.instagramApiMediaMap[k] = [];
            window.__socialAnnotate__.instagramApiMediaMap[k].push(...e.detail[k]);
        });
    }
});

window.addEventListener('mh:download-request', function(e) {
    let detail = e.detail;
    if (!detail) return;
    
    let initialSurveyType = detail.surveyType || 'instagram-post';

    if (initialSurveyType === 'instagram-user') {
        let userID = detail.userID;
        chrome.storage.local.get(['isProfileDownloadEnabled'], function(res) {
            if (res.isProfileDownloadEnabled) {
                let avatarEl = document.querySelector(SEL_IG.userAvatar || 'header img[alt]');
                if (avatarEl && avatarEl.src) {
                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [avatarEl.src], userId: userID || 'user', postId: 'profile', surveyType: initialSurveyType });
                } else {
                    console.log("No profile picture found.");
                }
            }
            // Instagram has no banner — isBannerDownloadEnabled is intentionally unused here
        });
        return;
    }

    if (!detail.postID) return;
    
    let postID = detail.postID;
    let postOwner = detail.userID;
    let postSurveyType = detail.surveyType || 'instagram-post';
    
    let containerName = 'surveyFormContainer-' + postID;
    let surveyContainer = document.getElementById(containerName);
    let injectNode = surveyContainer ? surveyContainer.closest('article') : null;
    
    let urlsToDownload = [];
    if (injectNode) {
        urlsToDownload = extractInstagramMedia(injectNode);
    }
    
    // Supplement with intercepted API URLs to get native .mp4s!
    if (window.__socialAnnotate__ && window.__socialAnnotate__.instagramApiMediaMap && window.__socialAnnotate__.instagramApiMediaMap[postID]) {
        let apiVids = window.__socialAnnotate__.instagramApiMediaMap[postID];
        if (apiVids.length > 0) {
            // Strip out any Blob streams since we successfully found the raw MP4 from the API
            urlsToDownload = urlsToDownload.filter(u => !u.startsWith('[Blob Stream]'));
            urlsToDownload.push(...apiVids);
        }
    }
    
    // Deduplicate array
    urlsToDownload = [...new Set(urlsToDownload)];
    
    if (urlsToDownload && urlsToDownload.length > 0) {
        let validUrls = urlsToDownload.filter(u => !u.startsWith('[Blob Stream]'));
        let blobs = urlsToDownload.filter(u => u.startsWith('[Blob Stream]'));
        
        if (validUrls.length > 0) {
            chrome.runtime.sendMessage({ action: 'downloadMedia', urls: validUrls, userId: postOwner || 'user', postId: postID, surveyType: postSurveyType });
        } else if (blobs.length > 0) {
            console.warn("This video is an active stream (Blob) and cannot be natively downloaded.");
        } else {
            console.log("No supported media found.");
        }
    } else {
        console.log("No media found on this post.");
    }
});

function crawlUserName() {
    let currentURL = window.location.href;
    let temp = currentURL.split('.com/');
    temp = temp[temp.length - 1];
    temp = temp.split('/')[0].split('?')[0];
    return temp;
}


function injectInstagramUserSurvey(injectElement, userID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-user";
    surveyContainer.setAttribute("id", "surveyFormContainer");
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/instagram/inject.css");
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    // Inject the form to the appropriate element in the page.
    let barElementName = injectElement.name;
    let fixedBar = null;
    if (injectElement.type === "class") {
        fixedBar = document.querySelector(SEL_IG.appRoot || '#react-root');
    } else if (injectElement.type === "id") {
        fixedBar = document.getElementById(barElementName);
    }

    if (fixedBar) {
        fixedBar.insertAdjacentElement('beforebegin', surveyContainer);
    } else {
        // Fallback for modern Instagram DOM where react-root might not exist.
        if (document.body) {
            document.body.insertAdjacentElement('afterbegin', surveyContainer);
        } else {
            document.documentElement.appendChild(surveyContainer);
        }
    }
}

function checkUserURL() {
    // Content script won't be loaded if not on Instagram, so we only need to exclude
    // the home/root/explore pages. main page looks like ?hl=en or just nothing.
    let uname = crawlUserName();
    return !(uname === '' || uname === 'home');
}

function extractInstagramPostDetails(articleNode) {
    let postLinkEl = articleNode.querySelector(SEL_IG.postLink || "a[href*='/p/'], a[href*='/reel/']");
    let userLinkEls = articleNode.querySelectorAll(SEL_IG.userLink || "a[href]");
    
    if (!postLinkEl || !userLinkEls || userLinkEls.length === 0) return null;
    
    let postHref = postLinkEl.getAttribute('href') || '';
    let postPath = postHref;
    try { postPath = new URL(postHref, window.location.origin).pathname; } catch(e) {}
    
    let postMatch = postPath.match(/\/(?:p|reel)\/([^/?#]+)/);
    let postID = postMatch ? postMatch[1] : null;
    
    let postOwner = null;
    for (let i = 0; i < userLinkEls.length; i++) {
        let userHref = userLinkEls[i].getAttribute('href') || '';
        if (userHref === '#' || userHref.includes('/p/') || userHref.includes('/reel/') || userHref.includes('/explore/')) continue;
        
        let userPath = userHref;
        try { userPath = new URL(userHref, window.location.origin).pathname; } catch(e) {}
        
        let userMatch = userPath.match(/^\/([^/?#]+)/);
        if (userMatch && userMatch[1]) {
            postOwner = userMatch[1];
            break;
        }
    }
    
    if (postID && postOwner) {
        return { postID, postOwner };
    }
    return null;
}

function injectInstagramPostSurvey(injectNode, postID, postOwner) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-tweet"; // Reuse tweet container style
    let containerName = "surveyFormContainer-" + postID;
    surveyContainer.setAttribute("id", containerName);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/instagram/inject.css");
    
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    // Inject before the article node (or at the top of the article)
    injectNode.insertAdjacentElement('afterbegin', surveyContainer);
}

function processInstagramArticleNode(articleNode) {
    // Automatically try to expand the description
    try {
        let clickTargets = articleNode.querySelectorAll('div[role="button"], span');
        for (let target of clickTargets) {
            let txt = target.innerText || target.textContent;
            if (txt && txt.trim() === 'more') {
                target.click();
            }
        }
    } catch(e) {}

    if (articleNode.getElementsByClassName('survey-container-tweet').length === 0) {
        let postDetails = extractInstagramPostDetails(articleNode);

        if (postDetails) {
            let postCtx = availableContextsInstagram.find(c => c.name === 'instagram-post');
            if (!postCtx || !postCtx.formTemplate) return; // survey not active or config not yet loaded

            injectInstagramPostSurvey(articleNode, postDetails.postID, postDetails.postOwner);
            postCtx.renderSurvey(
                postDetails.postOwner,
                postDetails.postID,
                {
                    body: () => extractInstagramText(articleNode),
                    media_urls: () => extractInstagramMedia(articleNode),
                    created_at: () => { let t = articleNode.querySelector('time[datetime]'); return t ? t.getAttribute('datetime') : null; },
                    post_metrics: () => extractInstagramMetrics(articleNode)
                }
            );
        }
    }
}

function extractInstagramMetrics(articleNode) {
    let metrics = { like_count: null, share_count: null, comment_count: null, bookmark_count: null, view_count: null, quote_count: null };
    if (!articleNode) return metrics;

    const parseShortNumber = (str) => {
        if (!str) return 0;
        str = str.trim().replace(/,/g, '');
        if (str.match(/K/i)) return parseFloat(str) * 1000;
        if (str.match(/M/i)) return parseFloat(str) * 1000000;
        return parseInt(str, 10) || 0;
    };

    if (SEL_IG.metricsLike) {
        let el = articleNode.querySelector(SEL_IG.metricsLike);
        if (el) metrics.like_count = parseShortNumber(el.innerText || el.textContent);
    }
    if (SEL_IG.metricsReply) {
        let el = articleNode.querySelector(SEL_IG.metricsReply);
        if (el) metrics.comment_count = parseShortNumber(el.innerText || el.textContent);
    }
    if (SEL_IG.metricsViews) {
        let el = articleNode.querySelector(SEL_IG.metricsViews);
        if (el) metrics.view_count = parseShortNumber(el.innerText || el.textContent);
    }

    return metrics;
}

function extractInstagramText(articleNode) {
    // Attempt one last time to expand just in case
    try {
        let clickTargets = articleNode.querySelectorAll('div[role="button"], span');
        for (let target of clickTargets) {
            let txt = target.innerText || target.textContent;
            if (txt && txt.trim() === 'more') target.click();
        }
    } catch(e) {}

    let textEls = articleNode.querySelectorAll("h1[dir='auto'], span[dir='auto']");
    let longestText = "";
    textEls.forEach(el => {
        let text = el.innerText || el.textContent;
        if (text && text.length > longestText.length) {
            longestText = text.trim();
        }
    });
    
    // Clean up trailing 'more' if it didn't expand or was caught in the text
    longestText = longestText.replace(/(?:\.\.\.)?\s*more$/i, '').trim();
    return longestText;
}

function extractInstagramMedia(articleNode) {
    let urls = [];
    let mediaEls = articleNode.querySelectorAll("img, video");
    mediaEls.forEach(el => {
        let url = null;
        if (el.tagName.toLowerCase() === 'video') {
            let source = el.querySelector('source');
            if (source) url = source.getAttribute('src') || source.src;
            if (!url) url = el.getAttribute('src') || el.src || el.currentSrc;
            
            if (url && url.startsWith('blob:')) {
                urls.push("[Blob Stream] " + url);
                return;
            }
        } else {
            let alt = (el.getAttribute('alt') || '').toLowerCase();
            if (alt.includes('profile picture') || alt.includes('logo')) return;
            url = el.getAttribute('src') || el.src;
        }
        
        if (url && !url.startsWith('blob:') && !url.startsWith('data:')) {
            if (url.startsWith('/')) {
                url = window.location.origin + url;
            }
            urls.push(url);
        }
    });
    return urls;
}

function createObserver() {
    const observerCallback = function (mutationsList, obs) {
        for (let mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // ELEMENT_NODE
                        if (node.tagName && node.tagName.toLowerCase() === 'article') {
                            processInstagramArticleNode(node);
                        } else {
                            let articles = node.querySelectorAll(SEL_IG.postContainer || 'article');
                            articles.forEach(processInstagramArticleNode);
                        }
                    }
                });
            }
        }
    };
    return new MutationObserver(observerCallback);
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'selectors'], function (result) {

        // Load selectors into the module-level variable
        const _rawIG = (result.selectors && result.selectors.instagram) ? result.selectors.instagram : {};
        SEL_IG = { ...(_rawIG.shared || {}), ...(_rawIG.account || {}), ...(_rawIG.post || {}) };

        const currentPlatform = 'instagram';
        for (let index = 0; index < availableContextsInstagram.length; ++index) {
            let currentContext = availableContextsInstagram[index];
            if (!currentContext.name.includes(currentPlatform)) {
                continue;
            }
            let contextFlag = result.config.activeSurveys.includes(currentContext.name);
            let auxFlag = currentContext.auxiliaryCheck();

            if (result.isEnabled === true && contextFlag === true && auxFlag === true) {
                let activeSurvey = currentContext.name;
                let config = result.config['surveys'][activeSurvey];

                let studyID = config.studyID;

                function submitAction(errors, values) {
                    if (!errors) {
                        values.surveyType = currentContext.name;
                        values.studyID = studyID;
                        storeResults(values, currentPlatform);

                        let isUserSurvey = currentContext.name.endsWith('-user');
                        if (isUserSurvey) {
                            chrome.storage.local.get(['isProfileDownloadEnabled', 'isBannerDownloadEnabled'], function(res) {
                                if (res.isProfileDownloadEnabled || res.isBannerDownloadEnabled) {
                                    let evt = new CustomEvent('mh:download-request', { detail: { userID: values.account_id, surveyType: currentContext.name } });
                                    window.dispatchEvent(evt);
                                }
                            });
                        } else {
                            chrome.storage.local.get(['isMediaDownloadEnabled'], function(res) {
                                if (res.isMediaDownloadEnabled) {
                                    let evt = new CustomEvent('mh:download-request', { detail: { postID: values.post_id, userID: values.account_id, surveyType: currentContext.name } });
                                    window.dispatchEvent(evt);
                                }
                            });
                        }
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme = config.theme || "dark";
                currentContext.submitAction = submitAction;

                currentContext.injectSurvey(config.injectElement);
                if (currentContext.name === 'instagram-user') {
                    let surveyID = crawlUserName();
                    currentContext.renderSurvey(surveyID);
                }
            }
        }

        // Start observer only after formTemplate is set — prevents race condition
        // where observer fires renderSurvey before config is loaded.
        let filter = SEL_IG.observerFilter || { childList: true, subtree: true };
        igObserver.observe(observerTarget, filter);

        // Process articles already in the DOM
        document.querySelectorAll(SEL_IG.postContainer || 'article').forEach(processInstagramArticleNode);
    });
}

// Declare at module level so they are accessible inside initializeSurveys callback
let igObserver = createObserver();
let observerTarget = document.body;

// Fire the survey initializer on script load — observer is started inside once formTemplate is ready
initializeSurveys();
