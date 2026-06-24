
// Context class is defined in shared.js
const availableContextsTwitter = [new Context('x-user', injectTwitterUserSurvey, checkUserURL),
new Context('x-post', enableTweetObserver, null)];

// Selectors loaded from storage (populated by initializeSurveys)
let SEL = {};

// MutationObserver globals — initialized after selectors are loaded
let reactRoot = null;
let obsConfig = {};
let observer = null;

if (!window.__socialAnnotate__) window.__socialAnnotate__ = {};
if (!window.__socialAnnotate__.twitterApiMediaMap) window.__socialAnnotate__.twitterApiMediaMap = {};

// ── Manipulation state (loaded once at startup) ──────────
let manipConfig  = {};  // { enabled, source, mode, logOriginal, endpoint }
let manipMap     = {};  // { post_id: { rewritten_text, original_text, prompt_label, ... } }
let manipMapId   = '';  // _meta.map_id from the imported map
let manipApplied      = {};  // { tweetID: { applied, label, map_id, original_text?, extras? } }
const _inFlight_X = new Set(); // tweetIDs currently awaiting API response

// ── User intervention state ───────────────────────────────
let manipConfig_XU   = {};  // { enabled, endpoint, mode, fields: { profile_name, handle, … } }
let manipApplied_XU  = {};  // { userID: { applied, fields: { field: { original, rewritten } } } }
let _processedCount_X   = 0;
registerHealthCounter(function () { return _processedCount_X; });
document.addEventListener('mh:media-response', function (e) {
    if (e.detail) {
        Object.assign(window.__socialAnnotate__.twitterApiMediaMap, e.detail);
    }
});

window.addEventListener('mh:download-request', function (e) {
    let detail = e.detail;
    if (!detail) return;

    let initialSurveyType = detail.surveyType || 'x-post';

    // User-survey downloads (profile picture & banner) are handled directly
    // in the submitAction to avoid race conditions with guided-mode navigation.
    if (initialSurveyType === 'x-user') return;

    if (!detail.postID) return;

    let tweetID = detail.postID;
    let tweetOwner = detail.userID;
    let postSurveyType = detail.surveyType || 'x-post';

    let containerName = 'surveyFormContainer-' + tweetID;
    let surveyContainer = document.getElementById(containerName);
    let injectNode = surveyContainer ? surveyContainer.parentNode : null;

    let urlsToDownload = [];
    if (window.__socialAnnotate__ && window.__socialAnnotate__.twitterApiMediaMap && window.__socialAnnotate__.twitterApiMediaMap[tweetID]) {
        urlsToDownload = window.__socialAnnotate__.twitterApiMediaMap[tweetID];
    } else {
        if (injectNode) {
            urlsToDownload = extractTweetMedia(injectNode);
        }
    }

    if (urlsToDownload && urlsToDownload.length > 0) {
        urlsToDownload = urlsToDownload.filter(u => !u.startsWith('blob:') && !u.startsWith('[Video Thumbnail]'));
        if (urlsToDownload.length > 0) {
            chrome.runtime.sendMessage({ action: 'downloadMedia', urls: urlsToDownload, userId: tweetOwner || 'user', postId: tweetID, surveyType: postSurveyType });
        } else {
            console.log("No original media URLs found. Wait for the API to load or check the post.");
        }
    } else {
        console.log("No media found on this post.");
    }
});

// Like innerText but includes <img alt="…"> as the emoji character.
// X renders emojis as <img> elements — plain innerText silently drops them.
function _xInnerText(el) {
    let parts = [];
    el.childNodes.forEach(function (node) {
        if (node.nodeType === Node.TEXT_NODE) {
            parts.push(node.textContent);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'IMG') {
                let alt = node.getAttribute('alt');
                if (alt) parts.push(alt);
            } else if (node.tagName === 'BR') {
                parts.push('\n');
            } else {
                parts.push(_xInnerText(node));
            }
        }
    });
    return parts.join('');
}

// Returns the main tweet's text element, skipping quoted-tweet and card nested copies.
function _xMainTextEl(articleNode) {
    let all = articleNode.querySelectorAll(SEL.postText || '[data-testid="tweetText"]');
    for (let el of all) {
        if (!el.closest('[data-testid="card.wrapper"]') && !el.closest('[role="link"][tabindex="0"]')) return el;
    }
    return all[0] || null;
}

// Sets rewritten text while:
//   - preserving mention and URL <a> tags (re-inserted by matching text)
//   - removing hashtag <a> tags absent from the rewritten text
//   - preserving the "Show more" link
function _xApplyText(textEl, text) {
    let showMore = textEl.querySelector('[data-testid="tweet-text-show-more-link"]');

    // Collect mention + URL links (not hashtags) that still appear in the rewritten text
    let keepLinks = [];
    textEl.querySelectorAll('a[href]').forEach(function (a) {
        if (a === showMore) return;
        let href = a.getAttribute('href') || '';
        if (href.includes('/hashtag/')) return;
        let linkText = a.textContent;
        if (linkText && text.includes(linkText)) keepLinks.push({ match: linkText, el: a.cloneNode(true) });
    });

    // Collect emoji <img alt="…"> elements in DOM order
    let emojiImgs = Array.from(textEl.querySelectorAll('img[alt]'))
        .map(function (img) { return { match: img.getAttribute('alt'), el: img.cloneNode(true) }; })
        .filter(function (e) { return e.match && text.includes(e.match); });

    textEl.textContent = text;

    // Re-insert each preserved node (links + emojis) by locating its text in the DOM
    function _reinsert(items) {
        for (let i = 0; i < items.length; i++) {
            let match = items[i].match, el = items[i].el;
            let walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT, null);
            let node;
            while ((node = walker.nextNode())) {
                let idx = node.textContent.indexOf(match);
                if (idx === -1) continue;
                let before = node.textContent.slice(0, idx);
                let after  = node.textContent.slice(idx + match.length);
                let parent = node.parentNode;
                if (before) parent.insertBefore(document.createTextNode(before), node);
                parent.insertBefore(el, node);
                if (after)  parent.insertBefore(document.createTextNode(after), node);
                parent.removeChild(node);
                break;
            }
        }
    }

    _reinsert(keepLinks);
    _reinsert(emojiImgs);

    if (showMore) textEl.appendChild(showMore);
}

