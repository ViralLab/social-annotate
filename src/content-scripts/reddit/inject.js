const availableContextsReddit = [
    new Context('reddit-post',    enableRedditPostObserver,    checkRedditPostURL),
    new Context('reddit-comment', enableRedditCommentObserver, checkRedditCommentURL),
    new Context('reddit-user',    injectRedditUserSurvey,      checkRedditUserURL)
];

let SEL_RD = {};
let _processedCount_RD = 0;
registerHealthCounter(function() { return _processedCount_RD; });

let _rdPostCtxActive    = false;
let _rdCommentCtxActive = false;
let _rdUserCtxActive    = false;

let _rdObserver = null;

let _injectedPosts    = new Set();
let _injectedComments = new Set();
let _userInjected     = '';

let manipConfig_RD         = {};
let manipMap_RD            = {};
let manipMapId_RD          = '';
let manipApplied_RD        = {};
let manipConfig_RD_comment = {};
let manipApplied_RD_comment = {};

const _inFlight_RD_post    = new Set();
const _inFlight_RD_comment = new Set();

// ── URL helpers ───────────────────────────────────────────────────────────────

function checkRedditUserURL() {
    if (window.location.protocol === 'file:') return false;
    return /^\/user\/[^/]+/.test(window.location.pathname);
}

function checkRedditCommentURL() {
    if (window.location.protocol === 'file:') return true;
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') return true;
    return /\/r\/[^/]+\/comments\//.test(window.location.pathname) || checkRedditUserURL();
}

function checkRedditPostURL() {
    if (window.location.protocol === 'file:') return true;
    return true;
}

