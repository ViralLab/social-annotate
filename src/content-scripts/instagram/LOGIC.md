# Instagram — Injection & Data Capture Logic

## Two-World Architecture

| File | World | Purpose |
|------|-------|---------|
| `inject-api.js` | MAIN | Intercepts XHR/fetch to `/graphql/` and `/api/v1/` endpoints; extracts native video URLs keyed by post shortcode |
| `inject.js` | Isolated (content script) | Detects posts, injects survey forms, captures data |

Communication: `document.dispatchEvent` / `document.addEventListener` with event `mh:media-response-ig`.

---

## Initialization Flow

1. `initializeSurveys()` fires on script load
2. Reads `selectors`, `config`, `isEnabled`, `activeTargetList` from `chrome.storage.local`
3. Flattens `selectors.instagram.shared + selectors.instagram.account + selectors.instagram.post` → `SEL_IG`
4. Calls `checkSelectorHealth('instagram', SEL_IG, activeSurveys)`
5. **Observer starts immediately** inside `initializeSurveys` callback (after `formTemplate` is set), observing `document.body` with `SEL_IG.observerFilter || { childList: true, subtree: true }`
6. Initial scan + 1.5s delayed rescan of `SEL_IG.postContainer || 'article'`
7. For each active context, configures `formTemplate`, `theme`, `submitAction`, calls `injectSurvey()`

Note: `igObserver` and `observerTarget = document.body` are declared at module level (outside `initializeSurveys`) so the observer exists even before config loads. The observer only calls `processInstagramArticleNode` which guards on `postCtx.formTemplate` — so no survey is injected until config is ready.

---

## Post Detection

**Observer root:** `document.body` (hardcoded, no fallback needed)

**Observer config:** `SEL_IG.observerFilter || { childList: true, subtree: true }`

**Post selector:** `SEL_IG.postContainer || 'article'`

The observer watches for added nodes that are `article` elements (checked by `tagName`) or contain article descendants.

**1.5s delayed rescan** in `initializeSurveys` catches articles in the DOM before observer fires.

---

## Post ID Extraction (`extractInstagramPostDetails`)

Works on `articleNode` directly.

**Tier 1 — Post link selector:**
- Finds `SEL_IG.postLink || "a[href*='/p/'], a[href*='/reel/']"` inside the article
- Resolves the href to a full pathname via `new URL(href, window.location.origin).pathname`
- Extracts shortcode: `/(?:p|reel)/([^/?#]+)/`

**Tier 2 — Flat anchor scan (fallback):**
- If Tier 1 returns nothing
- Scans all `a[href]` inside the article
- Tests each raw `href` attribute against `/\/(?:p|reel)\/[^/?#]+/` (note: uses raw attribute, not `.href`, to avoid pre-resolved absolute URLs confusing the test)
- Takes first match, then applies full URL resolution and regex extraction

**User extraction:**
- Scans `SEL_IG.userLink || "a[href]"` (all anchors in the article)
- Skips `#`, `/p/`, `/reel/`, `/explore/` links
- Takes first anchor whose pathname matches `^/([^/?#]+)` — this is the post author's username

**Returns:** `{ postID, postOwner }` or `null`

---

## Survey Injection

```
article  ← articleNode
  └─ div.survey-container-tweet#surveyFormContainer-{postID}  (inserted afterbegin)
       └─ shadow root
            └─ iframe[src="sandbox/survey.html"]
  └─ (rest of article content)
```

`injectInstagramPostSurvey(articleNode, postID, postOwner)` inserts `afterbegin` of `articleNode`.

Guard: skips if `getElementsByClassName('survey-container-tweet').length > 0` already.

Note: uses class `survey-container-tweet` (same as X) — reuses the X CSS styling.

---

## Auto-Expand Description

`processInstagramArticleNode` first tries to click any element with `innerText === 'more'` to expand truncated captions before extracting text. This is attempted again in `extractInstagramText` at submission time.

---

## Data Capture

