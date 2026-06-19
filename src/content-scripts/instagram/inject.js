// Context class is defined in shared.js
const availableContextsInstagram = [
    new Context('instagram-user', injectInstagramUserSurvey, checkUserURL),
    new Context('instagram-post', () => {}, () => !isReelPage()),
    new Context('instagram-reel', () => {}, isReelPage),
    new Context('instagram-comment', () => {}, () => true)
];

// Selectors loaded from storage (populated by initializeSurveys)
let SEL_IG = {};
let SEL_IGR = {};
let SEL_IGC = {};

const _injectedIGComments = new Set();

if (!window.__socialAnnotate__) window.__socialAnnotate__ = {};
if (!window.__socialAnnotate__.instagramApiMediaMap) window.__socialAnnotate__.instagramApiMediaMap = {};

// Pending downloads: shortcode → { postOwner, postSurveyType, timeoutId }
// Registered when the API map has no URL at submit time; resolved when the map
// is updated by a later API response (e.g. the batch arrives after submission).
const _igPendingDownloads = {};
// Tracks shortcodes where a downloadMedia message was already sent (prevents duplicates
// when both the API-map path and the background og:video path succeed for the same reel).
const _igResolvedDownloads = new Set();

// ── Manipulation state ────────────────────────────────────
let manipConfig_IG  = {};
let manipMap_IG     = {};
let manipMapId_IG   = '';
let manipApplied_IG = {};
let manipConfig_IGR = {};
let manipMap_IGR    = {};
let manipMapId_IGR  = '';
let manipApplied_IGR = {};
let _processedCount_IG     = 0;
registerHealthCounter(function () { return _processedCount_IG; });
document.addEventListener('mh:media-response-ig', function(e) {
    if (e.detail) {
        Object.keys(e.detail).forEach(k => {
            if (!window.__socialAnnotate__.instagramApiMediaMap[k]) window.__socialAnnotate__.instagramApiMediaMap[k] = [];
            window.__socialAnnotate__.instagramApiMediaMap[k].push(...e.detail[k]);
            console.log('[SA-IG-1] API map updated | code:', k, '| urls:', window.__socialAnnotate__.instagramApiMediaMap[k]);
            // Resolve any pending download waiting for this shortcode
            if (_igPendingDownloads[k] && !_igResolvedDownloads.has(k)) {
                var pd = _igPendingDownloads[k];
                clearTimeout(pd.timeoutId);
                delete _igPendingDownloads[k];
                var urls = window.__socialAnnotate__.instagramApiMediaMap[k] || [];
                console.log('[SA-IG-3] RESOLVING pending download for:', k, '| urls:', urls);
                if (urls.length > 0) {
                    _igResolvedDownloads.add(k);
                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: urls, userId: pd.postOwner, postId: k, surveyType: pd.postSurveyType });
                }
            }
        });
    }
});

