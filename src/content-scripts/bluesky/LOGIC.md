# Bluesky — Injection & Data Capture Logic

## Two-World Architecture

| File | World | Purpose |
|------|-------|---------|
| `inject-api.js` | MAIN | Intercepts fetch/XHR to `video.bsky.app/watch/...` to extract video DID + CID; tags `<video>` elements with dataset attributes |
| `inject.js` | Isolated (content script) | Detects posts, injects survey forms, captures data |

Communication: `document.dispatchEvent` / `document.addEventListener` with event `mh:bsky-video-found`.

---

## Initialization Flow

1. `initializeSurveys()` fires on script load
2. Reads `selectors`, `config`, `isEnabled`, `isGuided`, `activeTargetList` from `chrome.storage.local`
3. Flattens `selectors.bluesky.shared + selectors.bluesky.account + selectors.bluesky.post` → `SEL_BS`
4. Calls `checkSelectorHealth('bluesky', SEL_BS, activeSurveys)` — tests `SEL_BS.appRoot`
5. Sets `bskyRoot = document.getElementById('root') || document.querySelector(SEL_BS.appRoot || '#root') || document.body`
6. Creates `MutationObserver`
7. Checks guided mode
8. For each active context, configures and calls `injectSurvey()`

---

## Post Detection

**Observer root:** `bskyRoot` (`#root` or `document.body` fallback)

**Observer config:** `{ attributes: false, childList: true, subtree: true }`

**Post selector:** `SEL_BS.postContainer || '[data-testid*="feedItem"], [data-testid*="postThreadItem"]'`

The observer checks both the added node itself (via `.matches`) and its descendants (via `querySelectorAll`).

**1.5s delayed rescan** in `enablePostObserver` catches posts rendered before the observer attaches.

---

## Post ID Extraction (`extractPostDetails`)

Works on `postNode` directly.

**Tier 1 — Timestamp/post anchor:**
- Finds `SEL_BS.postTimestamp || 'a[href*="/post/"]'` inside the post node
- Applies regex `/\/profile\/([^/]+)\/post\/([^/?#]+)/` to the anchor's `href`
- Bluesky post URLs: `https://bsky.app/profile/{handle}/post/{rkey}`

**Tier 2 — Flat anchor scan (fallback):**
- If Tier 1 finds no matching anchor (or the matched anchor's href doesn't contain the expected pattern)
- Scans all `a[href]` inside the post node
- Applies the same regex to each anchor's `href`
- Returns first match

**Returns:** `{ postOwner, postID }` or `null`

---

## Survey Injection

```
postNode.parentNode  ← insertElement
  └─ div.survey-container-post#surveyFormContainer-{postID}  (inserted afterbegin)
       └─ shadow root
            └─ iframe[src="sandbox/survey.html"]
  └─ postNode  ← original feed item
```