| Field | Source | Selector / Logic |
|-------|--------|-----------------|
| `body` | DOM | All `h1[dir='auto'], span[dir='auto']` elements; takes the **longest** `innerText`; strips trailing `...more` |
| `media_urls` | DOM + API | See media section below |
| `created_at` | DOM | `time[datetime]` → `datetime` attribute |
| `post_metrics` | DOM (SEL_IG overrides only) | `metricsLike`, `metricsReply`, `metricsViews` selectors; no defaults (returns null if not configured) |

### Media Extraction

DOM scraping (`extractInstagramMedia`):
- `img` elements: skip if `alt` contains `profile picture` or `logo`; use `src` attribute
- `video` elements: prefer `<source src>`, then `el.src/currentSrc`; blob URLs become `[Blob Stream] {url}` prefix

API enrichment:
- `inject-api.js` intercepts `/graphql/` and `/api/v1/` responses
- Recursively finds objects with `shortcode`/`code` + `video_url` or `video_versions[0].url`
- Dispatches `mh:media-response-ig` with `{ shortcode: [url, ...] }`
- `inject.js` merges into `window.__socialAnnotate__.instagramApiMediaMap[shortcode]`
- At download time: if API map has URLs for this postID (shortcode), replaces blob streams with native MP4 URLs

---

## Media Download Flow (`mh:download-request`)

1. Triggered by survey iframe `postMessage({ type: 'downloadMedia' })`
2. `injectNode = surveyContainer.closest('article')`
3. Calls `extractInstagramMedia(injectNode)` for DOM URLs
4. Merges with `window.__socialAnnotate__.instagramApiMediaMap[postID]` (native MP4s); if API URLs exist, removes `[Blob Stream]` entries
5. Deduplicates with `new Set()`
6. **Valid URLs** (non-blob): sent to background via `chrome.runtime.sendMessage`
7. **Blob streams only**: logs warning — Instagram blob streams are HLS and cannot be directly downloaded

---

## Selectors Reference

All selectors live in `selectors.json` under `instagram.shared`, `instagram.account`, or `instagram.post`.

| Key | Default value | What it targets |
|-----|--------------|----------------|
| `appRoot` | `#react-root` | React SPA mount point (used only for user survey injection fallback) |
| `postContainer` | `article` | Individual post article element |
| `postLink` | `a[href*='/p/'], a[href*='/reel/']` | Anchor linking to post permalink |
| `userLink` | `a[href]` | All anchors (filtered to find author link) |
| `postText` | *(no default — uses structural extraction)* | Post caption — longest `h1[dir='auto'], span[dir='auto']` |
| `postImage` | *(no default — uses `img` broadly)* | Post images |
| `postVideo` | *(no default — uses `video` broadly)* | Post video element |
| `metricsLike` | *(none — returns null if absent)* | Like count element |
| `metricsReply` | *(none)* | Comment count element |
| `metricsViews` | *(none)* | View count element |
| `userAvatar` | `header img[alt]` | Profile picture in header |
| `observerFilter` | `{ childList: true, subtree: true }` | MutationObserver init config |

---

## Platform-Specific Quirks

- **Post ID is a shortcode**, not a numeric ID. Example: `C1xYzAbCdEf`. This is the path segment after `/p/` or `/reel/` in the post URL. The API map also keys on shortcode, so these must match.
- **Reel vs Post URLs**: Both `/p/{shortcode}` and `/reel/{shortcode}` are valid Instagram post URL patterns. The extraction regex handles both with `(?:p|reel)`.
- **Caption expansion**: Instagram truncates captions in the feed with a "more" button. The auto-click in `processInstagramArticleNode` fires before extraction. If the DOM structure of the "more" button changes, captions may be incomplete.
- **User survey injection**: Falls back to `document.body.insertAdjacentElement('afterbegin', ...)` if `#react-root` is not found — modern Instagram may not use `#react-root`.
- **API interception key**: The API fires on both `/graphql/` (older endpoint) and `/api/v1/` (newer). If Instagram switches to a third endpoint pattern, add it to both the XHR `url.includes` check and the fetch interceptor condition in `inject-api.js`.
- **Profile picture alt filtering**: `extractInstagramMedia` skips images whose `alt` attribute contains `profile picture` or `logo`. If Instagram changes these alt text strings, profile images may incorrectly appear in post media.