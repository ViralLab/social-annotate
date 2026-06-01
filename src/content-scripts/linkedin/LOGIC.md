# LinkedIn — Injection & Data Capture Logic

## Two-World Architecture

| File | World | Purpose |
|------|-------|---------|
| `inject-api.js` | MAIN | Captures LinkedIn HLS video segment URLs via PerformanceObserver + fetch/XHR interceptors; concatenates segments and returns data URL on request |
| `inject.js` | Isolated (content script) | Detects posts, injects survey forms, captures data; handles credentialed image fetch |

Communication via `window` events:
- `mh:li-cdn-video-url` — new CDN segment URL captured
- `mh:fetch-li-video` / `mh:fetch-li-video-result` — request segment concatenation from MAIN world

---

## Initialization Flow

1. `initializeSurveys()` fires on script load (guarded by `isExtensionContextValid()`)
2. Reads `selectors`, `config`, `isEnabled`, `isGuided`, `activeTargetList` from `chrome.storage.local`
3. Flattens `selectors.linkedin.shared + selectors.linkedin.account + selectors.linkedin.post` → `SEL_LI`
4. Calls `checkSelectorHealth('linkedin', SEL_LI, activeSurveys)`
5. Sets `liRoot = document.getElementById('root') || document.querySelector(SEL_LI.appRoot || '#root') || document.body`
6. Creates `MutationObserver` (`observerLI`)
7. Checks guided mode (navigates to `linkedin.com/feed/{target}` or `linkedin.com/in/{target}`)
8. For each active context, configures and calls `injectSurvey()` or `enableUserSurvey()`

`inject.js` also listens for `mh:li-cdn-video-url` at module level, storing the last seen CDN URL in `window.__socialAnnotate__.liLastCdnUrl`.

---

## Post Detection

**Observer root:** `liRoot` (`#root` or `document.body` fallback)

**Observer config:** `SEL_LI.observerFilter || { attributes: false, childList: true, subtree: true }`

**Post selector:** `SEL_LI.postContainer || '[data-testid="mainFeed"] [role="listitem"]'`

The observer checks both direct matches and nested descendants.

**1.5s delayed rescan** in `enablePostObserver`.

---

## Post ID Extraction (`extractPostDetails`)

LinkedIn post IDs come from a **DOM attribute** — not from URLs.

**Primary:** `postNode.dataset.componentkey` or `postNode.getAttribute('componentkey')`

**Fallback:** A random ID is generated (`Math.random().toString(36).substr(2, 9)`) and written back to the node as `setAttribute('componentkey', postID)`. This ensures every processed node gets a stable ID for the session.

**Owner:** `SEL_LI.userHandle || 'a[href*="/in/"]'` → regex `/\/in\/([^/?#]+)/`

No URL-based anchor scan — LinkedIn post IDs are opaque component keys, not path segments.

---

## Survey Injection

**Post survey:**
```
[role="listitem"]  ← postNode / insertElement
  └─ div.survey-container-post#surveyFormContainer-{postID}  (inserted afterbegin)
       └─ shadow root
            └─ iframe[src="sandbox/survey.html"]
  └─ (rest of post content)
```

**User survey:**
```
div.survey-container-user#surveyFormContainer  (inserted beforebegin of #root)
  └─ shadow root
       └─ iframe[src="sandbox/survey.html"]
#root  ← LinkedIn SPA root
```

User survey is inserted **before `#root`** — outside LinkedIn's SPA-managed DOM. This prevents two issues: SPA re-renders wiping the node, and CSS transforms on `#root` ancestors breaking `position: fixed`.

---

## Data Capture

| Field | Source | Selector / Logic |
|-------|--------|-----------------|
| `body` | DOM | `SEL_LI.postText \|\| '[data-testid="expandable-text-box"]'` — joins `innerText` blocks with `\n\n` |
| `media_urls` | DOM (snapshot only) | Images: `SEL_LI.postImage \|\| 'img[alt="View image"]'`. Videos: `SEL_LI.postVideo \|\| 'video'` → `<source>` or `video.src/currentSrc` |
| `created_at` | DOM | `time[datetime]` → `datetime` attribute |
| `post_metrics` | **stub — returns all nulls** | Not yet implemented |

### Why Metrics Return Null

