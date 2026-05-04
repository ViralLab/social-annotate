
// Context class is defined in shared.js
const availableContextsBluesky = [new Context('bluesky-user', injectBlueskyUserSurvey, checkUserURL),
new Context('bluesky-post', enablePostObserver, null)];

// Selectors loaded from storage (populated by initializeSurveys)
let SEL_BS = {};

// MutationObserver globals — initialized after selectors are loaded
let bskyRoot = null;
let obsConfigBS = {};
let observerBS = null;

// Cache of intercepted Bluesky video DIDs+CIDs from the MAIN world interceptor
// Map: cid -> { did, cid }
window.bskyInterceptedVideos = {};

document.addEventListener('mh:bsky-video-found', function(e) {
    if (e.detail && e.detail.cid && e.detail.did) {
        window.bskyInterceptedVideos[e.detail.cid] = e.detail;
    }
});

window.addEventListener('mh:download-request', function(e) {
    let detail = e.detail;
    if (!detail) return;
    
    let initialSurveyType = detail.surveyType || 'bluesky-post';

    if (initialSurveyType === 'bluesky-user') {
        let userID = detail.userID;
        chrome.storage.local.get(['isProfileDownloadEnabled', 'isBannerDownloadEnabled'], function(res) {
            if (res.isProfileDownloadEnabled) {
                let avatarEl = document.querySelector(SEL_BS.userAvatar || 'div[aria-label*="\'s avatar"] img');
                if (avatarEl && avatarEl.src) {
                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [avatarEl.src], userId: userID || 'user', postId: 'profile', surveyType: initialSurveyType });
                }
            }
            if (res.isBannerDownloadEnabled) {
                let bannerEl = document.querySelector(SEL_BS.userBanner || 'div[aria-label="View profile banner"] img');
                if (bannerEl && bannerEl.src) {
                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [bannerEl.src], userId: userID || 'user', postId: 'banner', surveyType: initialSurveyType });
                }
            }
        });
        return;
    }

    if (!detail.postID) return;
    
    let postID = detail.postID;
    let postOwner = detail.userID;
    let postSurveyType = detail.surveyType || 'bluesky-post';
    
    let containerName = 'surveyFormContainer-' + postID;
    let surveyContainer = document.getElementById(containerName);
    let injectNode = surveyContainer ? (surveyContainer.closest(SEL_BS.postContainer || '[data-testid*="feedItem"], [data-testid*="postThreadItem"]') || surveyContainer.parentNode) : null;
    
    let urlsToDownload = [];
    if (injectNode) {
        urlsToDownload = extractPostMedia(injectNode);
    }
    
    if (urlsToDownload && urlsToDownload.length > 0) {
        let validUrls = urlsToDownload.filter(u => !u.startsWith('[Blob Stream]') && !u.startsWith('[Video Thumbnail]'));
        let blobs = urlsToDownload.filter(u => u.startsWith('[Blob Stream]'));
        let thumbnails = urlsToDownload.filter(u => u.startsWith('[Video Thumbnail]'));

        if (validUrls.length > 0) {
            chrome.runtime.sendMessage({ action: 'downloadMedia', urls: validUrls, userId: postOwner || 'user', postId: postID, surveyType: postSurveyType });
        } else if (blobs.length > 0) {
            // Find only the video element(s) inside THIS specific post that were tagged by inject-api.js
            let taggedVideos = injectNode ? injectNode.querySelectorAll('video[data-bsky-cid]') : [];
            
            if (taggedVideos.length > 0) {
                let blobUrls = [];
                taggedVideos.forEach(v => {
                    let url = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(v.dataset.bskyDid)}&cid=${encodeURIComponent(v.dataset.bskyCid)}`;
                    if (!blobUrls.includes(url)) blobUrls.push(url);
                });
                chrome.runtime.sendMessage({ action: 'downloadMedia', urls: blobUrls, userId: postOwner || 'user', postId: postID, surveyType: postSurveyType });
            } else {
                alert("Video not yet loaded. Please scroll the video into view and let it start playing, then try again.");
            }
        } else if (thumbnails.length > 0) {
            alert("No original media URLs found. Only thumbnails available.");
        } else {
            alert("No supported media found.");
        }
    } else {
        alert("No media found on this post.");
    }
});

function processPostNode(postNode) {
    let insertElement = postNode.parentNode;
    if (insertElement && insertElement.getElementsByClassName('survey-container-post').length === 0) {
        let postDetails = extractPostDetails(postNode);

        if (postDetails) {
            injectBlueskyPostSurvey(insertElement, postDetails.postID);
            availableContextsBluesky[1].renderSurvey(
                postDetails.postOwner,
                postDetails.postID,
                {
                    tweetContent: () => extractPostTextContent(postNode),
                    mediaUrls: () => extractPostMedia(postNode),
                    tweetMetrics: () => extractPostMetrics(postNode)
                }
            );
        }
    }
}

function createObserver() {
    const observerCallback = function (mutationsList, obs) {
        for (let mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // ELEMENT_NODE
                        // Bluesky posts are rendered as links with data-testid attributes
                        // or as divs containing post content
                        let posts = node.querySelectorAll(SEL_BS.postContainer || '[data-testid*="feedItem"], [data-testid*="postThreadItem"]');
                        posts.forEach(processPostNode);

                        // Also check if the node itself is a post
                        if (node.matches && node.matches(SEL_BS.postContainer || '[data-testid*="feedItem"], [data-testid*="postThreadItem"]')) {
                            processPostNode(node);
                        }
                    }
                });
            }
        }
    };
    return new MutationObserver(observerCallback);
}


function crawlUserName() {
    let currentURL = window.location.href;
    // Bluesky profile URLs: https://bsky.app/profile/handle.bsky.social
    let match = currentURL.match(/bsky\.app\/profile\/([^/?#]+)/);
    if (match) {
        return match[1];
    }
    return '';
}

function extractUserProfile() {
    let profile = {};

    // Display name
    try {
        let nameEl = document.querySelector(SEL_BS.userDisplayName || '[data-testid="profileHeaderDisplayName"]');
        if (nameEl) {
            profile.displayName = nameEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    // Handle
    try {
        let handleEl = document.querySelector(SEL_BS.userHandle || '[data-testid="profileHeaderHandle"]');
        if (handleEl) {
            profile.handle = handleEl.textContent.trim();
        } else {
            profile.handle = crawlUserName();
        }
    } catch (e) { /* skip */ }

    // Profile picture URL
    try {
        let avatarEl = document.querySelector(SEL_BS.userAvatar || 'div[aria-label*="\'s avatar"] img');
        if (avatarEl) {
            profile.avatarUrl = avatarEl.src;
        }
    } catch (e) { /* skip */ }

    // Bio / description
    try {
        let bioEl = document.querySelector(SEL_BS.userBio || '[data-testid="profileHeaderDescription"]');
        if (bioEl) {
            profile.bio = bioEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    // Followers count
    try {
        let followersEl = document.querySelector(SEL_BS.userFollowers || '[data-testid="profileHeaderFollowersButton"]');
        if (followersEl) {
            let text = followersEl.textContent.trim();
            profile.followersText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/);
            if (numMatch) profile.followersCount = numMatch[1];
        }
    } catch (e) { /* skip */ }

    // Following count
    try {
        let followingEl = document.querySelector(SEL_BS.userFollowing || '[data-testid="profileHeaderFollowsButton"]');
        if (followingEl) {
            let text = followingEl.textContent.trim();
            profile.followingText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/);
            if (numMatch) profile.followingCount = numMatch[1];
        }
    } catch (e) { /* skip */ }

    return profile;
}


function injectBlueskyUserSurvey(injectElement, userID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-user";
    surveyContainer.setAttribute("id", "surveyFormContainer");
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/bluesky/inject.css");
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    // Inject the survey before the main app root.
    let appRoot = document.getElementById('root') || document.querySelector(SEL_BS.appRoot || '#root');
    if (appRoot) {
        appRoot.insertAdjacentElement('beforebegin', surveyContainer);
    } else if (document.body) {
        document.body.insertAdjacentElement('afterbegin', surveyContainer);
    }
}

function enablePostObserver(injectElement) {
    // Process existing posts on the page
    document.querySelectorAll(SEL_BS.postContainer || '[data-testid*="feedItem"], [data-testid*="postThreadItem"]').forEach(processPostNode);
    if (bskyRoot && observerBS) {
        observerBS.observe(bskyRoot, obsConfigBS);
    }
}

function extractPostMedia(postNode) {
    if (!postNode) return "";
    let mediaUrls = [];

    // Extract images
    let photos = postNode.querySelectorAll(SEL_BS.postImage || 'img[data-testid*="image"], img[src*="feed_thumbnail"], img[src*="cdn.bsky.app"]');
    photos.forEach(img => {
        if (img.src && !img.src.includes('avatar') && !img.src.includes('banner')) {
            mediaUrls.push(img.src);
        }
    });

    // Extract videos
    let videos = postNode.querySelectorAll(SEL_BS.videoPlayer || 'video');
    videos.forEach(video => {
        let src = null;
        let mp4Source = video.querySelector('source');
        if (mp4Source) src = mp4Source.getAttribute('src') || mp4Source.src;
        if (!src) src = video.getAttribute('src') || video.src || video.currentSrc;
        
        if (src && src.startsWith('blob:')) {
            mediaUrls.push("[Blob Stream] " + src);
        } else if (src && !src.startsWith('blob:')) {
            mediaUrls.push(src);
        } else if (video.poster) {
            mediaUrls.push("[Video Thumbnail] " + video.poster);
        }
    });

    return mediaUrls;
}

function extractPostTextContent(postNode) {
    let textParts = [];

    // Grab all post text blocks
    let textNodes = postNode.querySelectorAll(SEL_BS.postText || '[data-testid="postText"]');
    textNodes.forEach(node => {
        if (node.innerText) textParts.push(node.innerText.trim());
    });

    return textParts.join('\n\n');
}

function extractPostMetrics(postNode) {
    let metrics = {
        replies: 0,
        reposts: 0,
        likes: 0,
        quotes: 0
    };

    if (!postNode) return metrics;

    const parseShortNumber = (str) => {
        if (!str) return 0;
        str = str.trim().replace(/,/g, '');
        if (str.match(/K/i)) return parseFloat(str) * 1000;
        if (str.match(/M/i)) return parseFloat(str) * 1000000;
        return parseInt(str, 10) || 0;
    };

    // Try extracting from aria-labels or specific data-testid elements
    const extractMetric = (selector) => {
        let el = postNode.querySelector(selector);
        if (el) {
            let aria = el.getAttribute('aria-label') || '';
            let match = aria.match(/^([\d,\.]+[kmKM]?)/i);
            if (match) return parseShortNumber(match[1]);
            let text = el.textContent.trim();
            return parseShortNumber(text);
        }
        return 0;
    };

    metrics.replies = extractMetric(SEL_BS.metricsReply || '[data-testid="replyBtn"]');
    metrics.reposts = extractMetric(SEL_BS.metricsRepost || '[data-testid="repostBtn"]');
    metrics.likes = extractMetric(SEL_BS.metricsLike || '[data-testid="likeBtn"], [data-testid="unlikeBtn"]');

    return metrics;
}

function extractPostDetails(postNode) {
    // Bluesky post URLs look like: /profile/handle.bsky.social/post/POST_ID
    // Try to find a link to the post within the node
    let postLink = postNode.querySelector(SEL_BS.postTimestamp || 'a[href*="/post/"]');
    if (!postLink || !postLink.href) {
        return null;
    }

    let href = postLink.href;
    let match = href.match(/\/profile\/([^/]+)\/post\/([^/?#]+)/);
    if (!match) return null;

    return {
        postOwner: match[1],
        postID: match[2]
    };
}

function injectBlueskyPostSurvey(injectNode, postID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-post";
    let containerName = "surveyFormContainer-" + postID;
    surveyContainer.setAttribute("id", containerName);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/bluesky/inject.css");
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    injectNode.insertAdjacentElement('afterbegin', surveyContainer);
}

function checkUserURL() {
    // Bluesky profile pages match /profile/<handle>
    let currentURL = window.location.href;
    let match = currentURL.match(/bsky\.app\/profile\/([^/?#]+)\/?$/);
    return !!match;
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'isGuided', 'selectors'], function (result) {

        // Load selectors into the module-level variable
        SEL_BS = (result.selectors && result.selectors.bluesky) ? result.selectors.bluesky : {};

        // Initialize observer infrastructure now that selectors are available
        bskyRoot = document.getElementById('root') || document.querySelector(SEL_BS.appRoot || '#root');
        obsConfigBS = SEL_BS.observerFilter || { attributes: false, childList: true, subtree: true };
        observerBS = createObserver();

        // Auto-Start Guided Mode
        let isBasePlatform = window.location.pathname === '/' || window.location.pathname === '';
        if (result.isEnabled && result.isGuided && result.activeTargetList && result.activeTargetList.length > 0 && isBasePlatform) {
            let firstTarget = result.activeTargetList[0];
            let platformURL = "https://bsky.app/";
            let activeSurvey = result.config.activeSurveys && result.config.activeSurveys.length > 0 ? result.config.activeSurveys[0] : null;

            if (activeSurvey === 'bluesky-post') {
                // Post URLs: /profile/OWNER/post/POST_ID — but in guided mode we only have the post URI/ID
                // For now, navigate to the post by AT URI or rkey
                window.location.href = platformURL + 'profile/' + firstTarget;
                return;
            } else if (activeSurvey === 'bluesky-user') {
                window.location.href = platformURL + 'profile/' + firstTarget;
                return;
            }
        }

        const currentPlatform = 'bluesky';
        for (let index = 0; index < availableContextsBluesky.length; ++index) {
            let currentContext = availableContextsBluesky[index];
            if (!currentContext.name.includes(currentPlatform)) continue;

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
                                    let evt = new CustomEvent('mh:download-request', { detail: { userID: values.userID, surveyType: currentContext.name } });
                                    window.dispatchEvent(evt);
                                }
                            });
                        } else {
                            chrome.storage.local.get(['isMediaDownloadEnabled'], function(res) {
                                if (res.isMediaDownloadEnabled) {
                                    let evt = new CustomEvent('mh:download-request', { detail: { postID: values.postID, userID: values.userID, surveyType: currentContext.name } });
                                    window.dispatchEvent(evt);
                                }
                            });
                        }
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);

                if (currentContext.name === 'bluesky-user') {
                    let surveyID = crawlUserName();
                    currentContext.renderSurvey(surveyID, null, {
                        userProfile: () => extractUserProfile()
                    });
                }
            }
        }
    });
}

// Fire the survey initializer on script load
initializeSurveys();
