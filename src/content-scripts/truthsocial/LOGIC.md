# TruthSocial — Injection & Data Capture Logic

## Architecture

TruthSocial is the only platform with **no MAIN-world inject-api.js**. Instead it uses the **public Mastodon REST API** directly from the isolated world — TruthSocial runs on a Mastodon fork, and its `/api/v1/statuses/{id}` endpoint is accessible with the user's session cookies from the content script.

| File | World | Purpose |
|------|-------|---------|
| `inject.js` | Isolated (content script) | Detects posts, injects survey forms, fetches Mastodon API, captures data |

---

## Initialization Flow

1. `initializeSurveys()` fires on script load
2. Reads `selectors`, `config`, `isEnabled`, `isGuided`, `activeTargetList` from `chrome.storage.local`
3. Flattens `selectors.truthsocial.shared + selectors.truthsocial.account + selectors.truthsocial.post` → `SEL_TS`
4. Calls `checkSelectorHealth('truthsocial', SEL_TS, activeSurveys)`
5. Sets `tsRoot = document.getElementById('root') || document.querySelector(SEL_TS.appRoot || '#root') || document.body`
6. Creates `MutationObserver` (`observerTS`)
7. Checks guided mode
8. For each active context, configures and calls `enablePostObserver()`

---

## Post Detection

**Observer root:** `tsRoot` (`#root` or `document.body` fallback)

**Observer config:** `SEL_TS.observerFilter || { attributes: false, childList: true, subtree: true }`

**Post selector:** `SEL_TS.postContainer || '[data-testid="status"]'`

The observer checks both direct matches and nested descendants.

**1.5s delayed rescan** in `enablePostObserver`.

---

## Post ID Extraction (`extractPostDetails`)

Multi-tier approach:

**Tier 1a — Timestamp link:**
- Finds `SEL_TS.postTimestamp || 'a[href*="/posts/"] time'` — a `<time>` element inside a `/posts/` anchor
- Gets the anchor via `postLink.closest('a')` if `postLink` is the `<time>` element
- Applies regex `/@([^/]+)\/posts\/([^/?#]+)/` to extract owner and postID

**Tier 1b — Direct post link:**
- If no `<time>` found, tries `postNode.querySelector('a[href*="/posts/"]')` directly
- Same regex applied to `href`

**Tier 2 — Flat anchor scan (fallback):**
- If href extraction yielded no postID
- Scans all `a[href]` inside the post node
- Applies same regex `/@([^/]+)\/posts\/([^/?#]+)/` to each anchor's `href`
- Takes first match

**Tier 3 — `id` attribute:**
- If no URL-based ID found: checks `postNode.id.startsWith('status-')` → strips prefix

**Owner fallback:**
- If postID found but postOwner still empty: queries `SEL_TS.userHandle || '[data-testid="account"] a[href^="/@"]'` → regex `/@([^/?#]+)/`

**Returns:** `{ postOwner, postID }` or `null`

---

## Survey Injection

```
[data-testid="status"]  ← postNode / insertElement
  └─ div.survey-container-post#surveyFormContainer-{postID}  (inserted afterbegin)
       └─ shadow root
            └─ iframe[src="sandbox/survey.html"]
  └─ (rest of post content)
```

`injectTruthSocialPostSurvey(insertElement, postID)` inserts `afterbegin` of `postNode` itself (unlike X/Bluesky which use `parentNode`).

Guard: `getElementsByClassName('survey-container-post').length > 0`

---

## Mastodon API Enrichment

As soon as a post is detected in `processPostNode`, **`fetchTruthSocialPostData(postID)`** is called asynchronously (fire-and-forget):

```
GET https://truthsocial.com/api/v1/statuses/{postID}
credentials: 'include'  ← user's session cookies required
```

Response is cached in `_tsApiCache[postID]`. If the API call fails, DOM scraping serves as fallback.

API data takes **priority over DOM** for all fields when available:

| Field | API source | DOM fallback |
|-------|-----------|-------------|
| `body` | `data.content` (HTML → stripped to text via `_tsStripHtml`) | `[data-testid="status-content"] [data-testid="markup"]` |
| `media_urls` | `data.media_attachments[].url \|\| .preview_url` | `a[href*="media_attachments"]`, `img`, `video` |
| `like_count` | `data.favourites_count` | Button aria-label |
| `share_count` | `data.reblogs_count` | Button aria-label |
| `comment_count` | `data.replies_count` | Button aria-label |
| `created_at` | `data.created_at` (ISO 8601) | `a[href*="/posts/"] time` → `datetime` attribute |