window.addEventListener('mh:download-request', function(e) {
    let detail = e.detail;
    if (!detail) return;

    let initialSurveyType = detail.surveyType || 'instagram-post';
    console.log('[SA-DL-1] download-request fired | surveyType:', initialSurveyType, '| postID:', detail.postID, '| userID:', detail.userID);

    if (initialSurveyType === 'instagram-user') {
        let userID = detail.userID;
        chrome.storage.local.get(['isProfileDownloadEnabled'], function(res) {
            if (res.isProfileDownloadEnabled) {
                let avatarEl = getInstagramProfileAvatarEl();
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

    if (!detail.postID) { console.warn('[SA-DL-2] no postID in detail, aborting'); return; }

    let postID = detail.postID;
    let postOwner = detail.userID;
    let postSurveyType = detail.surveyType || 'instagram-post';

    let containerName = 'surveyFormContainer-' + postID;
    let surveyContainer = document.getElementById(containerName);
    let injectNode = surveyContainer
        ? (surveyContainer.closest('article') || surveyContainer.nextElementSibling)
        : null;
    console.log('[SA-DL-3] container found:', !!surveyContainer, '| injectNode found:', !!injectNode);

    let urlsToDownload = [];
    if (injectNode) {
        urlsToDownload = extractInstagramMedia(injectNode);
        console.log('[SA-DL-4] DOM extraction urls:', urlsToDownload);
    }

    // For reels: the "Video player" div is an overlay container — the <video> element
    // is a sibling, not a child. Query the document for the currently playing video.
    // This covers service-worker-cached reels whose CDN URLs bypass inject-api.js.
    if (postSurveyType === 'instagram-reel') {
        var allVids = document.querySelectorAll('video');
        var reelVideo = null;
        // First pass: find an actually-playing video with a CDN URL
        for (var _vi = 0; _vi < allVids.length; _vi++) {
            var _v = allVids[_vi];
            var _vs = _v.currentSrc || _v.src || '';
            if (!_v.paused && _vs && !_vs.startsWith('blob:') && !_vs.startsWith('data:')) {
                reelVideo = _v; break;
            }
        }
        // Second pass: settle for any loaded CDN video (paused is fine)
        if (!reelVideo) {
            for (var _vi = 0; _vi < allVids.length; _vi++) {
                var _v = allVids[_vi];
                var _vs = _v.currentSrc || _v.src || '';
                if (_vs && !_vs.startsWith('blob:') && !_vs.startsWith('data:') && _v.readyState >= 2) {
                    reelVideo = _v; break;
                }
            }
        }
        if (reelVideo) {
            var vsrc = reelVideo.currentSrc || reelVideo.src;
            console.log('[SA-DL-4b] found reel video.currentSrc (CDN):', vsrc);
            urlsToDownload.push(vsrc);
        } else {
            // All videos are blob/MSE — note it for debugging; API map handles this case
            var _blobVid = Array.prototype.find.call(allVids, function(v) { return !v.paused; });
            console.log('[SA-DL-4b] no CDN video found | blob/MSE playing:', !!_blobVid, '| total videos:', allVids.length);
            if (_blobVid) urlsToDownload.push('[Blob Stream] ' + (_blobVid.currentSrc || _blobVid.src));
        }
    }

    // Supplement with intercepted API URLs to get native .mp4s!
    const fullApiMap = (window.__socialAnnotate__ && window.__socialAnnotate__.instagramApiMediaMap) || {};
    console.log('[SA-DL-5] API map entry for postID "' + postID + '":', fullApiMap[postID] || 'EMPTY/MISSING');

    if (fullApiMap[postID] && fullApiMap[postID].length > 0) {
        let apiVids = fullApiMap[postID];
        urlsToDownload = urlsToDownload.filter(u => !u.startsWith('[Blob Stream]'));
        urlsToDownload.push(...apiVids);
    }

    // Deduplicate array
    urlsToDownload = [...new Set(urlsToDownload)];

    if (urlsToDownload && urlsToDownload.length > 0) {
        let validUrls = urlsToDownload.filter(u => !u.startsWith('[Blob Stream]'));
        let blobs = urlsToDownload.filter(u => u.startsWith('[Blob Stream]'));

        if (validUrls.length > 0) {
            console.log('[SA-DL-8] SENDING DOWNLOAD | postId:', postID, '| urls:', validUrls);
            chrome.runtime.sendMessage({ action: 'downloadMedia', urls: validUrls, userId: postOwner || 'user', postId: postID, surveyType: postSurveyType });
        } else if (blobs.length > 0) {
            console.warn('[SA-DL-9] only blob URLs, registering pending download for:', postID);
            _igPendingDownloads[postID] = {
                postOwner: postOwner || 'user',
                postSurveyType,
                timeoutId: setTimeout(function() {
                    delete _igPendingDownloads[postID];
                    console.warn('[SA-DL-TIMEOUT] no CDN URL arrived within 8s for:', postID);
                }, 8000)
            };
            _igFetchReelUrlFallback(postID, postOwner, postSurveyType);
        } else {
            console.log('[SA-DL-9] no supported media found for postID:', postID);
        }
    } else {
        // No URLs at all — API map was empty at submit time. Register pending download
        // in case the API batch response arrives shortly after (common for the first reel).
        console.log('[SA-DL-9] API map empty at submit, registering pending download for:', postID);
        _igPendingDownloads[postID] = {
            postOwner: postOwner || 'user',
            postSurveyType,
            timeoutId: setTimeout(function() {
                delete _igPendingDownloads[postID];
                console.warn('[SA-DL-TIMEOUT] no CDN URL arrived within 8s for:', postID);
            }, 8000)
        };
        _igFetchReelUrlFallback(postID, postOwner, postSurveyType);
    }
});

function _igFetchReelUrlFallback(postID, postOwner, postSurveyType) {
    console.log('[SA-DL-BG] asking background to fetch og:video for:', postID);
    // Capture owner/type in closure so they remain available even after the 8s timeout
    // clears _igPendingDownloads[postID].
    var _owner = postOwner || 'user';
    var _type = postSurveyType;
    chrome.runtime.sendMessage({ action: 'fetchReelUrl', shortcode: postID }, function(response) {
        if (chrome.runtime.lastError) {
            console.warn('[SA-DL-BG] sendMessage error:', chrome.runtime.lastError.message);
            return;
        }
        console.log('[SA-DL-BG] background response for', postID, ':', response);
        if (response && response.url) {
            if (_igResolvedDownloads.has(postID)) {
                // API-map path already fired a download; cancel any lingering pending entry.
                if (_igPendingDownloads[postID]) { clearTimeout(_igPendingDownloads[postID].timeoutId); delete _igPendingDownloads[postID]; }
                console.log('[SA-DL-BG] already downloaded via API map, skipping og:video for:', postID);
                return;
            }
            _igResolvedDownloads.add(postID);
            if (_igPendingDownloads[postID]) { clearTimeout(_igPendingDownloads[postID].timeoutId); delete _igPendingDownloads[postID]; }
            console.log('[SA-DL-BG] DOWNLOADING via og:video | postId:', postID, '| url:', response.url);
            chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [response.url], userId: _owner, postId: postID, surveyType: _type });
        } else {
            console.warn('[SA-DL-BG] background fetch failed | postId:', postID, '| error:', response && response.error);
        }
    });
}

function isPostOrReelPage() {
    if (window.location.protocol === 'file:') return true;
    let path = window.location.pathname;
    return /^\/p\/[^/]+/.test(path) || /^\/reel\/[^/]+/.test(path);
}

function findCommentBlock(anchor, containerHint) {
    // Strategy 1: div whose parent is UL (post-page comment list structure)
    let el = anchor;
    for (let i = 0; i < 15; i++) {
        if (!el.parentElement) break;
        el = el.parentElement;
        if (el.tagName === 'DIV' && el.parentElement && el.parentElement.tagName === 'UL') {
            console.log('[SA-IGC] findCommentBlock: UL-child strategy');
            return el;
        }
        if (el.tagName === 'ARTICLE' || el.tagName === 'BODY') break;
    }

    // Strategy 2: use the observer's container hint (reel comment panel adds one div per comment)
    if (containerHint && containerHint !== document.body && containerHint.contains && containerHint.contains(anchor)) {
        let profileLink = containerHint.querySelector(SEL_IGC.commentAuthorLink || 'a[role="link"]:not([href*="/c/"])');
        if (profileLink) {
            console.log('[SA-IGC] findCommentBlock: containerHint strategy');
            return containerHint;
        }
    }

    // Strategy 3: walk up, track the OUTERMOST div that still has exactly 1 /c/ anchor
    // (stops when parent contains multiple comment anchors — that's the list container)
    el = anchor.parentElement;
    let lastSingleAnchorDiv = null;
    while (el && el !== document.body) {
        if (el.tagName === 'DIV') {
            let count = el.querySelectorAll(SEL_IGC.commentTimestampAnchor || 'a[href*="/c/"][role="link"]').length;
            if (count === 1) {
                lastSingleAnchorDiv = el;
            } else if (count > 1) {
                break;
            }
        }
        el = el.parentElement;
    }
    if (lastSingleAnchorDiv && lastSingleAnchorDiv.querySelector(SEL_IGC.commentAuthorLink || 'a[role="link"]:not([href*="/c/"])')) {
        console.log('[SA-IGC] findCommentBlock: outermost single-anchor strategy');
        return lastSingleAnchorDiv;
    }

    console.log('[SA-IGC] findCommentBlock: all strategies failed for:', anchor.getAttribute('href'));
    return null;
}

function extractInstagramCommentData(anchor, commentBlock) {
    let href = anchor.getAttribute('href') || '';
    let commentIdMatch = href.match(/\/c\/(\d+)/);
    if (!commentIdMatch) return null;

    // Replies: /p/POST/c/PARENT_ID/r/REPLY_ID/ — depth=1, parent comment = PARENT_ID
    let replyIdMatch = href.match(/\/r\/(\d+)/);
    let commentId        = replyIdMatch ? replyIdMatch[1] : commentIdMatch[1];
    let commentDepth     = replyIdMatch ? 1 : 0;
    let parentCommentId  = replyIdMatch ? commentIdMatch[1] : null;

    let parentPostId = null;
    let postMatch = href.match(/\/p\/([A-Za-z0-9_-]+)\/c\//);
    if (postMatch) parentPostId = postMatch[1];
    else { let reelMatch = href.match(/\/reel\/([A-Za-z0-9_-]+)\/c\//); if (reelMatch) parentPostId = reelMatch[1]; }

    let author = null;
    let authorLinkSel = SEL_IGC.commentAuthorLink || 'a[role="link"]:not([href*="/c/"])';
    let authorLinks = commentBlock.querySelectorAll(authorLinkSel);
    for (let link of authorLinks) {
        let lhref = link.getAttribute('href') || '';
        let m = lhref.match(/instagram\.com\/([a-zA-Z0-9_.]+)\/?$/) || lhref.match(/^\/([a-zA-Z0-9_.]+)\/?$/);
        if (m && m[1]) { author = m[1]; break; }
    }

    let body = '';
    let textSel = SEL_IGC.commentText || 'span[dir="auto"]';
    commentBlock.querySelectorAll(textSel).forEach(function(span) {
        if (span.closest('a')) return;
        let txt = (span.innerText || span.textContent || '').trim();
        if (txt.length > body.length) body = txt;
    });

    let timeEl = anchor.querySelector('time[datetime]');
    let createdAt = timeEl ? timeEl.getAttribute('datetime') : null;

    let likeCount = null;
    let allSpans = commentBlock.querySelectorAll('span');
    for (let span of allSpans) {
        let txt = (span.innerText || span.textContent || '').trim();
        let m = txt.match(/^([\d,]+)\s+like/i);
        if (m) { likeCount = parseInt(m[1].replace(/,/g, ''), 10); break; }
    }

    let replyCount = null;
    for (let span of allSpans) {
        let txt = (span.innerText || span.textContent || '').trim();
        let m = txt.match(/(?:View(?:\s+all)?\s+)?(\d+)\s+repl/i);
        if (m) { replyCount = parseInt(m[1], 10); break; }
    }

    console.log('[SA-IGC] extractCommentData | id:', commentId, '| depth:', commentDepth, '| author:', author, '| parentPost:', parentPostId, '| parentComment:', parentCommentId, '| body:', body.slice(0, 60));
    return { commentId, commentDepth, parentCommentId, parentPostId, author, body, createdAt, likeCount, replyCount };
}

function processInstagramCommentAnchor(anchor) {
    let commentCtx = availableContextsInstagram.find(function(c) { return c.name === 'instagram-comment'; });
    if (!commentCtx || !commentCtx.formTemplate) {
        console.log('[SA-IGC] processInstagramCommentAnchor: context not ready | formTemplate:', commentCtx && commentCtx.formTemplate);
        return;
    }

    let href = anchor.getAttribute('href') || '';
    // Replies have /r/REPLY_ID after /c/PARENT_ID — use reply ID as the unique key
    let replyIdMatch  = href.match(/\/r\/(\d+)/);
    let commentIdMatch = href.match(/\/c\/(\d+)/);
    if (!commentIdMatch) {
        console.log('[SA-IGC] anchor has no /c/ pattern, skipping:', href);
        return;
    }
    let commentId = replyIdMatch ? replyIdMatch[1] : commentIdMatch[1];

    if (_injectedIGComments.has(commentId)) return;

    let commentBlock = findCommentBlock(anchor);
    if (!commentBlock) {
        console.log('[SA-IGC] no commentBlock found for commentId:', commentId);
        return;
    }

    let data = extractInstagramCommentData(anchor, commentBlock);
    if (!data || !data.author) {
        console.log('[SA-IGC] missing data for commentId:', commentId, '| data:', data);
        return;
    }

    console.log('[SA-IGC] INJECTING survey | commentId:', commentId, '| author:', data.author);
    _injectedIGComments.add(commentId);
    _processedCount_IG++;

    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-comment';
    surveyContainer.id = 'surveyFormContainer-' + commentId;
    surveyContainer.style.cssText = 'width:100%;min-height:80px;display:block;overflow:visible;background:transparent;position:relative;z-index:100;box-sizing:border-box;zoom:0.85;';
    let shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    let cssUrl = chrome.runtime.getURL('content-scripts/instagram/inject.css');
    shadowRoot.innerHTML = '<iframe class="surveyIframe" src="' + chrome.runtime.getURL('sandbox/survey.html') + '" data-css="' + cssUrl + '" style="border:none;width:100%;height:80px;background:transparent;"></iframe>';

    commentBlock.prepend(surveyContainer);
    console.log('[SA-IGC] container appended to commentBlock:', commentBlock.tagName, commentBlock.className.slice(0, 60));

    commentCtx.renderSurvey(data.author, data.commentId, {
        body:              function() { return data.body; },
        created_at:        function() { return data.createdAt; },
        media_urls:        function() { return []; },
        post_metrics:      function() { return { like_count: data.likeCount, comment_count: data.replyCount, share_count: null, view_count: null, bookmark_count: null, quote_count: null }; },
        parent_post_id:    function() { return data.parentPostId; },
        comment_depth:     function() { return data.commentDepth; },
        parent_comment_id: function() { return data.parentCommentId; }
    });
}

function crawlUserName() {
    if (window.location.protocol === 'file:' || window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
        let handleEl = document.querySelector(SEL_IG.userHandle || 'section h2[dir="auto"], header h2');
        if (handleEl) {
            let text = handleEl.textContent.trim().replace(/^@/, '');
            if (text) return text;
        }
        return 'local-test-user';
    }
    let currentURL = window.location.href;
    let temp = currentURL.split('.com/');
    temp = temp[temp.length - 1];
    temp = temp.split('/')[0].split('?')[0];
    return temp;
}

function getInstagramProfileAvatarEl() {
    let username = crawlUserName();
    if (username && username !== 'local-test-user') {
        let el = document.querySelector(`img[alt="${username}'s profile picture"]`);
        if (el) return el;
    }
    // Fallback: first profile picture not in nav/header (avoids logged-in user's avatar)
    let all = document.querySelectorAll(SEL_IG.userAvatar || 'img[alt*="profile picture"]');
    for (let img of all) {
        if (!img.closest('nav') && !img.closest('header')) return img;
    }
    return all[0] || null;
}

function extractUserProfile() {
    let profile = {};

    // Handle — URL is canonical on a profile page
    try {
        let urlHandle = crawlUserName();
        if (urlHandle && urlHandle !== 'local-test-user') {
            profile.handle = '@' + urlHandle;
        } else {
            let el = document.querySelector(SEL_IG.userHandle || 'section h2[dir="auto"]');
            if (el) profile.handle = el.textContent.trim();
        }
    } catch (e) { /* skip */ }

    // Display name — first span[dir=auto] not inside <a>, not bio, not a stat
    try {
        let spans = document.querySelectorAll('section span[dir="auto"]');
        for (let s of spans) {
            if (s.closest('a') || s.closest(SEL_IG.userBio || '._aade')) continue;
            let text = s.textContent.trim();
            if (!text || /^[\d,.][\d,.KMBkmb\s]*\s+(posts?|followers?|following)$/i.test(text)) continue;
            profile.profile_name = text;
            break;
        }
    } catch (e) { /* skip */ }

    // Bio
    try {
        let el = document.querySelector(SEL_IG.userBio || '._aade');
        if (el) profile.bio = el.textContent.trim();
    } catch (e) { /* skip */ }

    // Followers / Following / Posts counts.
    // Primary: CSS selectors from SEL_IG (work on live pages where hrefs are real paths).
    // Fallback: text-pattern scan of all span[dir="auto"] (handles saved pages where
    // hrefs are "#", and filters out the "Followed by..." mutual section via digit check).
    try {
        let isCountText = function(text) { return /^[\d,.]/.test(text); };

        let followersEl = SEL_IG.userFollowers ? document.querySelector(SEL_IG.userFollowers) : null;
        if (followersEl && isCountText(followersEl.textContent.trim()))
            profile.followersCount = followersEl.textContent.trim();

        let followingEl = SEL_IG.userFollowing ? document.querySelector(SEL_IG.userFollowing) : null;
        if (followingEl && isCountText(followingEl.textContent.trim()))
            profile.followingCount = followingEl.textContent.trim();

        // Text-pattern scan covers cases where CSS selectors didn't match
        if (!profile.followersCount || !profile.followingCount || !profile.postsCount) {
            let spans = document.querySelectorAll('span[dir="auto"]');
            for (let s of spans) {
                let text = s.textContent.trim();
                if (!profile.followersCount && /^[\d,.][\d,.KMBkmb\s]*\s+followers?$/i.test(text))
                    profile.followersCount = text;
                else if (!profile.followingCount && /^[\d,.][\d,.KMBkmb\s]*\s+following$/i.test(text))
                    profile.followingCount = text;
                else if (!profile.postsCount && /^[\d,.][\d,.KMBkmb\s]*\s+posts?$/i.test(text) && !s.closest('a'))
                    profile.postsCount = text;
            }
        }
    } catch (e) { /* skip */ }

    // Avatar — match by username to avoid picking the logged-in user's nav avatar
    try {
        let el = getInstagramProfileAvatarEl();
        if (el && el.src) profile.profile_img_url = el.src;
    } catch (e) { /* skip */ }

    return profile;
}


// ── Reel helpers ──────────────────────────────────────────

function isReelPage() {
    return /^\/reels?\//i.test(window.location.pathname);
}

function extractReelShortcodeFromUrl(url) {
    var m = String(url || '').match(/\/reels?\/((?!audio\/)[A-Za-z0-9_-]{5,})/);
    return m ? m[1] : null;
}

let currentReelShortcode = extractReelShortcodeFromUrl(window.location.href);
let _currentReelEl = null;

// IntersectionObserver: primary signal for reel changes.
// window.scroll doesn't fire for Instagram's inner scroll container,
// and pushState only fires for the first reel navigation.
let _reelIO = null;

function observeReelContainers() {
    if (!_reelIO) {
        _reelIO = new IntersectionObserver(function(entries) {
            var anyVisible = entries.some(function(e) { return e.isIntersecting && e.intersectionRatio >= 0.5; });
            if (anyVisible) processCurrentReel();
        }, { threshold: [0.5] });
    }
    var sel = SEL_IGR.postContainer || 'div[aria-label="Video player"][role="group"]';
    document.querySelectorAll(sel).forEach(function(el) { _reelIO.observe(el); });
}

(function() {
    var origPush    = history.pushState;
    var origReplace = history.replaceState;
    function onNav(url) {
        // Don't update currentReelShortcode here. Instagram fires pushState for the
        // next reel before the user finishes scrolling to it, so updating the module
        // variable eagerly causes surveys to be rendered with the wrong shortcode.
        // processCurrentReel reads the URL only when the dominant container actually changes.
        var codeInUrl = extractReelShortcodeFromUrl(String(url || ''));
        console.log('[SA-R-1] pushState/replaceState fired | url code:', codeInUrl, '| currentReelShortcode (unchanged):', currentReelShortcode);
        setTimeout(processCurrentReel, 150);
        // Re-scan for comments after SPA navigation (post modal open, reel-to-reel, etc.)
        var _commentSel = SEL_IGC.commentTimestampAnchor || "a[href*='/c/'][role='link']";
        [300, 1200, 2500].forEach(function(d) {
            setTimeout(function() { document.querySelectorAll(_commentSel).forEach(processInstagramCommentAnchor); }, d);
        });
    }
    history.pushState = function(state, title, url) {
        var r = origPush.apply(this, arguments);
        onNav(url);
        return r;
    };
    history.replaceState = function(state, title, url) {
        var r = origReplace.apply(this, arguments);
        onNav(url);
        return r;
    };
    window.addEventListener('popstate', function() {
        var code = extractReelShortcodeFromUrl(window.location.href);
        if (code) currentReelShortcode = code;
        setTimeout(processCurrentReel, 150);
    });
})();

function getReelAuthor(containerEl) {
    var authorSel = SEL_IGR.postAuthorLink || 'a[aria-label$=" reels"][role="link"]';

    function extractFromLink(link) {
        if (!link) return null;
        var href = link.getAttribute('href') || '';
        var m = href.match(/instagram\.com\/([a-zA-Z0-9_.]+)\/reels/) ||
                href.match(/^\/([a-zA-Z0-9_.]+)\/reels/);
        return m ? m[1] : null;
    }

    // Strategy 1: walk up DOM from container, query subtree at each ancestor
    var el = containerEl;
    for (var i = 0; i < 25; i++) {
        if (!el || !el.parentElement) break;
        el = el.parentElement;
        var link = el.querySelector(authorSel);
        if (link) return extractFromLink(link);
    }

    // Strategy 2: find the visible author link in the whole document
    // (handles React portals / absolute-positioned overlays outside the container subtree)
    var allLinks = document.querySelectorAll(authorSel);
    if (allLinks.length === 1) return extractFromLink(allLinks[0]);
    if (allLinks.length > 1) {
        var cRect = containerEl.getBoundingClientRect();
        var best = null, bestDist = Infinity;
        allLinks.forEach(function(l) {
            var r = l.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;
            var dist = Math.abs(r.top - cRect.top);
            if (dist < bestDist) { bestDist = dist; best = l; }
        });
        if (best) return extractFromLink(best);
    }

    // Strategy 3: extract from img alt "username's profile picture"
    var avatarImg = document.querySelector('img[alt*="\'s profile picture"]');
    if (avatarImg) {
        var m = (avatarImg.getAttribute('alt') || '').match(/^(.+?)'s profile picture/);
        if (m) return m[1];
    }

    return null;
}

function injectInstagramReelSurvey(shortcode) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-reel";
    surveyContainer.setAttribute("id", "surveyFormContainer-" + shortcode);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    let cssUrl = chrome.runtime.getURL("content-scripts/instagram/inject.css");
    shadowRoot.innerHTML = `<iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>`;
    document.body.appendChild(surveyContainer);
}

function extractReelText(containerEl) {
    var el = containerEl;
    for (var i = 0; i < 20; i++) {
        if (!el || !el.parentElement) break;
        el = el.parentElement;
        var textEls = el.querySelectorAll(SEL_IGR.postText || 'span[dir="auto"]');
        var longest = '';
        textEls.forEach(function(t) {
            var txt = (t.innerText || t.textContent || '').trim();
            if (txt.length > longest.length) longest = txt;
        });
        if (longest.length > 5) return longest;
    }
    return '';
}

function extractReelMedia(containerEl) {
    var video = containerEl.querySelector(SEL_IGR.postVideo || 'video');
    if (!video) return [];
    var src = video.src || video.currentSrc;
    if (src && src.startsWith('blob:')) return ['[Blob Stream] ' + src];
    if (src) return [src];
    return [];
}

function processCurrentReel() {
    if (!currentReelShortcode) { console.log('[SA-R-2] processCurrentReel: no currentReelShortcode, aborting'); return; }

    var reelCtx = availableContextsInstagram.find(c => c.name === 'instagram-reel');
    if (!reelCtx || !reelCtx.formTemplate) { console.log('[SA-R-2] processCurrentReel: reel context not ready'); return; }

    var sel = SEL_IGR.postContainer || 'div[aria-label="Video player"][role="group"]';
    var containers = document.querySelectorAll(sel);
    console.log('[SA-R-2] processCurrentReel fired | containers found:', containers.length, '| currentReelShortcode:', currentReelShortcode, '| url:', window.location.href);

    // Find the container whose center is closest to the viewport center.
    var vpMid = window.innerHeight / 2;
    var bestEl = null, bestDist = Infinity;
    for (var i = 0; i < containers.length; i++) {
        var rect = containers[i].getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
        var dist = Math.abs((rect.top + rect.bottom) / 2 - vpMid);
        if (dist < bestDist) { bestDist = dist; bestEl = containers[i]; }
    }
    if (!bestEl) { console.log('[SA-R-3] no visible container found, aborting'); return; }

    var containerChanged = bestEl !== _currentReelEl;
    console.log('[SA-R-3] dominant container changed:', containerChanged);

    // Reset when the dominant container changes (works even if URL stays the same).
    // Read the shortcode from the URL at this moment — onNav no longer updates
    // currentReelShortcode eagerly, so the URL here reflects the reel that is
    // actually dominant in the viewport.
    if (containerChanged) {
        _currentReelEl = bestEl;
        document.querySelectorAll('div.survey-container-reel').forEach(function(el) { el.remove(); });
        var code = extractReelShortcodeFromUrl(window.location.href);
        var prevShortcode = currentReelShortcode;
        if (code) currentReelShortcode = code;
        else currentReelShortcode = 'reel-' + Date.now();
        console.log('[SA-R-4] shortcode updated | prev:', prevShortcode, '→ new:', currentReelShortcode);
    }

    var alreadyInjected = !!document.getElementById('surveyFormContainer-' + currentReelShortcode);
    if (alreadyInjected) return;

    var postOwner = getReelAuthor(bestEl);
    console.log('[SA-R-6] postOwner resolved:', postOwner);
    if (!postOwner) return;

    if (manipConfig_IGR.enabled && manipMap_IGR[currentReelShortcode]) {
        let entry = manipMap_IGR[currentReelShortcode];
        let textEl = null, longest = 0;
        var el2 = bestEl;
        for (var j = 0; j < 20 && el2 && el2.parentElement; j++) {
            el2 = el2.parentElement;
            el2.querySelectorAll(SEL_IGR.postText || 'span[dir="auto"]').forEach(function(e) {
                let len = (e.innerText || e.textContent || '').length;
                if (len > longest) { longest = len; textEl = e; }
            });
            if (textEl) break;
        }
        if (textEl) {
            let rewrittenText = entry.rewritten_text;
            let originalText  = entry.original_text || '';
            textEl.textContent = rewrittenText;
            if (manipConfig_IGR.mode === 'aware') {
                let isOriginal = false;
                let toggleBtn  = document.createElement('button');
                toggleBtn.textContent = '👁 Show original';
                toggleBtn.setAttribute('data-sa-manip-toggle', '1');
                toggleBtn.style.cssText = [
                    'display:block','margin-left:auto','margin-bottom:4px',
                    'padding:2px 10px','font-size:11px','line-height:1.6',
                    'cursor:pointer','border-radius:4px',
                    'background:rgba(29,155,240,0.08)','color:rgb(29,155,240)',
                    'border:1px solid rgba(29,155,240,0.25)',
                ].join(';');
                toggleBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    isOriginal = !isOriginal;
                    textEl.textContent = isOriginal ? originalText : rewrittenText;
                    toggleBtn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
                });
                textEl.parentNode.insertBefore(toggleBtn, textEl);
            }
            let meta = { applied: true, label: entry.prompt_label || '', map_id: manipMapId_IGR };
            if (manipConfig_IGR.logOriginal) meta.original_text = originalText;
            manipApplied_IGR[currentReelShortcode] = meta;
        }
    }

    var shortcode = currentReelShortcode;
    var containerRef = bestEl;
    console.log('[SA-R-7] INJECTING SURVEY | shortcode:', shortcode, '| owner:', postOwner);
    injectInstagramReelSurvey(shortcode);
    reelCtx.renderSurvey(postOwner, shortcode, {
        body:         () => extractReelText(containerRef),
        media_urls:   () => {
            var urls = extractReelMedia(containerRef);
            var apiMap = window.__socialAnnotate__.instagramApiMediaMap || {};
            console.log('[SA-R-8] media_urls lazy called | shortcode:', shortcode, '| DOM urls:', urls, '| API map entry:', apiMap[shortcode] || 'EMPTY');
            if (apiMap[shortcode] && apiMap[shortcode].length > 0) {
                let apiVids = apiMap[shortcode];
                urls = urls.filter(u => !u.startsWith('[Blob Stream]'));
                urls.push(...apiVids);
            }
            return [...new Set(urls)];
        },
        created_at:   () => null,
        post_metrics: () => ({})
    });
}

// ─────────────────────────────────────────────────────────

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
    if (window.location.protocol === 'file:') return true;
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') return true;
    let uname = crawlUserName();
    return !(uname === '' || uname === 'home');
}

function extractInstagramPostDetails(articleNode) {
    // Tier 1: specific post link selector
    let postLinkEl = articleNode.querySelector(SEL_IG.postLink || "a[href*='/p/'], a[href*='/reel/']");

    // Tier 2: anchor-scan if specific selector returned nothing
    if (!postLinkEl) {
        let anchors = articleNode.querySelectorAll('a[href]');
        for (let a of anchors) {
            if (/\/(?:p|reel)\/[^/?#]+/.test(a.getAttribute('href') || '')) {
                postLinkEl = a;
                break;
            }
        }
    }

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
    _processedCount_IG++;
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

            // ── Manipulation DOM patch ────────────────────────────
            if (manipConfig_IG.enabled && manipMap_IG[postDetails.postID]) {
                let entry   = manipMap_IG[postDetails.postID];
                // Find the longest text element — mirrors extractInstagramText logic
                let textEl  = null;
                let longest = 0;
                articleNode.querySelectorAll(SEL_IG.postText || "h1[dir='auto'], span[dir='auto']").forEach(el => {
                    let len = (el.innerText || el.textContent || '').length;
                    if (len > longest) { longest = len; textEl = el; }
                });
                if (textEl) {
                    let rewrittenText = entry.rewritten_text;
                    let originalText  = entry.original_text || '';
                    textEl.textContent = rewrittenText;
                    if (manipConfig_IG.mode === 'aware') {
                        let isOriginal = false;
                        let toggleBtn  = document.createElement('button');
                        toggleBtn.textContent = '👁 Show original';
                        toggleBtn.setAttribute('data-sa-manip-toggle', '1');
                        toggleBtn.style.cssText = [
                            'display:block','margin-left:auto','margin-bottom:4px',
                            'padding:2px 10px','font-size:11px','line-height:1.6',
                            'cursor:pointer','border-radius:4px',
                            'background:rgba(29,155,240,0.08)','color:rgb(29,155,240)',
                            'border:1px solid rgba(29,155,240,0.25)',
                            'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
                        ].join(';');
                        toggleBtn.addEventListener('click', function (e) {
                            e.stopPropagation();
                            isOriginal = !isOriginal;
                            textEl.textContent = isOriginal ? originalText : rewrittenText;
                            toggleBtn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
                        });
                        textEl.parentNode.insertBefore(toggleBtn, textEl);
                    }
                    let meta = { applied: true, label: entry.prompt_label || '', map_id: manipMapId_IG };
                    if (manipConfig_IG.logOriginal) meta.original_text = originalText;
                    manipApplied_IG[postDetails.postID] = meta;
                }
            }
            // ─────────────────────────────────────────────────────

            injectInstagramPostSurvey(articleNode, postDetails.postID, postDetails.postOwner);
            postCtx.renderSurvey(
                postDetails.postOwner,
                postDetails.postID,
                {
                    body: () => extractInstagramText(articleNode),
                    media_urls: () => extractInstagramMedia(articleNode),
                    created_at: () => { let t = articleNode.querySelector(SEL_IG.postTimestamp || 'time[datetime]'); return t ? t.getAttribute('datetime') : null; },
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

    let textEls = articleNode.querySelectorAll(SEL_IG.postText || "h1[dir='auto'], span[dir='auto']");
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
                        // Check for comment anchors on any page (post, reel, or feed modal)
                        let commentCtx = availableContextsInstagram.find(function(c) { return c.name === 'instagram-comment'; });
                        if (commentCtx && commentCtx.formTemplate) {
                            let commentSel = SEL_IGC.commentTimestampAnchor || "a[href*='/c/'][role='link']";
                            if (node.matches && node.matches(commentSel)) {
                                console.log('[SA-IGC] observer: direct comment anchor match', node.getAttribute('href'));
                                processInstagramCommentAnchor(node);
                            } else if (node.querySelectorAll) {
                                let found = node.querySelectorAll(commentSel);
                                if (found.length) console.log('[SA-IGC] observer: found', found.length, 'comment anchor(s) inside added node', node.tagName, node.className && node.className.slice(0,40));
                                found.forEach(processInstagramCommentAnchor);
                            }
                        } else {
                            console.log('[SA-IGC] observer: comment context not ready (formTemplate null), skipping node');
                        }

                        if (isReelPage()) {
                            let reelSel = SEL_IGR.postContainer || 'div[aria-label="Video player"][role="group"]';
                            if (node.matches && node.matches(reelSel)) {
                                if (_reelIO) _reelIO.observe(node);
                                processCurrentReel();
                            } else if (node.querySelector && node.querySelector(reelSel)) {
                                node.querySelectorAll(reelSel).forEach(function(el) { if (_reelIO) _reelIO.observe(el); });
                                processCurrentReel();
                            }
                        } else {
                            if (node.tagName && node.tagName.toLowerCase() === 'article') {
                                processInstagramArticleNode(node);
                            } else {
                                let articles = node.querySelectorAll(SEL_IG.postContainer || 'article');
                                articles.forEach(processInstagramArticleNode);
                            }
                        }
                    }
                });
            }
        }
    };
    return new MutationObserver(observerCallback);
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'selectors', 'manipulationMaps'], function (result) {

        // Load selectors into the module-level variables
        const _rawIG = (result.selectors && result.selectors.instagram) ? result.selectors.instagram : {};
        SEL_IG = { ...(_rawIG.shared || {}), ...(_rawIG.account || {}), ...(_rawIG.post || {}) };
        const _rawIGR = (result.selectors && result.selectors.instagram && result.selectors.instagram.reel) ? result.selectors.instagram.reel : {};
        SEL_IGR = { ...(_rawIGR.shared || {}), ...(_rawIGR.account || {}), ...(_rawIGR.post || {}) };
        SEL_IGC = (_rawIG.comment) ? { ..._rawIG.comment } : {};
        watchPostCounter('instagram', function () { return _processedCount_IG; });

        // Load manipulation map for instagram-post
        const _postConfIG = result.config && result.config.surveys && result.config.surveys['instagram-post'];
        manipConfig_IG = (_postConfIG && _postConfIG.manipulation) || {};
        if (manipConfig_IG.enabled && result.manipulationMaps && result.manipulationMaps['instagram-post']) {
            let fullMap = result.manipulationMaps['instagram-post'];
            manipMapId_IG = (fullMap._meta && fullMap._meta.map_id) || '';
            for (let k in fullMap) { if (k !== '_meta') manipMap_IG[k] = fullMap[k]; }
        }

        // Load manipulation map for instagram-reel
        const _reelConf = result.config && result.config.surveys && result.config.surveys['instagram-reel'];
        manipConfig_IGR = (_reelConf && _reelConf.manipulation) || {};
        if (manipConfig_IGR.enabled && result.manipulationMaps && result.manipulationMaps['instagram-reel']) {
            let fullMap = result.manipulationMaps['instagram-reel'];
            manipMapId_IGR = (fullMap._meta && fullMap._meta.map_id) || '';
            for (let k in fullMap) { if (k !== '_meta') manipMap_IGR[k] = fullMap[k]; }
        }

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

                        // Attach manipulation metadata (reel uses its own applied map)
                        let _manipApplied = currentContext.name === 'instagram-reel' ? manipApplied_IGR : manipApplied_IG;
                        let _ma = _manipApplied[values.post_id];
                        if (_ma) {
                            values.manipulation_applied = true;
                            values.manipulation_label   = _ma.label;
                            values.manipulation_map_id  = _ma.map_id;
                            if (_ma.original_text !== undefined) values.original_text = _ma.original_text;
                        } else {
                            values.manipulation_applied = false;
                        }

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
                currentContext.theme = config.theme || "light";
                currentContext.submitAction = submitAction;
                console.log('[SA-IGC] context activated:', currentContext.name);

                if (currentContext.name === 'instagram-reel' || currentContext.name === 'instagram-comment') {
                    // No page-level injection; per-item injection is handled by processInstagramCommentAnchor / processCurrentReel
                } else {
                    currentContext.injectSurvey(config.injectElement);
                    if (currentContext.name === 'instagram-user') {
                        _processedCount_IG++;
                        let surveyID = crawlUserName();
                        currentContext.renderSurvey(surveyID, null, {
                            user_profile: () => extractUserProfile()
                        });
                    }
                }
            }
        }

        // Start observer only after formTemplate is set — prevents race condition
        // where observer fires renderSurvey before config is loaded.
        let filter = (isReelPage() ? SEL_IGR.observerFilter : SEL_IG.observerFilter) || { childList: true, subtree: true };
        igObserver.observe(observerTarget, filter);

        if (isReelPage()) {
            observeReelContainers();
            processCurrentReel();
            setTimeout(function() { observeReelContainers(); processCurrentReel(); }, 1500);
        } else {
            // Process articles already in the DOM
            document.querySelectorAll(SEL_IG.postContainer || 'article').forEach(processInstagramArticleNode);
            setTimeout(() => {
                document.querySelectorAll(SEL_IG.postContainer || 'article').forEach(processInstagramArticleNode);
            }, 1500);
        }

        // Scan for comment anchors already in the DOM (post/reel detail pages)
        let commentSel = SEL_IGC.commentTimestampAnchor || "a[href*='/c/'][role='link']";
        console.log('[SA-IGC] init scan | sel:', commentSel, '| found:', document.querySelectorAll(commentSel).length, '| url:', window.location.pathname);
        document.querySelectorAll(commentSel).forEach(processInstagramCommentAnchor);
        [1500, 3500].forEach(function(d) {
            setTimeout(function() {
                let found = document.querySelectorAll(commentSel);
                console.log('[SA-IGC] delayed scan @' + d + 'ms | found:', found.length, '| url:', window.location.pathname);
                found.forEach(processInstagramCommentAnchor);
            }, d);
        });
    });
}

