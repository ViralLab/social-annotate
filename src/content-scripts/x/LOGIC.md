# X (Twitter) — Injection & Data Capture Logic

## Two-World Architecture

| File | World | Purpose |
|------|-------|---------|
| `inject-api.js` | MAIN | Patches `XMLHttpRequest.prototype.open` to intercept GraphQL responses and extract native media URLs |
| `inject.js` | Isolated (content script) | Detects posts, injects survey forms, captures data |

The two worlds cannot share memory directly. They communicate through **custom DOM events** (`document.dispatchEvent` / `document.addEventListener`).

---

## Initialization Flow

1. `initializeSurveys()` fires on script load
2. Reads `selectors`, `config`, `isEnabled` from `chrome.storage.local`
3. Flattens `selectors.x.shared + selectors.x.account + selectors.x.post` → module-level `SEL` object
4. Calls `checkSelectorHealth('x', SEL, activeSurveys)` — tests `SEL.appRoot` against the live DOM
5. Sets `reactRoot = document.querySelector(SEL.appRoot || '#react-root') || document.body`
6. Creates the `MutationObserver`
7. Checks guided mode (auto-navigates to first target if on `/home`)
8. For each active context, sets `formTemplate`, `theme`, `submitAction`, calls `injectSurvey()`

---

## Post Detection

**Observer root:** `reactRoot` (`#react-root` or `document.body` fallback)

**Observer config:** `{ attributes: true, childList: true, subtree: true, attributeFilter: ['role'] }`

**Post selector:** `SEL.postContainer || 'article[role="article"]'`

The observer watches for:
- Added nodes with `role="article"` → calls `processArticleNode(node)` directly
- Added nodes that contain article descendants → `querySelectorAll` inside them
- Attribute mutations on `role="article"` nodes (for SPA re-renders)

**1.5s delayed rescan** in `enableTweetObserver` catches posts rendered before the observer attaches.

---

## Post ID Extraction (`extractTweetDetails`)

Works on `insertElement = articleNode.parentNode`.

**Tier 1 — Timestamp anchor:**
- Finds `SEL.postTimestamp || 'time'` inside the article
- Checks `timeElement.parentNode.href` — on X, the timestamp is always wrapped in a permalink anchor like `<a href="/user/status/123456"><time>...</time></a>`
- Parses owner + ID from: `(?:x|twitter)\.com/([^/?#]+)/status/(\d+)`

**Tier 2 — Anchor scan (fallback):**
- If Tier 1 fails (time element missing or not inside an anchor)
- Scans `articleNode.querySelectorAll('a[href*="/status/"]')`
- Takes the first anchor that **contains a `<time>` child** — this avoids matching quoted-tweet anchors which link to a different post's status URL but never wrap a timestamp

**Returns:** `{ tweetOwner, tweetID }` or `null` (ads, skeleton nodes, sponsored posts)

---

## Survey Injection

```
articleNode.parentNode  ← insertElement
  └─ div#surveyFormContainer-{tweetID}  (inserted afterbegin)
       └─ shadow root
            └─ iframe[src="sandbox/survey.html"]
  └─ article[role="article"]  ← original post
```