---

## Data Capture

### Text (`extractPostTextContent`)
Selector: `SEL_TS.postText || '[data-testid="status-content"] [data-testid="markup"]'`
Joins multiple blocks with `\n\n`. Only used if API `content` is unavailable.

### Media (`extractPostMedia`)
Three-pass DOM extraction (only used if API `media_attachments` is empty):

1. **Anchor hrefs** — `a[href*="media_attachments"], a[id*="media-gallery"]` — always present even when `<img>` src is lazy-not-loaded; only HTTPS URLs, skips `avatar`
2. **Image src** — `SEL_TS.postImage || 'img'` — skips avatar, icon, missing.png
3. **Video src** — `SEL_TS.postVideo || 'video'` — prefers `<source>`, falls back to `video.src/currentSrc`

### Metrics (`extractPostMetrics`)
DOM-only fallback (API metrics always preferred):

| Metric | Selector |
|--------|---------|
| `comment_count` | `SEL_TS.metricsReply \|\| 'button[aria-label="Reply"], button[aria-label="Replies"]'` → `innerText` |
| `share_count` | `SEL_TS.metricsRepost \|\| 'button[aria-label="ReTruth"], button[aria-label="ReTruths"]'` |
| `like_count` | `SEL_TS.metricsLike \|\| 'button[aria-label="Like"], button[aria-label="Likes"]'` |

---

## Media Download Flow (`mh:download-request`)

1. Triggered by survey iframe `postMessage({ type: 'downloadMedia' })`
2. If `_tsApiCache[postID]` not yet populated, **awaits** `fetchTruthSocialPostData(postID)` (retry)
3. Calls `_tsMediaUrlsFromApi(apiData)` — direct CDN URLs from API
4. If API media is empty, falls back to `extractPostMedia(injectNode)` — DOM scraping
5. Sends all URLs to background via `chrome.runtime.sendMessage`

No MAIN-world delegation needed — TruthSocial media URLs are plain HTTPS CDN links.

---

## Selectors Reference

All selectors live in `selectors.json` under `truthsocial.shared`, `truthsocial.account`, or `truthsocial.post`.

| Key | Default value | What it targets |
|-----|--------------|----------------|
| `appRoot` | `#root` | React SPA mount point |
| `postContainer` | `[data-testid="status"]` | Individual post/status element |
| `postTimestamp` | `a[href*="/posts/"] time` | `<time>` inside the post permalink anchor |
| `postText` | `[data-testid="status-content"] [data-testid="markup"]` | Post body text |
| `postImage` | `img` | Post images (broad — filtered by URL patterns) |
| `postVideo` | `video` | Post video element |
| `metricsReply` | `button[aria-label="Reply"], button[aria-label="Replies"]` | Reply count button |
| `metricsRepost` | `button[aria-label="ReTruth"], button[aria-label="ReTruths"]` | ReTruth count button |
| `metricsLike` | `button[aria-label="Like"], button[aria-label="Likes"]` | Like count button |
| `userHandle` | `[data-testid="account"] a[href^="/@"]` | Post author profile link |

---

## Platform-Specific Quirks

- **Post IDs are Mastodon numeric IDs** (e.g., `112345678901234567`) — large integers as strings. The Mastodon API endpoint uses these directly.
- **`credentials: 'include'` required**: Even public posts require session cookies because TruthSocial's API rejects unauthenticated requests with 401. The user must be logged in for API enrichment to work.
- **`_tsApiCache` is module-level** — survives for the lifetime of the page. Re-fetching won't happen for already-seen posts unless the page is refreshed.
- **`_tsStripHtml`**: Mastodon API returns post content as HTML (e.g., `<p>Hello <a href="...">world</a></p>`). A throwaway `<div>` is used to strip tags and extract plain text.
- **Mastodon terminology**: "ReTruth" = reblog/boost; `reblogs_count` in the API. "Like" = favourite; `favourites_count`. These are Mastodon standard fields.
- **User page detection**: `checkUserURL()` returns true if the URL contains `/@{username}` and is NOT a `/posts/` path. Profile pages have the format `truthsocial.com/@username`.
- **Media attachment anchor hrefs**: TruthSocial renders media gallery items as `<a href="...CDN_URL..." id="media-gallery-...">`. These anchor hrefs point directly to the CDN file and are present even before the image lazy-loads — making them the most reliable DOM media source.