`injectBlueskyPostSurvey(insertElement, postID)` inserts `afterbegin` of `insertElement` (the post's parent node).

Guard: skips if `getElementsByClassName('survey-container-post').length > 0` already.

---

## Data Capture

| Field | Source | Selector / Logic |
|-------|--------|-----------------|
| `body` | DOM | `SEL_BS.postText \|\| '[data-testid="postText"]'` — joins `innerText` blocks with `\n\n` |
| `media_urls` | DOM | Images: `SEL_BS.postImage \|\| 'img[data-testid*="image"], img[src*="feed_thumbnail"], img[src*="cdn.bsky.app"]'` (skips avatar/banner URLs). Videos: `SEL_BS.postVideo \|\| 'video'` (see video section) |
| `created_at` | DOM | `time[datetime]` → `datetime` attribute |
| `post_metrics` | DOM | See metrics section |

### Video Media Handling

Bluesky uses MSE (Media Source Extensions) with blob: URLs that cannot be directly downloaded. The flow:

1. `inject-api.js` intercepts fetch/XHR calls matching `video.bsky.app/watch/<did>/<cid>/...`
2. Extracts `did` (DID of the content author) and `cid` (CID of the video blob)
3. Tags currently-loading `video[src^="blob:"]` elements with `data-bsky-cid` and `data-bsky-did`
4. Dispatches `mh:bsky-video-found` → cached in `window.__socialAnnotate__.bskyInterceptedVideos[cid]`
5. At download time, `inject.js` finds `video[data-bsky-cid]` elements inside the post node
6. Reconstructs the CDN URL: `https://bsky.social/xrpc/com.atproto.sync.getBlob?did={did}&cid={cid}`
7. That URL is a direct HTTPS endpoint (no blob fetch needed) — background worker can download it

If the video has not been played/loaded yet, `extractPostMedia` returns `[Blob Stream] {src}` as a placeholder — the background knows not to attempt direct download.

### Metrics Extraction

| Metric | Default selector |
|--------|-----------------|
| `comment_count` | `SEL_BS.metricsReply \|\| '[data-testid="replyBtn"]'` |
| `share_count` | `SEL_BS.metricsRepost \|\| '[data-testid="repostBtn"]'` |
| `like_count` | `SEL_BS.metricsLike \|\| '[data-testid="likeBtn"], [data-testid="unlikeBtn"]'` |

Counts extracted from `aria-label` first (pattern `^(N)`), then `textContent`.

---

## Media Download Flow (`mh:download-request`)

1. Triggered by survey iframe `postMessage({ type: 'downloadMedia' })`
2. `injectNode` = container's closest post node or `parentNode`
3. Calls `extractPostMedia(injectNode)`
4. Separates results into: valid URLs / blob streams / thumbnails
5. **Valid URLs** (HTTPS images + reconstructed XRPC video URLs): sent directly to background
6. **Blob streams** (`[Blob Stream]` prefix): looks for `video[data-bsky-cid]` inside the post, reconstructs XRPC URL from `dataset.bskyDid` + `dataset.bskyCid` → sends to background
7. **Thumbnails only**: logs warning, nothing sent

---

## Selectors Reference

All selectors live in `selectors.json` under `bluesky.shared`, `bluesky.account`, or `bluesky.post`.

| Key | Default value | What it targets |
|-----|--------------|----------------|
| `appRoot` | `#root` | React SPA mount point |
| `postContainer` | `[data-testid*="feedItem"], [data-testid*="postThreadItem"]` | Individual post feed item or thread item |
| `postTimestamp` | `a[href*="/post/"]` | Anchor linking to the post's permalink (used for ID extraction) |
| `postText` | `[data-testid="postText"]` | Post body text container |
| `postImage` | `img[data-testid*="image"], img[src*="feed_thumbnail"], img[src*="cdn.bsky.app"]` | In-post images |
| `postVideo` | `video` | Video element |
| `metricsReply` | `[data-testid="replyBtn"]` | Reply count button |
| `metricsRepost` | `[data-testid="repostBtn"]` | Repost count button |
| `metricsLike` | `[data-testid="likeBtn"], [data-testid="unlikeBtn"]` | Like/unlike button |
| `userDisplayName` | `[data-testid="profileHeaderDisplayName"]` | Profile display name |
| `userHandle` | `[data-testid="profileHeaderHandle"]` | @handle element |
| `userAvatar` | `div[aria-label*="'s avatar"] img` | Profile picture |
| `userBanner` | `div[aria-label="View profile banner"] img` | Banner image |
| `userBio` | `[data-testid="profileHeaderDescription"]` | Bio text |
| `userFollowers` | `[data-testid="profileHeaderFollowersButton"]` | Followers count button |
| `userFollowing` | `[data-testid="profileHeaderFollowsButton"]` | Following count button |

---

## Platform-Specific Quirks

- **Bluesky post IDs** are AT Protocol record keys (`rkey`), not numeric IDs. They are alphanumeric strings like `3jwdwj2ctlk2x`. They appear as the last path segment of the post URL.
- **Video DID/CID**: `did` is the author's decentralized identifier (e.g., `did:plc:abc123`), `cid` is the content-addressed blob hash. Both are needed to reconstruct the XRPC download URL.
- **Quoted posts**: A Bluesky post can embed a quoted post. The quoted post's node also contains `a[href*="/post/"]` anchors. The Tier 2 anchor scan will find the outermost post's link first since it appears earlier in DOM order — this is generally correct but if the post node structure changes, verify that the first matched anchor belongs to the outer post, not the embed.
- **User profile URL**: `https://bsky.app/profile/{handle}` — handle can be a domain-based handle (e.g., `alice.bsky.social`) or a custom domain (e.g., `alice.com`).
- **Guided mode**: For post surveys, navigates to `https://bsky.app/profile/{firstTarget}` — note this is a profile URL, not a direct post URL (Bluesky guided mode targets profiles, not individual post rkeys).