// originalNodes: Array of cloned childNodes captured before _xApplyText was called.
// Restoring from the snapshot preserves hashtag/mention/emoji links exactly.
function _xToggleBtn(textEl, originalNodes, rewrittenText) {
    let isOriginal = false;
    let btn = document.createElement('button');
    btn.textContent = '👁 Show original';
    btn.setAttribute('data-sa-interv-toggle', '1');
    btn.style.cssText = [
        'display:block', 'margin-left:auto', 'margin-bottom:4px',
        'padding:2px 10px', 'font-size:11px', 'line-height:1.6',
        'cursor:pointer', 'border-radius:4px',
        'background:rgba(29,155,240,0.08)', 'color:rgb(29,155,240)',
        'border:1px solid rgba(29,155,240,0.25)',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
    ].join(';');
    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        isOriginal = !isOriginal;
        if (isOriginal) {
            // Restore original DOM snapshot — preserves hashtag/mention/emoji links
            while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
            originalNodes.forEach(function (n) { textEl.appendChild(n.cloneNode(true)); });
        } else {
            _xApplyText(textEl, rewrittenText);
        }
        btn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
    });
    textEl.parentNode.insertBefore(btn, textEl);
}

function _xGetTimestamp(insertElement) {
    let t = insertElement.querySelector(SEL.postTimestamp || 'time');
    if (!t) return null;
    let dt = t.getAttribute('datetime') || t.dateTime;
    if (dt) return dt;
    let unix = t.getAttribute('data-time');
    return unix ? new Date(parseInt(unix, 10) * 1000).toISOString() : null;
}

async function processArticleNode(articleNode) {
    let insertElement = articleNode.parentNode;
    if (!insertElement || insertElement.getElementsByClassName('survey-container-tweet').length > 0) return;

    let tweetDetails = extractTweetDetails(insertElement);
    if (!tweetDetails) return;
    if (_inFlight_X.has(tweetDetails.tweetID)) return;

    _processedCount_X++;

    // ── Live API intervention path ────────────────────────
    if (manipConfig.enabled && manipConfig.source === 'api' && manipConfig.endpoint && window.__sa_intervApi) {
        _inFlight_X.add(tweetDetails.tweetID);

        function _xApplyResult(result, targetArticle) {
            let textEl = _xMainTextEl(targetArticle);
            if (textEl) {
                let originalNodes = Array.from(textEl.childNodes).map(function (n) { return n.cloneNode(true); });
                _xApplyText(textEl, result.rewritten_text);
                if (manipConfig.mode === 'aware') _xToggleBtn(textEl, originalNodes, result.rewritten_text);
            }
        }

        // If already cached (e.g. navigated from feed to tweet detail), apply synchronously
        let cached = window.__sa_intervApi.getCached(tweetDetails.tweetID);
        if (cached) {
            _xApplyResult(cached, articleNode);
            _inFlight_X.delete(tweetDetails.tweetID);
            injectTwitterTweetSurvey(insertElement, tweetDetails.tweetID, tweetDetails.tweetOwner);
            availableContextsTwitter[1].renderSurvey(
                tweetDetails.tweetOwner, tweetDetails.tweetID,
                { body: () => cached.rewritten_text, media_urls: () => extractTweetMedia(insertElement), post_metrics: () => extractTweetMetrics(insertElement), created_at: () => _xGetTimestamp(insertElement) }
            );
            return;
        }

        let overlay = window.__sa_intervApi.createOverlay(articleNode, manipConfig.mode);

        let postData = {
            post_id:      tweetDetails.tweetID,
            account_id:   tweetDetails.tweetOwner,
            body:         extractTweetTextContent(insertElement),
            created_at:   _xGetTimestamp(insertElement),
            media_urls:   extractTweetMedia(insertElement),
            post_metrics: extractTweetMetrics(insertElement)
        };

        let doRetry = function () {
            _inFlight_X.delete(tweetDetails.tweetID);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            processArticleNode(articleNode);
        };

        try {
            let result = await window.__sa_intervApi.queuePost(postData);

            let meta = { applied: true, label: result.prompt_label || '', map_id: result.map_id || window.__sa_intervApi.getMapId() };
            if (manipConfig.logOriginal) meta.original_text = postData.body;
            let extras = {};
            for (let k in result) {
                if (!['post_id', 'rewritten_text', 'map_id', 'prompt_label'].includes(k)) extras[k] = result[k];
            }
            if (Object.keys(extras).length > 0) meta.extras = extras;
            manipApplied[tweetDetails.tweetID] = meta;

            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            _inFlight_X.delete(tweetDetails.tweetID);

            // Re-query after overlay removal — React may have re-rendered during the await
            let liveArticle = document.querySelector(`a[href*="/status/${tweetDetails.tweetID}"]`)
                ?.closest('article[data-testid="tweet"]') || articleNode;
            _xApplyResult(result, liveArticle);

            injectTwitterTweetSurvey(insertElement, tweetDetails.tweetID, tweetDetails.tweetOwner);
            availableContextsTwitter[1].renderSurvey(
                tweetDetails.tweetOwner, tweetDetails.tweetID,
                { body: () => result.rewritten_text, media_urls: () => extractTweetMedia(insertElement), post_metrics: () => extractTweetMetrics(insertElement), created_at: () => _xGetTimestamp(insertElement) }
            );
        } catch (err) {
            overlay.showError(doRetry);
        }
        return;
    }
    // ─────────────────────────────────────────────────────

    // ── Static map manipulation path ─────────────────────
    if (manipConfig.enabled && manipConfig.source !== 'api' && manipMap[tweetDetails.tweetID]) {
        let entry   = manipMap[tweetDetails.tweetID];
        let textEl  = _xMainTextEl(articleNode);
        if (textEl) {
            let rewrittenText = entry.rewritten_text;
            let originalNodes = Array.from(textEl.childNodes).map(function (n) { return n.cloneNode(true); });
            _xApplyText(textEl, rewrittenText);
            if (manipConfig.mode === 'aware') _xToggleBtn(textEl, originalNodes, rewrittenText);
            let meta = { applied: true, label: entry.prompt_label || '', map_id: manipMapId };
            if (manipConfig.logOriginal) meta.original_text = originalText;
            manipApplied[tweetDetails.tweetID] = meta;
        }
        if (entry.replacement_image) {
            let avatarContainer = articleNode.querySelector(SEL.postAuthorAvatar || '[data-testid="Tweet-User-Avatar"]');
            if (avatarContainer && !avatarContainer.querySelector('[data-sa-avatar]')) {
                let av = document.createElement('div');
                av.setAttribute('data-sa-avatar', '1');
                av.style.cssText = [
                    'position:absolute', 'inset:0', 'border-radius:50%',
                    'background:url("' + entry.replacement_image + '") center/cover no-repeat',
                    'z-index:2', 'pointer-events:none'
                ].join(';');
                avatarContainer.style.position = 'relative';
                avatarContainer.appendChild(av);
            }
        }
    }
    // ─────────────────────────────────────────────────────

    injectTwitterTweetSurvey(insertElement, tweetDetails.tweetID, tweetDetails.tweetOwner);
    availableContextsTwitter[1].renderSurvey(
        tweetDetails.tweetOwner,
        tweetDetails.tweetID,
        {
            body:         () => extractTweetTextContent(insertElement),
            media_urls:   () => extractTweetMedia(insertElement),
            post_metrics: () => extractTweetMetrics(insertElement),
            created_at:   () => _xGetTimestamp(insertElement)
        }
    );
}