`injectTwitterTweetSurvey(insertElement, tweetID, tweetOwner)` inserts the survey container `afterbegin` of `insertElement` (the article's parent), so the form appears **above** the tweet.

Guard: skips injection if `getElementsByClassName('survey-container-tweet').length > 0` already.

---

## Data Capture

| Field | Source | Selector / Logic |
|-------|--------|-----------------|
| `body` | DOM | `SEL.postText \|\| '[data-testid="tweetText"]'` — joins multiple `innerText` blocks with `\n\n`; also appends link preview URLs from `SEL.cardWrapper \|\| '[data-testid="card.wrapper"]'` |
| `media_urls` | API cache first, DOM fallback | API: `window.__socialAnnotate__.twitterApiMediaMap[tweetID]`; DOM images: `SEL.postImage \|\| '[data-testid="tweetPhoto"] img'`; DOM videos: `SEL.postVideo \|\| '[data-testid="videoPlayer"] video'` (prefers `<source>` MP4, skips `blob:`, falls back to `.poster`) |
| `created_at` | DOM | `SEL.postTimestamp \|\| 'time'` → `datetime` attribute |
| `post_metrics` | DOM aria-labels | See metrics section below |

### Metrics Extraction

Uses `[data-testid="{name}"]` or `[data-testid="un{name}"]` for toggled states, or a full CSS selector if `SEL.metrics*` looks like a CSS selector (contains `.`, `#`, `[`, spaces, etc.).

| Metric | Default selector / testid |
|--------|--------------------------|
| `comment_count` | `SEL.metricsReply \|\| 'reply'` |
| `share_count` | `SEL.metricsRepost \|\| 'retweet'` |
| `like_count` | `SEL.metricsLike \|\| 'like'` |
| `bookmark_count` | `SEL.metricsBookmark \|\| 'bookmark'` |
| `view_count` | Scans all `[aria-label]` elements for pattern `N views?` or "view post analytics" |

Counts are extracted from `aria-label` (pattern `^(N) `) or `data-tweet-stat-count` attribute or nested child `innerText`.

---

## Media Download Flow (`mh:download-request`)

1. Triggered by survey iframe `postMessage({ type: 'downloadMedia' })`
2. Looks up `window.__socialAnnotate__.twitterApiMediaMap[tweetID]` — populated by `inject-api.js`
3. If API cache hit: uses those URLs directly (native MP4s and full-res images)
4. If cache miss: falls back to `extractTweetMedia(injectNode)` — DOM scraping
5. Filters out `blob:` and `[Video Thumbnail]` prefixed URLs
6. Sends `chrome.runtime.sendMessage({ action: 'downloadMedia', urls, userId, postId, surveyType })`

### MAIN-world API Interception (`inject-api.js`)

- Patches `XMLHttpRequest.prototype.open`
- Watches all requests containing `/graphql/`
- On 200 response, recursively walks JSON for objects with `legacy.id_str` + `legacy.extended_entities.media`
- For videos: picks highest-bitrate `video/mp4` variant from `video_info.variants`
- For photos: uses `media_url_https`
- Result keyed by `tweetID` → dispatched via `document.dispatchEvent(new CustomEvent('mh:media-response', { detail: mediaMap }))`
- `inject.js` listens and merges into `window.__socialAnnotate__.twitterApiMediaMap`

---

## Selectors Reference

All selectors live in `selectors.json` under `x.shared`, `x.account`, or `x.post`. At runtime they are merged into a flat `SEL` object.

| Key | Default value | What it targets |
|-----|--------------|----------------|
| `appRoot` | `#react-root` | SPA mount point — must exist at page load |
| `postContainer` | `article[role="article"]` | Individual tweet article element |
| `postTimestamp` | `time` | `<time datetime="...">` inside a tweet, wrapped in a permalink anchor |
| `postText` | `[data-testid="tweetText"]` | Tweet body text container |
| `postImage` | `[data-testid="tweetPhoto"] img` | In-tweet images |
| `postVideo` | `[data-testid="videoPlayer"] video` | In-tweet video player |
| `cardWrapper` | `[data-testid="card.wrapper"]` | Link preview cards |
| `metricsReply` | `reply` | Reply/comment count button (data-testid) |
| `metricsRepost` | `retweet` | Retweet count button |
| `metricsLike` | `like` | Like count button |
| `metricsBookmark` | `bookmark` | Bookmark count button |
| `metricsViewsPattern` | `views?` | Regex word used to find view count aria-label |
| `userDisplayName` | `[data-testid="UserName"]` | Profile display name container |
| `userHandle` | `[data-testid="UserName"] a[href] span` | @handle span |
| `userProfileSchema` | `script[data-testid="UserProfileSchema-test"]` | JSON-LD structured data with avatar URL |
| `userProfileAvatar` | `[data-testid^="UserAvatar-Container-"]` | Avatar container element |
| `userBanner` | `img[src*="profile_banners"]` | Banner image |
| `userBio` | `[data-testid="UserDescription"]` | Bio/description text |
| `userVerified` | `[data-testid="icon-verified"]` | Verified badge |
| `userFollowers` | `a[href$="/verified_followers"], a[href$="/followers"]` | Followers count link |
| `userFollowing` | `a[href$="/following"]` | Following count link |
| `userLocation` | `[data-testid="UserLocation"]` | Location text |
| `userJoinDate` | `[data-testid="UserJoinDate"]` | Join date text |
| `userUrl` | `[data-testid="UserUrl"]` | Website URL |

---

## Platform-Specific Quirks

- **Quoted tweets**: A tweet can embed another tweet. The quoted tweet's article also contains `a[href*="/status/"]` links pointing to the *quoted* tweet's URL. The Tier 2 anchor scan avoids this by requiring the anchor to contain a `<time>` child — quoted tweet anchors never wrap a timestamp element.
- **Ads / Promoted tweets**: These have no `<time>` element with a permalink parent → `extractTweetDetails` returns `null` → skipped correctly.
- **Video format**: X uses HLS/m3u8 for most videos, but the GraphQL API response exposes direct MP4 variants. Always prefer API cache over DOM scraping for video. DOM scraping for video only works on non-HLS posts.
- **Avatar URL resolution**: Multiple fallback strategies ordered by reliability: JSON-LD > avatar container img > legacy container > background-image CSS > page-wide img scan.
- **Guided mode**: When `isGuided=true` and on `/home`, auto-navigates to `platformURL + 'i/web/status/' + firstTarget` for post surveys.