`extractPostMetrics` is a stub function. LinkedIn's metric counts (reactions, comments, reposts) are visible in the DOM but implementation has not been added. To implement: scan `[aria-label]` elements inside the post node for patterns like `"N reactions"`, `"N comments"`, `"N reposts"`.

---

## Media Download Flow (`mh:download-request`)

### Images

LinkedIn CDN images require **session cookies** to download (unlike most platforms). The isolated world can make credentialed fetches via `fetch(url, { credentials: 'include' })`:

1. Finds `img[alt="View image"]` elements inside the post node
2. For each image URL: `fetch(url, { credentials: 'include' })` → `response.blob()` → `FileReader.readAsDataURL` → data URL
3. Sends data URL to background via `chrome.runtime.sendMessage`
4. On fetch failure: falls back to sending the raw URL (background will attempt direct download)

### Videos — HLS Segment Strategy

LinkedIn videos are HLS streams delivered from `dms.licdn.com` / `media.licdn.com` / `video.licdn.com`. There is no single downloadable MP4 URL — the video is split into many `.ts` or `.m4s` segments.

**Critical CORS constraint:** LinkedIn CDN serves segments with `Access-Control-Allow-Origin: *` (wildcard). Wildcard ACAO is **incompatible with `credentials: include`** — any credentialed fetch will be blocked by CORS. Segments must be fetched with `credentials: 'omit'`. Token-signed URLs (with `e=` and `t=` params) work without cookies.

**Capture flow (inject-api.js — 3 strategies):**

1. **PerformanceObserver** (primary): watches all resource requests including those made by the native HLS player or Service Workers; calls `_captureUrl(entry.name)` for every resource
2. **fetch() interceptor**: wraps `window.fetch` — captures CDN URLs before the request is made
3. **XHR interceptor**: wraps `XMLHttpRequest.prototype.open` — captures CDN URLs on `load` event

`_captureUrl(url)` logic:
- Must be a LinkedIn CDN URL (`dms.licdn.com`, `media.licdn.com`, `video.licdn.com`)
- Must look like a video segment: excludes `.vtt`, `.m3u8`, `.mpd`, `caption`, `subtitle`, `hls-audio`, `/thumbnail`; requires HLS quality path pattern (`hls-[0-9]`) or `.ts`/`.m4s` extension
- Extracts `videoId` from path: `/vid/v2/{videoId}/hls-...`
- Stores in `window.__liVideoSegments[videoId][]`
- Sets `window.__liLastVideoId` and dispatches `mh:li-cdn-video-url`

**Download flow (inject.js + inject-api.js):**

1. `inject.js` receives `mh:download-request`
2. Checks `window.__socialAnnotate__.liLastCdnUrl` (set by `mh:li-cdn-video-url` events)
3. If no CDN URL and `<video>` element present: tries `video.currentSrc || video.src` as fallback
4. Dispatches `mh:fetch-li-video` with `{ url, reqId, videoId }`
5. MAIN world receives `mh:fetch-li-video`:
   - Collects all captured segments for `videoId` from `window.__liVideoSegments[videoId]`
   - Sorts segments by index (extracted from path: last numeric path segment < 100000)
   - Fetches each segment with `credentials: 'omit'`
   - Concatenates all segment `Blob`s into one `Blob({ type: 'video/mp4' })`
   - Converts to data URL via `FileReader`
   - Dispatches `mh:fetch-li-video-result` with `{ reqId, dataUrl }`
6. `inject.js` receives result → sends to background
7. Clears `liLastCdnUrl` so the next post gets a fresh capture

**Important:** The user must **play the video** before clicking download. Segments are only captured while the video is playing. Unplayed videos will have no segments in `window.__liVideoSegments`.

---

## User Profile Extraction (`extractLinkedInUserProfile`)