function createObserver() {
    const observerCallback = function (mutationsList, obs) {
        for (let mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // ELEMENT_NODE
                        if (node.getAttribute('role') === 'article') {
                            processArticleNode(node);
                        } else {
                            let articles = node.querySelectorAll(SEL.postContainer || 'article[role="article"]');
                            articles.forEach(processArticleNode);
                        }
                    }
                });
            } else if (mutation.type === 'attributes') {
                if (mutation.target.getAttribute('role') === "article") {
                    processArticleNode(mutation.target);
                }
            }
        }
    };
    return new MutationObserver(observerCallback);
}


function crawlUserName() {
    let currentURL = window.location.href;
    // Handle file:// URLs for local testing
    if (window.location.protocol === 'file:') {
        // Try to extract from page DOM instead
        let handle = document.querySelector(SEL.userHandle || '[data-testid="UserName"] a[href] span');
        if (handle) {
            let text = handle.textContent.trim().replace(/^@/, '');
            if (text) return text;
        }
        return 'local-test-user';
    }
    let temp = currentURL.split('.com/');
    temp = temp[temp.length - 1];
    temp = temp.split('/')[0].split('?')[0];
    return temp;
}

/**
 * Extract the profile avatar URL from the current page.
 * X/Twitter has changed their DOM structure multiple times, so this function
 * tries multiple strategies in order of reliability.
 *
 * All selectors come from SEL (populated from selectors.json) so that
 * selector_agent.py can update them dynamically without code changes.
 */