function crawlUserName() {
    if (window.location.protocol === 'file:') return 'local-test-user';
    let m = window.location.pathname.match(/^\/user\/([^/?#]+)/);
    return m ? m[1] : '';
}

// ── Post ──────────────────────────────────────────────────────────────────────

function extractRedditPostId(postEl) {
    let attr   = SEL_RD.postIdAttr   || 'id';
    let prefix = SEL_RD.postIdPrefix || '';
    return (postEl.getAttribute(attr) || '').replace(new RegExp('^' + prefix), '');
}

function extractRedditPostText(postEl) {
    let title = SEL_RD.postTitleAttr ? (postEl.getAttribute(SEL_RD.postTitleAttr) || '') : '';
    let bodyEl = null;
    let selectors = (SEL_RD.postText || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    for (let i = 0; i < selectors.length; i++) {
        bodyEl = postEl.querySelector(selectors[i]);
        if (bodyEl) break;
    }
    let body = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '').trim() : '';
    return body ? (title + '\n\n' + body).trim() : title;
}

async function _fetchBestDashMp4(videoId, authToken) {
    try {
        let url = 'https://v.redd.it/' + videoId + '/DASHPlaylist.mpd' + (authToken ? '?a=' + authToken : '');
        let resp = await fetch(url);
        if (!resp.ok) return null;
        let xml = await resp.text();
        let doc = new DOMParser().parseFromString(xml, 'application/xml');
        let bestFilename = null, bestBandwidth = 0;
        doc.querySelectorAll('AdaptationSet').forEach(function(set) {
            let mime = set.getAttribute('mimeType') || set.getAttribute('contentType') || '';
            if (!mime.includes('video')) return;
            set.querySelectorAll('Representation').forEach(function(rep) {
                let bw = parseInt(rep.getAttribute('bandwidth') || '0', 10);
                let baseUrl = rep.querySelector('BaseURL');
                if (baseUrl && bw > bestBandwidth) {
                    bestBandwidth = bw;
                    bestFilename = baseUrl.textContent.trim();
                }
            });
        });
        if (bestFilename) {
            return 'https://v.redd.it/' + videoId + '/' + bestFilename + (authToken ? '?a=' + authToken : '');
        }
    } catch(e) {}
    return null;
}

async function extractRedditPostMedia(postEl) {
    if (!postEl) return [];

    let player = postEl.querySelector(SEL_RD.postVideoPlayer || 'shreddit-player');
    if (player) {
        let hlsSrc = player.getAttribute('src') || '';
        let idMatch   = hlsSrc.match(/v\.redd\.it\/([^/?#]+)\//);
        let authMatch = hlsSrc.match(/[?&]a=([^&]+)/);
        if (idMatch) {
            let mp4 = await _fetchBestDashMp4(idMatch[1], authMatch ? authMatch[1] : '');
            if (mp4) return [mp4];
        }
    }

    let urls = [];
    function addImg(el) {
        let src = el.src || el.getAttribute('src') || '';
        if (!src || src.startsWith('data:')) return;
        if (src.includes('/avatars/') || src.includes('redditmedia.com') || src.includes('emoji') || src.includes('icon')) return;
        urls.push(src);
    }
    postEl.querySelectorAll(SEL_RD.postImage || '[slot="thumbnail"] img, [slot="media"] img').forEach(addImg);
    postEl.querySelectorAll('img[src*="preview.redd.it"], img[src*="i.redd.it"]').forEach(addImg);
    return [...new Set(urls)];
}

function extractRedditCommentMedia(commentEl) {
    let urls = [];
    let textEl = commentEl.querySelector(SEL_RD.commentContentSel || '[id*="-post-rtjson-content"]');
    if (!textEl) return urls;
    textEl.querySelectorAll('img').forEach(function(img) {
        let src = img.src || img.getAttribute('src') || '';
        if (!src || src.startsWith('data:')) return;
        if (src.includes('emoji') || src.includes('/emotes/')) return;
        urls.push(src);
    });
    return [...new Set(urls)];
}

window.addEventListener('mh:download-request', async function(e) {
    let detail = e.detail;
    if (!detail) return;
    let postId = detail.postID;
    let surveyType = detail.surveyType;
    if (surveyType === 'reddit-user') return;
    let container = document.getElementById('surveyFormContainer-' + postId);
    let urls = [];
    if (surveyType === 'reddit-post') {
        let contentEl = container ? container.nextElementSibling : null;
        if (contentEl) urls = await extractRedditPostMedia(contentEl);
    } else if (surveyType === 'reddit-comment') {
        let commentSels = (SEL_RD.commentContainer || 'shreddit-comment') + ', ' + (SEL_RD.profileCommentContainer || 'shreddit-profile-comment');
        let commentEl = container && container.closest(commentSels);
        if (commentEl) urls = extractRedditCommentMedia(commentEl);
    }
    if (urls.length > 0) {
        chrome.runtime.sendMessage({ action: 'downloadMedia', urls: urls, userId: detail.userID || 'user', postId: postId, surveyType: surveyType });
    }
});

function extractRedditPostMetrics(postEl) {
    let score    = parseInt(postEl.getAttribute(SEL_RD.postScoreAttr        || 'score')         || '', 10);
    let comments = parseInt(postEl.getAttribute(SEL_RD.postCommentCountAttr || 'comment-count') || '', 10);
    return {
        like_count:     isNaN(score)    ? null : score,
        comment_count:  isNaN(comments) ? null : comments,
        share_count:    null,
        view_count:     null,
        bookmark_count: null,
        quote_count:    null
    };
}

// ── Shared intervention helpers ───────────────────────────────────────────────

function _rdFindTextEl(containerEl, selectorStr) {
    let sels = (selectorStr || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    for (let i = 0; i < sels.length; i++) {
        let el = containerEl.querySelector(sels[i]);
        if (el) return el;
    }
    return null;
}

function _rdToggleBtn(textEl, originalNodes, rewrittenText, mode) {
    if (mode !== 'aware') return;
    let isOriginal = false;
    let toggleBtn = document.createElement('button');
    toggleBtn.textContent = '👁 Show original';
    toggleBtn.setAttribute('data-sa-interv-toggle', '1');
    toggleBtn.style.cssText = 'display:block;margin-left:auto;margin-bottom:4px;padding:2px 10px;font-size:11px;line-height:1.6;cursor:pointer;border-radius:4px;background:rgba(255,69,0,0.08);color:rgb(255,69,0);border:1px solid rgba(255,69,0,0.25);font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
    toggleBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        isOriginal = !isOriginal;
        if (isOriginal) {
            textEl.textContent = '';
            originalNodes.forEach(function(n) { textEl.appendChild(n.cloneNode(true)); });
        } else {
            textEl.textContent = rewrittenText;
        }
        toggleBtn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
    });
    textEl.parentNode.insertBefore(toggleBtn, textEl);
}

function _rdApplyResultPost(result, postEl, mode) {
    let textEl = _rdFindTextEl(postEl, SEL_RD.postText || '[slot="text-body"] .md, [slot="text-body"], shreddit-post-text-body');
    if (textEl && result.rewritten_text) {
        let originalNodes = Array.from(textEl.childNodes).map(function(n) { return n.cloneNode(true); });
        textEl.textContent = result.rewritten_text;
        _rdToggleBtn(textEl, originalNodes, result.rewritten_text, mode);
    }
}

function _rdApplyResultComment(result, commentEl, mode, textSel) {
    let sel = textSel || SEL_RD.commentText || '[id*="-post-rtjson-content"], [slot="comment"] div[dir="auto"], [slot="comment"]';
    let textEl = _rdFindTextEl(commentEl, sel);
    if (textEl && result.rewritten_text) {
        let originalNodes = Array.from(textEl.childNodes).map(function(n) { return n.cloneNode(true); });
        textEl.textContent = result.rewritten_text;
        _rdToggleBtn(textEl, originalNodes, result.rewritten_text, mode);
    }
}

function _rdInjectPost(postEl, postId, postCtx, author) {
    let cssUrl = chrome.runtime.getURL('content-scripts/reddit/inject.css');
    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-post';
    surveyContainer.id = 'surveyFormContainer-' + postId;
    surveyContainer.style.cssText = 'width:100%;min-height:120px;display:flex;flex-wrap:wrap-reverse;overflow:visible;background:transparent;position:relative;z-index:100;box-sizing:border-box;';
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '<iframe class="surveyIframe" src="' + chrome.runtime.getURL('sandbox/survey.html') + '" data-css="' + cssUrl + '" style="border:none;width:100%;height:100%;background:transparent;"></iframe>';
    postEl.insertAdjacentElement('beforebegin', surveyContainer);
    postCtx.renderSurvey(author, postId, {
        body:         function() { return extractRedditPostText(postEl); },
        media_urls:   function() { return extractRedditPostMedia(postEl); },
        post_metrics: function() { return extractRedditPostMetrics(postEl); },
        created_at:   function() { return postEl.getAttribute(SEL_RD.postTimestampAttr || 'created-timestamp') || null; },
        subreddit:    function() {
            let p = SEL_RD.subredditURLPattern;
            if (!p) return null;
            let permalink = SEL_RD.postPermalinkAttr && postEl.getAttribute(SEL_RD.postPermalinkAttr);
            let src = permalink || window.location.pathname;
            let m = src.match(new RegExp(p));
            return m ? m[1] : null;
        }
    });
}

function _rdInjectComment(commentEl, commentId, commentCtx, author) {
    let cssUrl = chrome.runtime.getURL('content-scripts/reddit/inject.css');
    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-post';
    surveyContainer.id = 'surveyFormContainer-' + commentId;
    surveyContainer.style.cssText = 'width:100%;min-height:120px;display:flex;flex-wrap:wrap-reverse;overflow:visible;background:transparent;position:relative;z-index:100;box-sizing:border-box;';
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '<iframe class="surveyIframe" src="' + chrome.runtime.getURL('sandbox/survey.html') + '" data-css="' + cssUrl + '" style="border:none;width:100%;height:100%;background:transparent;"></iframe>';
    let slotEl = commentEl.querySelector(SEL_RD.commentContentSlot || '[slot="comment"]');
    if (slotEl) {
        slotEl.insertAdjacentElement('afterbegin', surveyContainer);
    } else {
        commentEl.insertAdjacentElement('afterbegin', surveyContainer);
    }
    commentCtx.renderSurvey(author, commentId, {
        body:           function() { return extractRedditCommentText(commentEl); },
        media_urls:     function() { return extractRedditCommentMedia(commentEl); },
        post_metrics:   function() {
            let score = parseInt(commentEl.getAttribute(SEL_RD.commentScoreAttr || 'score') || '', 10);
            return { like_count: isNaN(score) ? null : score, comment_count: null, share_count: null, view_count: null, bookmark_count: null, quote_count: null };
        },
        created_at:     function() { return commentEl.getAttribute(SEL_RD.commentTimestampAttr || 'created') || null; },
        subreddit:      function() { let p = SEL_RD.subredditURLPattern; let m = p && window.location.pathname.match(new RegExp(p)); return m ? m[1] : null; },
        comment_depth:  function() { let a = SEL_RD.commentDepthAttr; let d = a ? parseInt(commentEl.getAttribute(a) || '', 10) : NaN; return isNaN(d) ? null : d; },
        parent_post_id: function() { let p = SEL_RD.parentPostIdURLPattern; let m = p && window.location.pathname.match(new RegExp(p)); return m ? m[1] : null; }
    });
}

function _rdInjectProfileComment(commentEl, commentId, href, commentCtx, author) {
    let cssUrl = chrome.runtime.getURL('content-scripts/reddit/inject.css');
    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-post';
    surveyContainer.id = 'surveyFormContainer-' + commentId;
    surveyContainer.style.cssText = 'width:100%;min-height:120px;display:flex;flex-wrap:wrap-reverse;overflow:visible;background:transparent;position:relative;z-index:100;box-sizing:border-box;';
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '<iframe class="surveyIframe" src="' + chrome.runtime.getURL('sandbox/survey.html') + '" data-css="' + cssUrl + '" style="border:none;width:100%;height:100%;background:transparent;"></iframe>';
    let contentSel = SEL_RD.commentContentSel || '[id*="-post-rtjson-content"]';
    let textEl = commentEl.querySelector(contentSel);
    let insertTarget = textEl || commentEl;
    insertTarget.insertAdjacentElement('beforebegin', surveyContainer);
    commentCtx.renderSurvey(author, commentId, {
        body: function() {
            let el = commentEl.querySelector(SEL_RD.commentContentSel || '[id*="-post-rtjson-content"]');
            return el ? (el.textContent || '').trim() : '';
        },
        media_urls:   function() { return extractRedditCommentMedia(commentEl); },
        post_metrics: function() {
            let scoreSel = SEL_RD.profileCommentScoreSel || 'shreddit-comment-action-row[score]';
            let actionRow = commentEl.querySelector(scoreSel);
            let score = actionRow ? parseInt(actionRow.getAttribute('score') || '', 10) : NaN;
            return { like_count: isNaN(score) ? null : score, comment_count: null, share_count: null, view_count: null, bookmark_count: null, quote_count: null };
        },
        created_at: function() {
            let tsSel = SEL_RD.profileCommentTimestampSel || 'faceplate-timeago[ts]';
            let el = commentEl.querySelector(tsSel);
            return el ? el.getAttribute('ts') : null;
        },
        subreddit:      function() { let p = SEL_RD.subredditURLPattern; let m = p && href.match(new RegExp(p)); return m ? m[1] : null; },
        comment_depth:  function() { return null; },
        parent_post_id: function() { let p = SEL_RD.parentPostIdURLPattern; let m = p && href.match(new RegExp(p)); return m ? m[1] : null; }
    });
}

async function processRedditPostNode(postEl) {
    if (postEl.getElementsByClassName('survey-container-post').length > 0) return;
    let postCtx = availableContextsReddit.find(function(c) { return c.name === 'reddit-post'; });
    if (!postCtx || !postCtx.formTemplate) return;

    let postId = extractRedditPostId(postEl);
    if (!postId || _injectedPosts.has(postId) || _inFlight_RD_post.has(postId)) return;

    let author = postEl.getAttribute(SEL_RD.postAuthorAttr || 'author') || '';

    // ── API path ──────────────────────────────────────────────────────────────
    if (manipConfig_RD.enabled && manipConfig_RD.source === 'api' && manipConfig_RD.endpoint && window.__sa_intervApi) {
        _inFlight_RD_post.add(postId);

        let cached = window.__sa_intervApi.getCached(postId);
        if (cached) {
            _rdApplyResultPost(cached, postEl, manipConfig_RD.mode);
            _inFlight_RD_post.delete(postId);
            _injectedPosts.add(postId);
            _processedCount_RD++;
            _rdInjectPost(postEl, postId, postCtx, author);
            return;
        }

        let overlay = window.__sa_intervApi.createOverlay(postEl, manipConfig_RD.mode);
        let doRetry = function() { _inFlight_RD_post.delete(postId); overlay.remove(); processRedditPostNode(postEl); };
        try {
            let body = extractRedditPostText(postEl);
            let postData = {
                post_id:      postId,
                account_id:   author,
                body,
                survey_type:  'reddit-post',
                created_at:   postEl.getAttribute(SEL_RD.postTimestampAttr || 'created-timestamp') || null,
                media_urls:   [],
                post_metrics: extractRedditPostMetrics(postEl)
            };
            let result = await window.__sa_intervApi.queuePost(postData);

            let meta = { applied: true, label: result.prompt_label || '', map_id: result.map_id || window.__sa_intervApi.getMapId() };
            if (manipConfig_RD.logOriginal) meta.original_text = body;
            let extras = {};
            for (let k in result) {
                if (!['post_id', 'rewritten_text', 'map_id', 'prompt_label'].includes(k)) extras[k] = result[k];
            }
            if (Object.keys(extras).length > 0) meta.extras = extras;
            manipApplied_RD[postId] = meta;

            overlay.parentNode && overlay.parentNode.removeChild(overlay);
            _inFlight_RD_post.delete(postId);
            _injectedPosts.add(postId);
            _processedCount_RD++;

            _rdApplyResultPost(result, postEl, manipConfig_RD.mode);
            _rdInjectPost(postEl, postId, postCtx, author);
        } catch(err) {
            overlay.showError(doRetry);
        }
        return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    _injectedPosts.add(postId);
    _processedCount_RD++;

    // ── Map path ──────────────────────────────────────────────────────────────
    if (manipConfig_RD.enabled && manipMap_RD[postId]) {
        let entry = manipMap_RD[postId];
        let textSelectors = (SEL_RD.postText || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        let textEl = null;
        for (let i = 0; i < textSelectors.length; i++) {
            textEl = postEl.querySelector(textSelectors[i]);
            if (textEl) break;
        }
        if (textEl) {
            let rewrittenText = entry.rewritten_text;
            let originalText  = entry.original_text || '';
            textEl.textContent = rewrittenText;
            if (manipConfig_RD.mode === 'aware') {
                let isOriginal = false;
                let toggleBtn = document.createElement('button');
                toggleBtn.textContent = '👁 Show original';
                toggleBtn.setAttribute('data-sa-interv-toggle', '1');
                toggleBtn.style.cssText = 'display:block;margin-left:auto;margin-bottom:4px;padding:2px 10px;font-size:11px;cursor:pointer;border-radius:4px;background:rgba(255,69,0,0.08);color:rgb(255,69,0);border:1px solid rgba(255,69,0,0.25);';
                toggleBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    isOriginal = !isOriginal;
                    textEl.textContent = isOriginal ? originalText : rewrittenText;
                    toggleBtn.textContent = isOriginal ? '✏ Show rewritten' : '👁 Show original';
                });
                textEl.parentNode.insertBefore(toggleBtn, textEl);
            }
            let meta = { applied: true, label: entry.prompt_label || '', map_id: manipMapId_RD };
            if (manipConfig_RD.logOriginal) meta.original_text = originalText;
            manipApplied_RD[postId] = meta;
        }
    }
    // ─────────────────────────────────────────────────────────────────────────

    _rdInjectPost(postEl, postId, postCtx, author);
}

function enableRedditPostObserver() {
    let sel = SEL_RD.postContainer || 'shreddit-post';
    document.querySelectorAll(sel).forEach(processRedditPostNode);
    [1500, 3500, 6000].forEach(function(d) {
        setTimeout(function() { document.querySelectorAll(sel).forEach(processRedditPostNode); }, d);
    });
}

// ── Comment ───────────────────────────────────────────────────────────────────

function extractRedditCommentId(commentEl) {
    let attr   = SEL_RD.commentIdAttr   || 'thingid';
    let prefix = SEL_RD.commentIdPrefix || '';
    return (commentEl.getAttribute(attr) || '').replace(new RegExp('^' + prefix), '');
}

function extractRedditCommentText(commentEl) {
    let selectors = (SEL_RD.commentText || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    for (let i = 0; i < selectors.length; i++) {
        let el = commentEl.querySelector(selectors[i]);
        if (el) return (el.textContent || '').trim();
    }
    return '';
}

async function processRedditCommentNode(commentEl) {
    let collapsedAttr = SEL_RD.commentCollapsedAttr || 'collapsed';
    if (commentEl.hasAttribute(collapsedAttr)) return;
    let commentId = extractRedditCommentId(commentEl);
    if (!commentId || _injectedComments.has(commentId) || _inFlight_RD_comment.has(commentId)) return;

    let commentCtx = availableContextsReddit.find(function(c) { return c.name === 'reddit-comment'; });
    if (!commentCtx || !commentCtx.formTemplate) return;

    let author = commentEl.getAttribute(SEL_RD.commentAuthorAttr || 'author') || '';

    // ── API path ──────────────────────────────────────────────────────────────
    if (manipConfig_RD_comment.enabled && manipConfig_RD_comment.source === 'api' && manipConfig_RD_comment.endpoint && window.__sa_intervApi) {
        _inFlight_RD_comment.add(commentId);

        let cached = window.__sa_intervApi.getCached(commentId);
        if (cached) {
            _rdApplyResultComment(cached, commentEl, manipConfig_RD_comment.mode);
            _inFlight_RD_comment.delete(commentId);
            _injectedComments.add(commentId);
            _processedCount_RD++;
            _rdInjectComment(commentEl, commentId, commentCtx, author);
            return;
        }

        let overlay = window.__sa_intervApi.createOverlay(commentEl, manipConfig_RD_comment.mode);
        let doRetry = function() { _inFlight_RD_comment.delete(commentId); overlay.remove(); processRedditCommentNode(commentEl); };
        try {
            let body = extractRedditCommentText(commentEl);
            let commentData = {
                post_id:       commentId,
                account_id:    author,
                body,
                survey_type:   'reddit-comment',
                created_at:    commentEl.getAttribute(SEL_RD.commentTimestampAttr || 'created') || null,
                media_urls:    extractRedditCommentMedia(commentEl),
                post_metrics:  {
                    like_count: parseInt(commentEl.getAttribute(SEL_RD.commentScoreAttr || 'score') || '', 10) || null,
                    comment_count: null, share_count: null, view_count: null, bookmark_count: null, quote_count: null
                },
                comment_depth:  (function() { let a = SEL_RD.commentDepthAttr; let d = a ? parseInt(commentEl.getAttribute(a) || '', 10) : NaN; return isNaN(d) ? null : d; })(),
                parent_post_id: (function() { let p = SEL_RD.parentPostIdURLPattern; let m = p && window.location.pathname.match(new RegExp(p)); return m ? m[1] : null; })(),
                subreddit:      (function() { let p = SEL_RD.subredditURLPattern; let m = p && window.location.pathname.match(new RegExp(p)); return m ? m[1] : null; })()
            };
            let result = await window.__sa_intervApi.queuePost(commentData);

            let meta = { applied: true, label: result.prompt_label || '', map_id: result.map_id || window.__sa_intervApi.getMapId() };
            if (manipConfig_RD_comment.logOriginal) meta.original_text = body;
            let extras = {};
            for (let k in result) {
                if (!['post_id', 'rewritten_text', 'map_id', 'prompt_label'].includes(k)) extras[k] = result[k];
            }
            if (Object.keys(extras).length > 0) meta.extras = extras;
            manipApplied_RD_comment[commentId] = meta;

            overlay.parentNode && overlay.parentNode.removeChild(overlay);
            _inFlight_RD_comment.delete(commentId);
            _injectedComments.add(commentId);
            _processedCount_RD++;

            _rdApplyResultComment(result, commentEl, manipConfig_RD_comment.mode);
            _rdInjectComment(commentEl, commentId, commentCtx, author);
        } catch(err) {
            overlay.showError(doRetry);
        }
        return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    _injectedComments.add(commentId);
    _processedCount_RD++;
    _rdInjectComment(commentEl, commentId, commentCtx, author);
}

async function processRedditProfileCommentNode(commentEl) {
    let idAttr = SEL_RD.profileCommentIdAttr || 'comment-id';
    let prefix = SEL_RD.commentIdPrefix || '';
    let commentId = (commentEl.getAttribute(idAttr) || '').replace(new RegExp('^' + prefix), '');
    if (!commentId || _injectedComments.has(commentId) || _inFlight_RD_comment.has(commentId)) return;

    let commentCtx = availableContextsReddit.find(function(c) { return c.name === 'reddit-comment'; });
    if (!commentCtx || !commentCtx.formTemplate) return;

    let authorSel = SEL_RD.profileCommentAuthorSel || 'shreddit-overflow-menu[author-name]';
    let authorEl = commentEl.querySelector(authorSel);
    let authorNameAttr = SEL_RD.profileCommentAuthorNameAttr || 'author-name';
    let author = (authorEl && authorEl.getAttribute(authorNameAttr)) || '';
    if (!author) {
        let link = commentEl.querySelector('a[href^="/user/"]');
        if (link) { let m = link.getAttribute('href').match(/^\/user\/([^/?#]+)/); author = m ? m[1] : ''; }
    }

    let hrefAttr = SEL_RD.profileCommentHrefAttr || 'href';
    let href = commentEl.getAttribute(hrefAttr) || '';

    // ── API path ──────────────────────────────────────────────────────────────
    if (manipConfig_RD_comment.enabled && manipConfig_RD_comment.source === 'api' && manipConfig_RD_comment.endpoint && window.__sa_intervApi) {
        _inFlight_RD_comment.add(commentId);

        let cached = window.__sa_intervApi.getCached(commentId);
        if (cached) {
            let contentSel = SEL_RD.commentContentSel || '[id*="-post-rtjson-content"]';
            _rdApplyResultComment(cached, commentEl, manipConfig_RD_comment.mode, contentSel);
            _inFlight_RD_comment.delete(commentId);
            _injectedComments.add(commentId);
            _processedCount_RD++;
            _rdInjectProfileComment(commentEl, commentId, href, commentCtx, author);
            return;
        }

        let overlay = window.__sa_intervApi.createOverlay(commentEl, manipConfig_RD_comment.mode);
        let doRetry = function() { _inFlight_RD_comment.delete(commentId); overlay.remove(); processRedditProfileCommentNode(commentEl); };
        try {
            let contentSel = SEL_RD.commentContentSel || '[id*="-post-rtjson-content"]';
            let bodyEl = commentEl.querySelector(contentSel);
            let body = bodyEl ? (bodyEl.textContent || '').trim() : '';

            let tsSel = SEL_RD.profileCommentTimestampSel || 'faceplate-timeago[ts]';
            let tsEl = commentEl.querySelector(tsSel);

            let scoreSel = SEL_RD.profileCommentScoreSel || 'shreddit-comment-action-row[score]';
            let actionRow = commentEl.querySelector(scoreSel);
            let score = actionRow ? parseInt(actionRow.getAttribute('score') || '', 10) : NaN;

            let commentData = {
                post_id:       commentId,
                account_id:    author,
                body,
                survey_type:   'reddit-comment',
                created_at:    tsEl ? tsEl.getAttribute('ts') : null,
                media_urls:    extractRedditCommentMedia(commentEl),
                post_metrics:  { like_count: isNaN(score) ? null : score, comment_count: null, share_count: null, view_count: null, bookmark_count: null, quote_count: null },
                comment_depth:  null,
                parent_post_id: (function() { let p = SEL_RD.parentPostIdURLPattern; let m = p && href.match(new RegExp(p)); return m ? m[1] : null; })(),
                subreddit:      (function() { let p = SEL_RD.subredditURLPattern; let m = p && href.match(new RegExp(p)); return m ? m[1] : null; })()
            };
            let result = await window.__sa_intervApi.queuePost(commentData);

            let meta = { applied: true, label: result.prompt_label || '', map_id: result.map_id || window.__sa_intervApi.getMapId() };
            if (manipConfig_RD_comment.logOriginal) meta.original_text = body;
            let extras = {};
            for (let k in result) {
                if (!['post_id', 'rewritten_text', 'map_id', 'prompt_label'].includes(k)) extras[k] = result[k];
            }
            if (Object.keys(extras).length > 0) meta.extras = extras;
            manipApplied_RD_comment[commentId] = meta;

            overlay.parentNode && overlay.parentNode.removeChild(overlay);
            _inFlight_RD_comment.delete(commentId);
            _injectedComments.add(commentId);
            _processedCount_RD++;

            _rdApplyResultComment(result, commentEl, manipConfig_RD_comment.mode, contentSel);
            _rdInjectProfileComment(commentEl, commentId, href, commentCtx, author);
        } catch(err) {
            overlay.showError(doRetry);
        }
        return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    _injectedComments.add(commentId);
    _processedCount_RD++;
    _rdInjectProfileComment(commentEl, commentId, href, commentCtx, author);
}

function enableRedditCommentObserver() {
    let sel        = SEL_RD.commentContainer        || 'shreddit-comment';
    let profileSel = SEL_RD.profileCommentContainer || 'shreddit-profile-comment';
    [1500, 3500, 6000].forEach(function(d) {
        setTimeout(function() {
            document.querySelectorAll(sel).forEach(processRedditCommentNode);
            document.querySelectorAll(profileSel).forEach(processRedditProfileCommentNode);
        }, d);
    });
}

// ── Shared MutationObserver (posts + comments) ────────────────────────────────

function startRedditObserver() {
    if (_rdObserver) return;
    let postTag        = (SEL_RD.postContainer           || 'shreddit-post').toUpperCase();
    let commentTag     = (SEL_RD.commentContainer        || 'shreddit-comment').toUpperCase();
    let profileComTag  = (SEL_RD.profileCommentContainer || 'shreddit-profile-comment').toUpperCase();
    let postSel        = SEL_RD.postContainer           || 'shreddit-post';
    let commentSel     = SEL_RD.commentContainer        || 'shreddit-comment';
    let profileComSel  = SEL_RD.profileCommentContainer || 'shreddit-profile-comment';
    let collapsedAttr  = SEL_RD.commentCollapsedAttr    || 'collapsed';

    _rdObserver = new MutationObserver(function(mutations) {
        for (let mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === collapsedAttr) {
                let node = mutation.target;
                if (node.tagName !== commentTag) continue;
                if (!node.hasAttribute(collapsedAttr) && _rdCommentCtxActive) {
                    processRedditCommentNode(node);
                }
            } else {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType !== 1) return;
                    if (node.tagName === postTag && _rdPostCtxActive) {
                        processRedditPostNode(node);
                    } else if (node.tagName === commentTag && _rdCommentCtxActive) {
                        processRedditCommentNode(node);
                    } else if (node.tagName === profileComTag && _rdCommentCtxActive) {
                        processRedditProfileCommentNode(node);
                    } else {
                        if (_rdPostCtxActive)    node.querySelectorAll(postSel).forEach(processRedditPostNode);
                        if (_rdCommentCtxActive) {
                            node.querySelectorAll(commentSel).forEach(processRedditCommentNode);
                            node.querySelectorAll(profileComSel).forEach(processRedditProfileCommentNode);
                        }
                    }
                });
            }
        }
    });
    _rdObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: [collapsedAttr] });
}

// ── User profile ──────────────────────────────────────────────────────────────

function extractRedditProfile() {
    let profile = {};
    try {
        let m = window.location.pathname.match(/^\/user\/([^/?#]+)/);
        if (m) profile.handle = m[1];
    } catch(e) {}
    try {
        let el = SEL_RD.userDisplayName && document.querySelector(SEL_RD.userDisplayName);
        if (el) profile.profile_name = (el.innerText || el.textContent || '').trim();
    } catch(e) {}
    try {
        let el = SEL_RD.userAvatar && document.querySelector(SEL_RD.userAvatar);
        if (el) profile.profile_img_url = el.src || el.getAttribute('src') || null;
    } catch(e) {}
    try {
        let el = SEL_RD.userBio && document.querySelector(SEL_RD.userBio);
        if (el) profile.bio = (el.innerText || el.textContent || '').trim();
    } catch(e) {}
    try {
        let el = SEL_RD.userKarma && document.querySelector(SEL_RD.userKarma);
        if (el) profile.karma = (el.innerText || el.textContent || '').trim();
    } catch(e) {}
    try {
        let el = SEL_RD.userCakeDay && document.querySelector(SEL_RD.userCakeDay);
        if (el) profile.reddit_age = el.getAttribute(SEL_RD.userCakeDayDateAttr || 'datetime') || (el.innerText || '').trim();
    } catch(e) {}
    try {
        let el = SEL_RD.userContributions && document.querySelector(SEL_RD.userContributions);
        if (el) profile.contributions = el.getAttribute(SEL_RD.userContributionsNumberAttr || 'number') || (el.innerText || '').trim();
    } catch(e) {}
    return profile;
}

function injectRedditUserSurvey() {
    let username = crawlUserName();
    if (!username || _userInjected === username) return;
    _userInjected = username;
    _processedCount_RD++;

    let old = document.getElementById('surveyFormContainer');
    if (old) old.remove();

    let surveyContainer = document.createElement('div');
    surveyContainer.className = 'survey-container-user';
    surveyContainer.id = 'surveyFormContainer';
    surveyContainer.style.cssText = 'width:100%;min-height:120px;display:flex;flex-wrap:wrap-reverse;overflow:visible;background:transparent;position:fixed;bottom:0;z-index:9999;box-sizing:border-box;';
    const shadowRoot = surveyContainer.attachShadow({ mode: 'open' });
    let cssUrl = chrome.runtime.getURL('content-scripts/reddit/inject.css');
    shadowRoot.innerHTML = '<iframe class="surveyIframe" src="' + chrome.runtime.getURL('sandbox/survey.html') + '" data-css="' + cssUrl + '" style="border:none;width:100%;height:100%;background:transparent;"></iframe>';

    let appRoot = document.querySelector(SEL_RD.appRoot || 'shreddit-app') || document.body;
    appRoot.insertAdjacentElement('beforebegin', surveyContainer);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

function _tryInjectUserSurvey() {
    if (!checkRedditUserURL()) return;
    let userCtx = availableContextsReddit.find(function(c) { return c.name === 'reddit-user'; });
    if (!userCtx || !userCtx.formTemplate) return;
    let username = crawlUserName();
    if (!username) return;
    injectRedditUserSurvey();
    userCtx.renderSurvey(username, null, {
        user_profile: function() { return extractRedditProfile(); }
    });
}

function _listenForRedditNavigation() {
    let lastPath = window.location.pathname;
    function onNav() {
        let newPath = window.location.pathname;
        if (newPath === lastPath) return;
        lastPath = newPath;
        _tryInjectUserSurvey();
    }
    window.addEventListener('popstate', onNav);
    let origPush = history.pushState;
    history.pushState = function() { origPush.apply(this, arguments); onNav(); };
    let origReplace = history.replaceState;
    history.replaceState = function() { origReplace.apply(this, arguments); onNav(); };
}

function initializeSurveys() {
    chrome.storage.local.get(['config', 'isEnabled', 'activeTargetList', 'clientID', 'isGuided', 'selectors', 'manipulationMaps'], function(result) {
        let _rawRD = (result.selectors && result.selectors.reddit) ? result.selectors.reddit : {};
        SEL_RD = Object.assign({}, _rawRD.shared || {}, _rawRD.account || {}, _rawRD.post || {}, _rawRD.comment || {});
        watchPostCounter('reddit', function() { return _processedCount_RD; });

        let _postConfRD = result.config.surveys && result.config.surveys['reddit-post'];
        manipConfig_RD = (_postConfRD && _postConfRD.manipulation) || {};
        if (manipConfig_RD.enabled && manipConfig_RD.source !== 'api' && result.manipulationMaps && result.manipulationMaps['reddit-post']) {
            let fullMap = result.manipulationMaps['reddit-post'];
            manipMapId_RD = (fullMap._meta && fullMap._meta.map_id) || '';
            let entries = Object.assign({}, fullMap);
            delete entries._meta;
            manipMap_RD = entries;
        }

        let _commentConfRD = result.config.surveys && result.config.surveys['reddit-comment'];
        manipConfig_RD_comment = (_commentConfRD && _commentConfRD.manipulation) || {};

        // Init intervention API — post config takes priority; comment config used as fallback
        if (manipConfig_RD.enabled && manipConfig_RD.source === 'api' && manipConfig_RD.endpoint && window.__sa_intervApi) {
            window.__sa_intervApi.init({ endpoint: manipConfig_RD.endpoint, survey_type: 'reddit-post', platform: 'reddit', mode: manipConfig_RD.mode, logOriginal: manipConfig_RD.logOriginal });
        } else if (manipConfig_RD_comment.enabled && manipConfig_RD_comment.source === 'api' && manipConfig_RD_comment.endpoint && window.__sa_intervApi) {
            window.__sa_intervApi.init({ endpoint: manipConfig_RD_comment.endpoint, survey_type: 'reddit-comment', platform: 'reddit', mode: manipConfig_RD_comment.mode, logOriginal: manipConfig_RD_comment.logOriginal });
        }

        for (let index = 0; index < availableContextsReddit.length; ++index) {
            let currentContext = availableContextsReddit[index];
            let contextFlag = result.config.activeSurveys.includes(currentContext.name);
            let auxFlag = currentContext.auxiliaryCheck();

            let activeSurvey = currentContext.name;
            let config = result.config['surveys'][activeSurvey];

            if (result.isEnabled !== true || contextFlag !== true || !config) continue;

            let studyID = config.studyID;

            (function(ctx, sid) {
                function submitAction(errors, values) {
                    if (errors) return;
                    values.surveyType = ctx.name;
                    values.studyID    = sid;

                    if (ctx.name === 'reddit-user') {
                        let profile = extractRedditProfile();
                        let capturedAvatar = profile.profile_img_url || null;
                        let capturedUserID = values.account_id;
                        chrome.storage.local.get(['isProfileDownloadEnabled'], function(res) {
                            if (res.isProfileDownloadEnabled && capturedAvatar) {
                                chrome.runtime.sendMessage({ action: 'downloadMedia', urls: [capturedAvatar], userId: capturedUserID || 'user', postId: 'profile', surveyType: ctx.name });
                            }
                        });
                    } else {
                        chrome.storage.local.get(['isMediaDownloadEnabled'], function(res) {
                            if (res.isMediaDownloadEnabled) {
                                let evt = new CustomEvent('mh:download-request', { detail: { postID: values.post_id, userID: values.account_id, surveyType: ctx.name } });
                                window.dispatchEvent(evt);
                            }
                        });
                    }

                    if (ctx.name === 'reddit-post') {
                        let _ma = manipApplied_RD[values.post_id];
                        if (_ma) {
                            values.intervention_applied = true;
                            values.intervention_label   = _ma.label;
                            values.intervention_map_id  = _ma.map_id;
                            if (_ma.original_text !== undefined) values.intervention_original_text = _ma.original_text;
                            if (_ma.extras) values.intervention_extras = _ma.extras;
                        } else {
                            values.intervention_applied = false;
                        }
                    } else if (ctx.name === 'reddit-comment') {
                        let _ma = manipApplied_RD_comment[values.post_id];
                        if (_ma) {
                            values.intervention_applied = true;
                            values.intervention_label   = _ma.label;
                            values.intervention_map_id  = _ma.map_id;
                            if (_ma.original_text !== undefined) values.intervention_original_text = _ma.original_text;
                            if (_ma.extras) values.intervention_extras = _ma.extras;
                        } else {
                            values.intervention_applied = false;
                        }
                    }

                    storeResults(values, 'reddit');
                }

                ctx.formTemplate  = config.surveyFormSchema;
                ctx.theme         = config.theme || 'light';
                ctx.submitAction  = submitAction;

                if (auxFlag !== true) return;

                ctx.injectSurvey(config.injectElement);

                if (ctx.name === 'reddit-post') {
                    _rdPostCtxActive = true;
                    startRedditObserver();
                } else if (ctx.name === 'reddit-comment') {
                    _rdCommentCtxActive = true;
                    startRedditObserver();
                } else if (ctx.name === 'reddit-user') {
                    _rdUserCtxActive = true;
                    let surveyID = crawlUserName();
                    ctx.renderSurvey(surveyID, null, {
                        user_profile: function() { return extractRedditProfile(); }
                    });
                }
            })(currentContext, studyID);
        }

        _listenForRedditNavigation();
    });
}

window.__socialAnnotate__.platformDebugCapture = function(selectors, stored) {
    let raw  = selectors.reddit || {};
    let SEL_D = Object.assign({}, raw.shared || {}, raw.account || {}, raw.post || {}, raw.comment || {});

    function probe(field) {
        let selector = SEL_D[field];
        if (!selector) return { field: field, selector: null, matched: false, value: null, note: 'not in selectors.json' };
        try {
            let el = document.querySelector(selector);
            return { field: field, selector: selector, matched: !!el, value: el ? (el.innerText || el.textContent || '').slice(0, 80).trim() : null };
        } catch(e) {
            return { field: field, selector: selector, matched: false, value: null, note: 'invalid: ' + e.message };
        }
    }

    return {
        platform:         'reddit',
        url:              window.location.href,
        postCount:        document.querySelectorAll(SEL_D.postContainer    || 'shreddit-post').length,
        commentCount:     document.querySelectorAll(SEL_D.commentContainer || 'shreddit-comment').length,
        injectedPosts:    _injectedPosts.size,
        injectedComments: _injectedComments.size,
        probes: ['appRoot', 'userDisplayName', 'userAvatar', 'userBio', 'postContainer', 'commentContainer'].map(probe)
    };
};

initializeSurveys();