// Declare at module level so they are accessible inside initializeSurveys callback
let igObserver = createObserver();
let observerTarget = document.body;

window.__socialAnnotate__.platformDebugCapture = function(selectors, stored) {
    let raw = selectors.instagram || {};
    let SEL_D = Object.assign({}, raw.shared || {}, raw.account || {}, raw.post || {});
    let activeSurvey = stored && stored.config && stored.config.activeSurveys && stored.config.activeSurveys[0];

    let isUser = activeSurvey ? activeSurvey.endsWith('-user') : checkUserURL();
    let scopeEl = isUser ? document : (document.querySelector(SEL_D.postContainer || 'article') || document);

    function probe(field) {
        let selector = SEL_D[field];
        if (!selector) return { field, selector: null, matched: false, value: null, note: 'not in selectors.json' };
        try {
            if (field === 'postText') {
                let els = scopeEl.querySelectorAll(selector);
                let longest = '', bestEl = null;
                els.forEach(e => { let t = (e.innerText || e.textContent || '').trim(); if (t.length > longest.length) { longest = t; bestEl = e; } });
                return { field, selector, matched: !!bestEl, value: bestEl ? longest.slice(0, 200) : null };
            }
            let el = scopeEl.querySelector(selector);
            return { field, selector, matched: !!el, value: el ? (el.src || el.currentSrc || el.textContent.trim().slice(0, 200) || null) : null };
        } catch(e) {
            return { field, selector, matched: false, value: null, note: 'invalid selector' };
        }
    }

    let section = isUser ? (raw.account || {}) : (raw.post || {});
    return {
        platform: 'instagram',
        surveyType: activeSurvey || (isUser ? 'instagram-user' : 'instagram-post'),
        injectionStatus: {
            userSurveyInjected: !!document.getElementById('surveyFormContainer'),
            postSurveysInjected: document.querySelectorAll('.survey-container-post').length
        },
        extractedData: { userID: crawlUserName() },
        selectorDiagnostics: Object.keys(section).filter(f => !['postVideo','postImage','userBanner'].includes(f)).map(probe)
    };
};

// Fire the survey initializer on script load — observer is started inside once formTemplate is ready
initializeSurveys();

// Re-initialize when the user toggles surveys in the popup (no page reload needed).
// This is critical for instagram-comment: the comment section only appears after a user
// click, so we must be ready before that click even if config changed after page load.
chrome.storage.onChanged.addListener(function(changes, area) {
    if (area !== 'local') return;
    if (changes.config || changes.isEnabled) {
        igObserver.disconnect();
        availableContextsInstagram.forEach(function(ctx) { ctx.formTemplate = null; });
        _injectedIGComments.clear();
        initializeSurveys();
    }
});