function getProfileAvatarUrl() {
    // Strategy 1: JSON-LD structured data (most reliable source)
    // X injects a <script type="application/ld+json"> that always contains
    // the profile image URL at 400x400 resolution.
    try {
        let schemaSelector = SEL.userProfileSchema || 'script[data-testid="UserProfileSchema-test"]';
        let schemaEl = document.querySelector(schemaSelector);
        if (schemaEl) {
            let schema = JSON.parse(schemaEl.textContent);
            let imageUrl = schema?.mainEntity?.image?.contentUrl;
            if (imageUrl) return imageUrl;
            let thumbUrl = schema?.mainEntity?.image?.thumbnailUrl;
            if (thumbUrl) return thumbUrl;
        }
    } catch (e) { /* JSON parse failed, continue to next strategy */ }

    // Strategy 2: Avatar container element (SEL.userProfileAvatar)
    // This may be a direct img selector or a container; handle both.
    let avatarSelector = SEL.userProfileAvatar || '[data-testid^="UserAvatar-Container-"]';
    let avatarContainer = document.querySelector(avatarSelector);
    if (avatarContainer) {
        // If the selector matched an <img> directly, return its src
        if (avatarContainer.tagName === 'IMG' && avatarContainer.src) return avatarContainer.src;
        // Otherwise search inside the container
        let img = avatarContainer.querySelector('img[src*="profile_images"]');
        if (img && img.src) return img.src;
        let anyImg = avatarContainer.querySelector('img[src*="pbs.twimg.com"]');
        if (anyImg && anyImg.src) return anyImg.src;
    }

    // Strategy 3: Legacy fallback — [data-testid="UserAvatar"]
    let legacyContainer = document.querySelector('[data-testid="UserAvatar"]');
    if (legacyContainer) {
        let img = legacyContainer.querySelector('img[src*="profile_images"]');
        if (img && img.src) return img.src;
        let anyImg = legacyContainer.querySelector('img[src*="pbs.twimg.com"]');
        if (anyImg && anyImg.src) return anyImg.src;
    }

    // Strategy 4: background-image CSS on avatar container divs
    let containers = document.querySelectorAll(avatarSelector + ', [data-testid="UserAvatar"]');
    for (let container of containers) {
        let allDivs = container.querySelectorAll('div');
        for (let div of allDivs) {
            let bg = window.getComputedStyle(div).backgroundImage;
            if (bg && bg !== 'none' && bg.includes('profile_images')) {
                let match = bg.match(/url\(["']?(.*?)["']?\)/);
                if (match && match[1]) return match[1];
            }
        }
    }

    // Strategy 5: Page-wide fallback — any img with profile_images not inside tweets
    let allProfileImgs = document.querySelectorAll('img[src*="profile_images"]');
    for (let img of allProfileImgs) {
        let tweetAvatar = img.closest('[data-testid="Tweet-User-Avatar"]');
        if (!tweetAvatar && img.src) return img.src;
    }

    return null;
}

function extractUserProfile() {
    let profile = {};

    // Display name
    try {
        let nameEl = document.querySelector(SEL.userDisplayName || '[data-testid="UserName"]');
        if (nameEl) {
            // The first text-containing span is the display name
            let spans = nameEl.querySelectorAll('span');
            for (let s of spans) {
                let text = s.textContent.trim();
                if (text && !text.startsWith('@')) {
                    profile.profile_name = text;
                    break;
                }
            }
        }
    } catch (e) { /* skip */ }

    // Handle / @username — URL is the canonical source on a profile page.
    // DOM selectors (SEL.userHandle) can match retweet author elements in the feed.
    try {
        let urlHandle = crawlUserName();
        if (urlHandle && urlHandle !== 'local-test-user') {
            profile.handle = '@' + urlHandle;
        } else {
            let handleEl = document.querySelector(SEL.userHandle || '[data-testid="UserName"] a[href] span');
            if (handleEl) profile.handle = handleEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    // Profile picture URL
    try {
        let avatarUrl = getProfileAvatarUrl();
        if (avatarUrl) {
            profile.profile_img_url = avatarUrl;
        }
    } catch (e) { /* skip */ }

    // Bio / description
    try {
        let bioEl = document.querySelector(SEL.userBio || '[data-testid="UserDescription"]');
        if (bioEl) {
            profile.bio = bioEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    // Verified badge
    try {
        let verifiedEl = document.querySelector(SEL.userVerified || '[data-testid="icon-verified"]');
        profile.isVerified = !!verifiedEl;
    } catch (e) {
        profile.isVerified = false;
    }

    // Followers count
    try {
        let followersEl = document.querySelector(SEL.userFollowers || 'a[href$="/verified_followers"], a[href$="/followers"]');
        if (followersEl) {
            let text = followersEl.textContent.trim();
            profile.followersText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/);
            if (numMatch) profile.followersCount = numMatch[1];
        }
    } catch (e) { /* skip */ }

    // Following count
    try {
        let followingEl = document.querySelector(SEL.userFollowing || 'a[href$="/following"]');
        if (followingEl) {
            let text = followingEl.textContent.trim();
            profile.followingText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/);
            if (numMatch) profile.followingCount = numMatch[1];
        }
    } catch (e) { /* skip */ }

    // Posts count — X shows "1,234 posts" in an <h2> above the timeline tabs
    try {
        let postsEl = SEL.user_post_count ? document.querySelector(SEL.user_post_count) : null;
        if (!postsEl) {
            let headings = document.querySelectorAll('h2[role="heading"] div, h2[role="heading"] span');
            for (let h of headings) {
                if (h.childElementCount === 0 && /^[\d,.KMBkmb\s]+\s+posts?$/i.test(h.textContent.trim())) {
                    postsEl = h; break;
                }
            }
        }
        if (postsEl) {
            let text = postsEl.textContent.trim();
            profile.postsText = text;
            let numMatch = text.match(/([\d,.]+[KMB]?)/);
            if (numMatch) profile.postsCount = numMatch[1];
        }
    } catch (e) { /* skip */ }

    // Location
    try {
        let locEl = document.querySelector(SEL.userLocation || '[data-testid="UserLocation"]');
        if (locEl) {
            profile.location = locEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    // Join date
    try {
        let joinEl = document.querySelector(SEL.userJoinDate || '[data-testid="UserJoinDate"]');
        if (joinEl) {
            profile.created_at = joinEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    // Website URL
    try {
        let urlEl = document.querySelector(SEL.userUrl || '[data-testid="UserUrl"]');
        if (urlEl) {
            let link = urlEl.querySelector('a');
            profile.websiteUrl = link ? link.href : urlEl.textContent.trim();
        }
    } catch (e) { /* skip */ }

    return profile;
}


function injectTwitterUserSurvey(injectElement, userID) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-user";
    surveyContainer.setAttribute("id", "surveyFormContainer");
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/x/inject.css");
    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    // Inject the survey before the react root.
    let fixedBar = document.querySelector(SEL.appRoot || '#react-root');
    if (fixedBar) {
        fixedBar.insertAdjacentElement('beforebegin', surveyContainer);
    }
}

// ── User intervention helpers ─────────────────────────────

function _xuGetFieldEl(field) {
    switch (field) {
        case 'profile_name': {
            let nameEl = document.querySelector(SEL.userDisplayName || '[data-testid="UserName"]');
            if (!nameEl) return null;
            let spans = nameEl.querySelectorAll('span');
            // Allow spans with only <img> children (emoji/verified badge) — just no nested spans/divs
            for (let s of spans) {
                let txt = s.textContent.trim();
                if (!txt || txt.startsWith('@')) continue;
                let hasBlockChild = Array.from(s.children).some(function(c) { return c.tagName === 'SPAN' || c.tagName === 'DIV'; });
                if (!hasBlockChild) return s;
            }
            return null;
        }
        case 'handle': {
            // The @handle span lives outside [data-testid="User-Name"] — use the outer UserName wrapper
            let outer = document.querySelector('[data-testid="UserName"]');
            if (!outer) return null;
            let spans = outer.querySelectorAll('span');
            for (let s of spans) {
                if (s.childElementCount === 0 && s.textContent.trim().startsWith('@')) return s;
            }
            return null;
        }
        case 'followers_count': {
            let a = document.querySelector(SEL.userFollowers || 'a[href$="/verified_followers"], a[href$="/followers"]');
            if (!a) return null;
            let spans = a.querySelectorAll('span');
            for (let s of spans) {
                if (s.childElementCount === 0 && /^[\d,.KMBkmb]+$/.test(s.textContent.trim())) return s;
            }
            return null;
        }
        case 'following_count': {
            let a = document.querySelector(SEL.userFollowing || 'a[href$="/following"]');
            if (!a) return null;
            let spans = a.querySelectorAll('span');
            for (let s of spans) {
                if (s.childElementCount === 0 && /^[\d,.KMBkmb]+$/.test(s.textContent.trim())) return s;
            }
            return null;
        }
        case 'bio':
            return document.querySelector(SEL.userBio || '[data-testid="UserDescription"]');
        case 'posts_count': {
            // X shows "1,234 posts" in an <h2> above the timeline tabs
            if (SEL.user_post_count) {
                let el = document.querySelector(SEL.user_post_count);
                if (el) return el;
            }
            let headings = document.querySelectorAll('h2[role="heading"] div, h2[role="heading"] span');
            for (let h of headings) {
                if (h.childElementCount === 0 && /^[\d,.KMBkmb\s]+\s+posts?$/i.test(h.textContent.trim())) return h;
            }
            return null;
        }
    }
    return null;
}

function _xuToggleBtn(fieldEl, originalText, rewrittenText) {
    let isOriginal = false;
    let btn = document.createElement('button');
    btn.textContent = '👁 Show original';
    btn.setAttribute('data-sa-interv-toggle', '1');
    btn.style.cssText = [
        'display:inline-block','margin-left:6px','padding:1px 8px','font-size:11px',
        'line-height:1.6','cursor:pointer','border-radius:4px','vertical-align:middle',
        'background:rgba(29,155,240,0.08)','color:rgb(29,155,240)',
        'border:1px solid rgba(29,155,240,0.25)',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
    ].join(';');
    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        isOriginal = !isOriginal;
        fieldEl.textContent = isOriginal ? originalText : rewrittenText;
        btn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
    });
    let anchor = fieldEl.closest('a');
    if (anchor) {
        // followers/following: insert after the <a> block
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    } else {
        // posts_count (and others): fieldEl is a block-level div in a flex column.
        // Wrap fieldEl + button together so they become one flex item side-by-side.
        let wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;align-items:center;gap:4px;';
        fieldEl.parentNode.insertBefore(wrapper, fieldEl);
        wrapper.appendChild(fieldEl);
        wrapper.appendChild(btn);
        btn.style.marginLeft = '0';
    }
}

async function _applyXUserIntervention(userID, profile) {
    if (!manipConfig_XU.enabled || !manipConfig_XU.endpoint) return;
    let fields = manipConfig_XU.fields || {};
    let fieldsToIntervene = Object.keys(fields).filter(function(f) { return fields[f]; });
    if (fieldsToIntervene.length === 0) return;

    let removeOverlay = _createUserInterventionOverlay();

    let payload = {
        survey_type: 'x-user',
        platform: 'x',
        account_id: userID,
        profile_name: profile.profile_name || null,
        handle: profile.handle || null,
        followers_count: profile.followersCount || null,
        following_count: profile.followingCount || null,
        posts_count: profile.postsCount || null,
        bio: profile.bio || null,
        fields_to_intervene: fieldsToIntervene
    };

    let result;
    try {
        let response = await fetch(manipConfig_XU.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) { removeOverlay(); return; }
        result = await response.json();
    } catch (e) { removeOverlay(); return; }

    // Captured lazily inside applyFields — first time an element is found in the DOM
    // (React may not have rendered it yet at fetch-response time)
    let originalValues = {};
    // Profile snapshot captured right before the first DOM mutation — the latest
    // point where extractUserProfile still sees real (un-rewritten) values.
    let profileSnapshot = null;

    function applyFields() {
        let appliedAny = false;
        for (let field of fieldsToIntervene) {
            if (!result[field]) continue;
            let el = _xuGetFieldEl(field);
            if (!el) continue;
            // Capture original before first mutation; don't overwrite on retries
            if (originalValues[field] === undefined) {
                originalValues[field] = el.textContent;
            }
            if (el.textContent === result[field]) { appliedAny = true; continue; }
            // Snapshot the full profile right before we mutate for the first time
            if (!profileSnapshot) {
                try { profileSnapshot = extractUserProfile(); } catch (e) {}
            }
            el.textContent = result[field];
            appliedAny = true;
            // Only add toggle once — check after <a> ancestor (count fields) or after el
            if (manipConfig_XU.mode === 'aware') {
                let anchor = el.closest('a');
                let checkAfter = anchor || el;
                let next = checkAfter.nextSibling;
                let hasToggle = next && next.nodeType === 1 && next.getAttribute && next.getAttribute('data-sa-interv-toggle');
                if (!hasToggle) _xuToggleBtn(el, originalValues[field], result[field]);
            }
        }
        if (appliedAny) removeOverlay();

        // Refresh manipApplied each pass — originals may have been captured
        // on a later retry once React rendered the profile elements.
        let appliedFields = {};
        for (let field of fieldsToIntervene) {
            if (result[field]) appliedFields[field] = { original: originalValues[field] || '', rewritten: result[field] };
        }
        manipApplied_XU[userID] = { applied: true, fields: appliedFields, profileSnapshot: profileSnapshot };
    }

    applyFields();
    // Re-apply after React re-renders (X reconciles the DOM 100-500ms after navigation)
    [200, 600, 1500].forEach(function(delay) {
        setTimeout(applyFields, delay);
    });
}

// ─────────────────────────────────────────────────────────

function enableTweetObserver(injectElement) {
    document.querySelectorAll(SEL.postContainer || 'article[role="article"]').forEach(processArticleNode);
    if (reactRoot && observer) {
        observer.observe(reactRoot, obsConfig);
    }
    setTimeout(() => {
        document.querySelectorAll(SEL.postContainer || 'article[role="article"]').forEach(processArticleNode);
    }, 1500);
}

function extractTweetMedia(articleNode) {
    if (!articleNode) return "";
    let mediaUrls = [];

    let details = extractTweetDetails(articleNode);
    if (details && details.tweetID && window.__socialAnnotate__ && window.__socialAnnotate__.twitterApiMediaMap && window.__socialAnnotate__.twitterApiMediaMap[details.tweetID]) {
        return window.__socialAnnotate__.twitterApiMediaMap[details.tweetID];
    }

    // Extract standard high-res image sources
    let photos = articleNode.querySelectorAll(SEL.postImage || '[data-testid="tweetPhoto"] img');
    photos.forEach(img => {
        if (img.src) mediaUrls.push(img.src);
    });

    // Extract videos (attempt to grab raw MP4 source first, fallback to thumbnail if stream is encrypted blob)
    let videos = articleNode.querySelectorAll(SEL.postVideo || '[data-testid="videoPlayer"] video');
    videos.forEach(video => {
        let mp4Source = video.querySelector('source');
        if (mp4Source && mp4Source.src && !mp4Source.src.startsWith('blob:')) {
            mediaUrls.push(mp4Source.src);
        } else if (video.src && !video.src.startsWith('blob:')) {
            mediaUrls.push(video.src);
        } else if (video.poster) {
            mediaUrls.push("[Video Thumbnail] " + video.poster);
        }
    });

    return mediaUrls;
}

function extractTweetTextContent(articleNode) {
    let tweetTextParts = [];

    // Only grab the main tweet text — not quoted-tweet or card nested copies
    let textEl = _xMainTextEl(articleNode);
    if (textEl) {
        // Clone to strip the "Show more" link, then read text including emoji <img alt>
        let clone = textEl.cloneNode(true);
        let showMore = clone.querySelector('[data-testid="tweet-text-show-more-link"]');
        if (showMore) showMore.remove();
        let text = _xInnerText(clone).trim();
        if (text) tweetTextParts.push(text);
    }

    // Grab URLs from link previews instead of the bulky card text
    let cardNodes = articleNode.querySelectorAll(SEL.cardWrapper || '[data-testid="card.wrapper"]');
    cardNodes.forEach(node => {
        let linkNode = node.querySelector('a');
        if (linkNode && linkNode.href) {
            tweetTextParts.push(linkNode.href);
        }
    });

    return tweetTextParts.join('\n\n');
}

function extractTweetMetrics(articleNode) {
    let metrics = {
        like_count: null,
        share_count: null,
        comment_count: null,
        bookmark_count: null,
        view_count: null,
        quote_count: null
    };

    if (!articleNode) return metrics;

    const parseShortNumber = (str) => {
        if (!str) return 0;
        str = str.trim().replace(/,/g, '');
        if (str.match(/K/i)) return parseFloat(str) * 1000;
        if (str.match(/M/i)) return parseFloat(str) * 1000000;
        return parseInt(str, 10) || 0;
    };

    const isLikelyCssSelector = (value) => {
        if (!value || typeof value !== 'string') return false;
        // If it contains common CSS selector characters, treat it as a selector.
        return /[\s.#\[\]>:+~]/.test(value);
    };

    const findMetricElement = (selectorOrTestId) => {
        if (!selectorOrTestId) return null;

        if (isLikelyCssSelector(selectorOrTestId)) {
            return articleNode.querySelector(selectorOrTestId);
        }

        // Backward-compatible path for data-testid tokens (e.g. "reply", "retweet").
        return articleNode.querySelector(`[data-testid="${selectorOrTestId}"]`) ||
            articleNode.querySelector(`[data-testid="un${selectorOrTestId}"]`);
    };

    const extractFromAria = (selectorOrTestId) => {
        let el = findMetricElement(selectorOrTestId);
        if (el) {
            let aria = el.getAttribute('aria-label');
            if (aria) {
                let match = aria.match(/^([\d,\.]+[kmKM]?)\s+/i);
                if (match) return parseShortNumber(match[1]);
            }

            // Some older Twitter UIs encode counts in attributes.
            let attrCount = el.getAttribute('data-tweet-stat-count');
            if (attrCount) {
                return parseShortNumber(attrCount);
            }

            // Sometimes the count is in a nested child rather than the action root.
            let nestedCount = el.querySelector('[data-tweet-stat-count], .ProfileTweet-actionCountForPresentation, .icon-and-text');
            if (nestedCount) {
                let nestedAttr = nestedCount.getAttribute('data-tweet-stat-count');
                if (nestedAttr) return parseShortNumber(nestedAttr);
                return parseShortNumber(nestedCount.innerText);
            }

            return parseShortNumber(el.innerText);
        }
        return null;
    };

    metrics.comment_count = extractFromAria(SEL.metricsReply || 'reply');
    metrics.share_count = extractFromAria(SEL.metricsRepost || 'retweet');
    metrics.like_count = extractFromAria(SEL.metricsLike || 'like');
    metrics.bookmark_count = extractFromAria(SEL.metricsBookmark || 'bookmark');
    if (SEL.metricsQuote) metrics.quote_count = extractFromAria(SEL.metricsQuote);

    // Attempt to grab views from the analytics label
    let viewsWord = SEL.metricsViewsPattern || 'views?';
    let viewsRegex = new RegExp('(?:^|\\s)([\\d,\\.]+[kmKM]?)\\s*' + viewsWord + '(?:$|\\s|\\.)', 'i');

    let viewEls = Array.from(articleNode.querySelectorAll('[aria-label]'));
    let viewEl = viewEls.find(el => {
        let label = el.getAttribute('aria-label') || '';
        if (viewsRegex.test(label)) return true;
        if (label.toLowerCase().includes('view post analytics') && el.innerText.trim().match(/^[\d,\.]+[kmKM]?$/)) return true;
        return false;
    });

    if (viewEl) {
        let aria = viewEl.getAttribute('aria-label') || '';
        let match = aria.match(viewsRegex);
        if (match) {
            metrics.view_count = parseShortNumber(match[1]);
        } else {
            metrics.view_count = parseShortNumber(viewEl.innerText);
        }
    }

    return metrics;
}

function extractTweetDetails(articleNode) {
    let href = null;

    // Tier 1: timestamp anchor — time element's parent is the permalink
    let timeElement = articleNode.querySelector(SEL.postTimestamp || "time");
    if (timeElement && timeElement.parentNode && timeElement.parentNode.href) {
        href = timeElement.parentNode.href;
    }

    // Tier 2: anchor-scan — any a[href*="/status/"] that wraps a <time> child
    // (avoids quoted-tweet false matches which lack a nested time element)
    if (!href) {
        let anchors = articleNode.querySelectorAll('a[href*="/status/"]');
        for (let a of anchors) {
            if (a.querySelector('time')) { href = a.href; break; }
        }
    }

    if (!href) return null;

    // Prefer explicit status URL parsing, including archive-wrapped links.
    let statusMatch = href.match(/(?:https?:\/\/)?(?:x|twitter)\.com\/([^\/?#]+)\/status\/(\d+)/i);
    if (statusMatch) {
        return {
            tweetOwner: statusMatch[1],
            tweetID: statusMatch[2]
        };
    }

    // Fallback: extract from any /status/<digits> fragment.
    let idMatch = href.match(/\/status\/(\d+)/i);
    if (idMatch) {
        let owner = 'unknown';
        let ownerMatch = href.match(/(?:x|twitter)\.com\/([^\/?#]+)\//i);
        if (ownerMatch) owner = ownerMatch[1];
        return {
            tweetOwner: owner,
            tweetID: idMatch[1]
        };
    }

    return null;
}

function injectTwitterTweetSurvey(injectNode, tweetID, tweetOwner) {
    let surveyContainer = document.createElement('div');
    surveyContainer.className = "survey-container-tweet";
    let containerName = "surveyFormContainer-" + tweetID;
    surveyContainer.setAttribute("id", containerName);
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });

    let cssUrl = chrome.runtime.getURL("content-scripts/x/inject.css");

    shadowRoot.innerHTML = `\
   <iframe class="surveyIframe" src="${chrome.runtime.getURL("sandbox/survey.html")}" data-css="${cssUrl}" style="border:none; width:100%; height:100%; background:transparent;"></iframe>\
`;

    injectNode.insertAdjacentElement('afterbegin', surveyContainer);
}

function checkUserURL() {
    // On local file:// and http://127.0.0.1 URLs (saved HTML testing), always allow injection.
    // The global crawlUserName() may be overwritten by another platform's content script in
    // the shared isolated world, so bypass it for local testing URLs.
    if (window.location.protocol === 'file:') return true;
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') return true;
    let uname = crawlUserName();
    return !(uname === '' || uname === 'home');
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'isGuided', 'selectors', 'manipulationMaps'], function (result) {

        // Load selectors into the module-level variable
        const _rawX = (result.selectors && result.selectors.x) ? result.selectors.x : {};
        SEL = { ...(_rawX.shared || {}), ...(_rawX.account || {}), ...(_rawX.post || {}) };
        watchPostCounter('x', function () { return _processedCount_X; });

        // Load manipulation config for x-post
        const _postConf = result.config && result.config.surveys && result.config.surveys['x-post'];
        manipConfig = (_postConf && _postConf.manipulation) || {};
        if (manipConfig.enabled) {
            if (manipConfig.source !== 'api' && result.manipulationMaps && result.manipulationMaps['x-post']) {
                let fullMap = result.manipulationMaps['x-post'];
                manipMapId = (fullMap._meta && fullMap._meta.map_id) || '';
                for (let k in fullMap) { if (k !== '_meta') manipMap[k] = fullMap[k]; }
            } else if (manipConfig.source === 'api' && manipConfig.endpoint && window.__sa_intervApi) {
                window.__sa_intervApi.init({ endpoint: manipConfig.endpoint, survey_type: 'x-post', platform: 'x', mode: manipConfig.mode, logOriginal: manipConfig.logOriginal });
            }
        }

        const _userConf = result.config && result.config.surveys && result.config.surveys['x-user'];
        manipConfig_XU = (_userConf && _userConf.manipulation) || {};

        // Initialize observer infrastructure now that selectors are available
        reactRoot = document.querySelector(SEL.appRoot || '#react-root') || document.body;
        obsConfig = SEL.observerFilter || { attributes: true, childList: true, subtree: true, attributeFilter: ['role'] };
        observer = createObserver();

        // Auto-Start Guided Mode: skip on local files (testing mode)
        let isLocalFile = window.location.protocol === 'file:';
        let isBasePlatform = window.location.pathname === '/' || window.location.pathname.startsWith('/home');
        if (!isLocalFile && result.isEnabled && result.isGuided && result.activeTargetList && result.activeTargetList.length > 0 && isBasePlatform) {
            let firstTarget = result.activeTargetList[0];
            let platformURL = window.location.hostname.includes("x.com") ? "https://x.com/" : "https://twitter.com/";
            let activeSurvey = result.config.activeSurveys && result.config.activeSurveys.length > 0 ? result.config.activeSurveys[0] : null;

            if (activeSurvey === 'x-post') {
                window.location.href = platformURL + 'i/web/status/' + firstTarget;
                return;
            } else if (activeSurvey === 'x-user') {
                window.location.href = platformURL + firstTarget;
                return;
            }
        }

        const currentPlatform = 'x';
        for (let index = 0; index < availableContextsTwitter.length; ++index) {
            let currentContext = availableContextsTwitter[index];
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

                        let isUserSurvey = currentContext.name.endsWith('-user');
                        if (isUserSurvey) {
                            // IMPORTANT: Capture media URLs synchronously BEFORE storeResults,
                            // because storeResults triggers guided-mode navigation which
                            // changes the page and invalidates the DOM elements.
                            let capturedAvatarUrl = null;
                            let capturedBannerUrl = null;
                            let rawAvatarUrl = getProfileAvatarUrl();
                            if (rawAvatarUrl) {
                                capturedAvatarUrl = rawAvatarUrl.replace('_normal', '').replace('_bigger', '').replace('_mini', '').replace('_200x200', '_400x400').replace('_reasonably_small', '_400x400');
                            }
                            let bannerEl = document.querySelector(SEL.userBanner || 'img[src*="profile_banners"]');
                            if (bannerEl && bannerEl.src) {
                                capturedBannerUrl = bannerEl.src;
                            }
                            let capturedUserID = values.account_id;
                            let capturedSurveyType = currentContext.name;

                            // Send download messages BEFORE storeResults to avoid the navigation race.
                            chrome.storage.local.get(['isProfileDownloadEnabled', 'isBannerDownloadEnabled'], function (res) {
                                if (res.isProfileDownloadEnabled && capturedAvatarUrl) {
                                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [capturedAvatarUrl], userId: capturedUserID || 'user', postId: 'profile', surveyType: capturedSurveyType });
                                }
                                if (res.isBannerDownloadEnabled && capturedBannerUrl) {
                                    chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [capturedBannerUrl], userId: capturedUserID || 'user', postId: 'banner', surveyType: capturedSurveyType });
                                }
                            });
                        } else {
                            chrome.storage.local.get(['isMediaDownloadEnabled'], function (res) {
                                if (res.isMediaDownloadEnabled) {
                                    let evt = new CustomEvent('mh:download-request', { detail: { postID: values.post_id, userID: values.account_id, surveyType: currentContext.name } });
                                    window.dispatchEvent(evt);
                                }
                            });
                        }

                        // Attach intervention metadata
                        let _ma = manipApplied[values.post_id];
                        let _maU = manipApplied_XU[values.account_id];
                        if (_ma) {
                            values.intervention_applied = true;
                            values.intervention_label   = _ma.label;
                            values.intervention_map_id  = _ma.map_id;
                            if (_ma.original_text !== undefined) values.original_text = _ma.original_text;
                            if (_ma.extras) values.intervention_extras = _ma.extras;
                        } else if (_maU) {
                            values.intervention_applied = true;
                            values.intervention_label   = 'user-intervention';
                            values.intervention_map_id  = '';
                            values.intervention_fields  = _maU.fields;
                            if (_maU.profileSnapshot) values.user_profile = _maU.profileSnapshot;
                        } else {
                            values.intervention_applied = false;
                        }

                        // Call storeResults AFTER capturing media URLs.
                        // This is safe because storeResults is also async internally.
                        storeResults(values, currentPlatform);
                    }
                }

                currentContext.formTemplate = config.surveyFormSchema;
                currentContext.theme = config.theme || "light";
                currentContext.submitAction = submitAction;
                currentContext.injectSurvey(config.injectElement);

                if (currentContext.name !== 'x-post') {
                    _processedCount_X++;
                    let surveyID = crawlUserName();
                    currentContext.renderSurvey(surveyID, null, {
                        user_profile: () => extractUserProfile()
                    });
                    if (currentContext.name === 'x-user' && manipConfig_XU.enabled) {
                        let profile = extractUserProfile();
                        _applyXUserIntervention(surveyID, profile);
                    }
                }
            }
        }
    });
}

window.__socialAnnotate__.platformDebugCapture = function(selectors, stored) {
    let raw = selectors.x || {};
    let SEL_D = Object.assign({}, raw.shared || {}, raw.account || {}, raw.post || {});
    let activeSurvey = stored && stored.config && stored.config.activeSurveys && stored.config.activeSurveys[0];

    function probe(field) {
        let selector = SEL_D[field];
        if (!selector) return { field, selector: null, matched: false, value: null, note: 'not in selectors.json' };
        try {
            let el = document.querySelector(selector);
            return { field, selector, matched: !!el, value: el ? (el.src || el.currentSrc || el.textContent.trim().slice(0, 200) || null) : null };
        } catch(e) {
            return { field, selector, matched: false, value: null, note: 'invalid selector' };
        }
    }

    let isUser = activeSurvey ? activeSurvey.endsWith('-user') : checkUserURL();
    let section = isUser ? (raw.account || {}) : (raw.post || {});
    return {
        platform: 'x',
        surveyType: activeSurvey || (isUser ? 'x-user' : 'x-post'),
        injectionStatus: {
            userSurveyInjected: !!document.getElementById('surveyFormContainer'),
            postSurveysInjected: document.querySelectorAll('.survey-container-post').length
        },
        extractedData: { userID: crawlUserName(), profile: isUser ? extractUserProfile() : {} },
        selectorDiagnostics: Object.keys(section).filter(f => !['postVideo','postImage','userBanner'].includes(f)).map(probe)
    };
};

// Fire the survey initializer on script load
initializeSurveys();