| Field | Selector |
|-------|---------|
| `displayName` | `SEL_LI.userDisplayName \|\| "section[componentkey*='Topcard'] h2"` |
| `headline` | `SEL_LI.userHeadline \|\| "section[componentkey*='Topcard'] p.d8d5bbbc._2f6a5622"` with `main p` fallback |
| `location` | `SEL_LI.userLocation \|\| "section[componentkey*='Topcard'] p.bab73015._98cb9b8f"` |
| `followersText` | `SEL_LI.userFollowers \|\| "a[href*='followers'] p"` |
| `connectionsText` | `SEL_LI.userConnections \|\| "a[href*='connections'] p"` |
| `avatarUrl` | `SEL_LI.userAvatar \|\| "section[componentkey*='Topcard'] figure img._17236dac:not([alt='Cover photo'])[fetchpriority='high']"` + srcset CDN URL extraction |
| `bannerUrl` | `SEL_LI.userBanner \|\| "section[componentkey*='Topcard'] figure img._17236dac[alt='Cover photo']"` + srcset CDN URL extraction |

Avatar and banner: prefers `currentSrc`, falls back to highest-resolution entry in `srcset` attribute (sorted by descriptor, picks last = largest). This is necessary because on saved pages `src` may be a local path.

Profile/banner images also require credentialed fetch — same `fetch(url, { credentials: 'include' })` → data URL flow as post images.

---

## Selectors Reference

All selectors live in `selectors.json` under `linkedin.shared`, `linkedin.account`, or `linkedin.post`.

| Key | Default value | What it targets |
|-----|--------------|----------------|
| `appRoot` | `#root` | React SPA mount point |
| `postContainer` | `[data-testid="mainFeed"] [role="listitem"]` | Individual feed post list item |
| `postText` | `[data-testid="expandable-text-box"]` | Post body text container |
| `postImage` | `img[alt="View image"]` | Post images (alt text distinguishes post images from avatars) |
| `postVideo` | `video` | Post video element |
| `userHandle` | `a[href*="/in/"]` | Profile link inside a post (used for owner extraction) |
| `userDisplayName` | `section[componentkey*='Topcard'] h2` | Display name on profile page |
| `userHeadline` | `section[componentkey*='Topcard'] p.d8d5bbbc._2f6a5622` | Headline/title on profile page |
| `userLocation` | `section[componentkey*='Topcard'] p.bab73015._98cb9b8f` | Location on profile page |
| `userFollowers` | `a[href*='followers'] p` | Followers count link |
| `userConnections` | `a[href*='connections'] p` | Connections count link |
| `userAvatar` | `section[componentkey*='Topcard'] figure img._17236dac:not([alt='Cover photo'])[fetchpriority='high']` | Profile picture |
| `userBanner` | `section[componentkey*='Topcard'] figure img._17236dac[alt='Cover photo']` | Banner/cover photo |

---

## Platform-Specific Quirks

- **Obfuscated class names** (`_17236dac`, `d8d5bbbc`, etc.): LinkedIn uses hashed CSS class names that change with deployments. The selectors for `userHeadline`, `userLocation`, and `userAvatar` rely on these. When LinkedIn redeploys, these selectors will break and must be updated. Prefer `componentkey*='Topcard'` anchor + structural position over class names where possible.
- **`componentkey` as post ID**: LinkedIn's React components write their internal component key to a DOM attribute. This is stable within a session but not guaranteed across page loads (LinkedIn may reassign keys on re-render). For the purposes of survey deduplication within a session this is sufficient.
- **Random ID fallback**: If `componentkey` is absent, a random alphanumeric ID is generated and written back to the node. This ID is lost on re-render — if the user scrolls away and back, the post may get a new random ID and the "already annotated" check won't fire.
- **HLS segment expiry**: LinkedIn CDN segment URLs are token-signed with short-lived `e=` (expiry) and `t=` (token) parameters. If the user waits too long after playing the video before downloading, the segment URLs may have expired. The error message from inject-api.js in this case: `"URLs may have expired — try playing the video again"`.
- **`credentials: 'omit'` is mandatory for video**: Using `credentials: 'include'` on a wildcard ACAO endpoint causes a CORS error. This is a hard browser security constraint, not a LinkedIn-specific restriction.
- **User survey page detection**: `isLinkedInUserPage()` checks `window.location.pathname` against `/^\/in\/[^/]+\/?/`. Company pages (`/company/`), job pages (`/jobs/`), etc. are excluded.
- **Extension context guard**: Multiple functions check `isExtensionContextValid()` before accessing `chrome.*` APIs. LinkedIn tabs are often kept open for hours; the extension may be reloaded or updated during that time, invalidating the context.
