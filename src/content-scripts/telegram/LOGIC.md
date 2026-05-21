# Telegram Web — Injection & Data Capture Logic

## Two-World Architecture

| File | World | Purpose |
|------|-------|---------|
| `inject-api.js` | MAIN | Intercepts `HTMLMediaElement.prototype.src` setter and `HTMLVideoElement.prototype.play` to capture video src URLs; provides Range-chunked HTTP fetcher |
| `inject.js` | Isolated (content script) | Detects messages, injects survey forms, captures data |

Communication via `window` events:
- `mh:tg-video-src` — video src captured by MAIN world (includes `msgId` when identifiable)
- `mh:fetch-tg-video` / `mh:fetch-tg-video-result` — delegate video fetch to MAIN world

---

## Initialization Flow

1. `initializeSurveys()` fires on script load
2. Reads `selectors`, `config`, `isEnabled` from `chrome.storage.local`
3. Flattens `selectors.telegram.shared + selectors.telegram.account + selectors.telegram.post` → `SEL_TG`
4. Calls `checkSelectorHealth('telegram', SEL_TG, activeSurveys)`
5. Sets `tgMessagesRoot = document.querySelector(SEL_TG.conversationMessages || '.MessageList .messages-container') || document.body`
6. Creates `MutationObserver` (`tgObserver`)
7. For each active context, configures and calls `enableTelegramObserver()`

`inject.js` also listens for `mh:tg-video-src` events from MAIN world at module level, storing them in `_tgMsgVideoSrcMap` (a `Map<msgId, { src, timestamp }>`), including a special `__latest__` key for the most recently seen video src.

---

## Post Detection

**Observer root:** `tgMessagesRoot` (`.MessageList .messages-container` or `document.body` fallback)

**Observer config:** `SEL_TG.observerFilter || { attributes: false, childList: true, subtree: true }`

**Post selector:** `SEL_TG.postContainer || '.Message'`

The observer checks both direct matches (`.matches`) and nested descendants (`querySelectorAll`).

**1.5s delayed rescan** in `enableTelegramObserver`.

---

## Post ID Extraction

Post ID comes from the DOM node's **attribute** — not from URLs.

**Only source:** `messageNode.getAttribute('data-message-id')`

Returns `null` if the attribute is missing — the node is skipped.

No fallback tiers. Telegram's message nodes always carry `data-message-id` when they represent real messages.

---

## Survey Injection

```
div.survey-container-post#surveyFormContainer-{postID}  (inserted beforebegin of messageNode)
  └─ shadow root
       └─ iframe[src="sandbox/survey.html"]
[data-message-id="{postID}"]  ← messageNode
```

Same as WhatsApp: the survey is inserted **before** the message node. The download handler retrieves `messageNode = surveyContainer.nextElementSibling`.

---

## Author & Timestamp Extraction

**Author (`userID`):**
1. `SEL_TG.userDisplayName || '.fullName'` inside the message node
2. Fallback: `.MiddleHeader .fullName, .ChatInfo .fullName, .Header .fullName` — the channel/group name from the page header (used when the message node has no sender label, e.g. channel posts)
3. Final fallback: `'User'`

**Timestamp (`postAuthorTime`):**
- `SEL_TG.postTimestamp || '.message-time'` → `innerText`

---

## Data Capture

| Field | Source | Selector / Logic |
|-------|--------|-----------------|
| `body` | DOM | `SEL_TG.postText \|\| '.text-content'` — joins all `textContent` blocks with `\n` |
| `media_urls` | DOM + interceptor cache | See media section |
| `created_at` | DOM | `.message-time` innerText (time only, no date) |
| `post_metrics` | DOM (SEL_TG only) | `metricsViews`, `metricsRepost`, `metricsLike` — all null if not configured |

### Image Extraction (`extractMessageImages`)

Selector: `SEL_TG.postImage || 'img.media-photo, img.full-media, canvas.thumbnail.shown'`

- `<img>` elements: uses `src` attribute, skips `data:` URLs
- `<canvas>` elements: calls `canvas.toDataURL('image/png')` — Telegram renders some thumbnails on canvas; skips results shorter than 1000 chars or that look like HTML error pages

### Video Resolution (`resolveVideoSrcForMessage`)

Five-level priority chain (highest confidence first):

1. **Live DOM `<video>` element** — `currentSrc || src` from `SEL_TG.postVideo || 'video.full-media, video'`; most reliable
2. **`<source>` child** inside a `<video>` element
3. **Per-message interceptor cache** — `_tgMsgVideoSrcMap.get(msgId)` from `mh:tg-video-src` events; rejected if older than 30 minutes
4. **`__latest__` global fallback** — last video src seen from any message; rejected if older than 5 minutes
5. Returns `null` if all levels fail

---

## Media Download Flow (`mh:download-request`)

1. Triggered by survey iframe `postMessage({ type: 'downloadMedia' })`
2. Finds `messageNode = surveyContainer.nextElementSibling`
3. Calls `extractMessageImages(messageNode)` → image data URLs / HTTPS URLs
4. Calls `resolveVideoSrcForMessage(messageNode)` → video src or null
5. **Video routing:**
   - Already a `data:` URL (not text/HTML): use directly
   - External HTTPS CDN URL not on `web.telegram.org`: send to background directly
   - `web.telegram.org/a/progressive/`, `blob:`, or any other: **delegate to MAIN world**
6. MAIN-world fetch (`mh:fetch-tg-video`): performs Range-chunked HTTP fetch **through the Service Worker** (see below)
7. Assembles `[...imageUrls, videoDataUrl]` → `chrome.runtime.sendMessage`

### Why Video Needs MAIN-World Range Fetch

Telegram Web A serves videos via its **Service Worker** at `/a/progressive/...` paths. These URLs resolve to streaming media only when fetched from the **same page context** (the SW intercepts the request). A fetch from an isolated-world content script bypasses the SW entirely, returning 404. The MAIN-world script runs in the page's JS context, so its `fetch()` calls go through the SW correctly.

The fetch uses HTTP `Range: bytes=N-` headers to read the file in chunks (as Telegram's SW delivers it), concatenating all chunks into a single `Blob`, then converting to data URL.

**30-second timeout** on the MAIN-world fetch promise.

---

## MAIN-World Interceptor Details (`inject-api.js`)

### `HTMLMediaElement.prototype.src` Setter Patch
- Intercepts every `.src = value` assignment on any media element
- Identifies the nearest `.Message` ancestor via `closest('.Message, .message, [data-message-id], [data-mid]')`
- Stores in `window.__tgMediaSrcMap` (Map) keyed by `data-message-id`
- Dispatches `mh:tg-video-src` with `{ src, msgId }`

### Click Tracker
- Listens for `click` events (capture phase)
- Stores the clicked `.Message` element in `_pendingMsgEl`
- Used as a hint when the `src` setter fires without a clear DOM ancestor (e.g., off-DOM video elements)

### `HTMLVideoElement.prototype.play` Patch
- After `play()`, reads `currentSrc || src` from the video element
- Dispatches `mh:tg-video-src` — catches cases where `src` is set before `play()` is called

---

## Selectors Reference

All selectors live in `selectors.json` under `telegram.shared`, `telegram.account`, or `telegram.post`.

| Key | Default value | What it targets |
|-----|--------------|----------------|
| `conversationMessages` | `.MessageList .messages-container` | Scrollable message list — observer root |
| `postContainer` | `.Message` | Individual message node |
| `postText` | `.text-content` | Message text content element |
| `postImage` | `img.media-photo, img.full-media, canvas.thumbnail.shown` | Message photo/canvas elements |
| `postVideo` | `video.full-media, video` | Video element inside a message |
| `postTimestamp` | `.message-time` | Time label inside a message |
| `userDisplayName` | `.fullName` | Sender name inside a message |
| `metricsViews` | *(none — null if absent)* | View count element (channel posts) |
| `metricsRepost` | *(none)* | Forward/repost count |
| `metricsLike` | *(none)* | Reaction count |

---

## Platform-Specific Quirks

- **Telegram Web versions**: There are two official web clients — Telegram Web A (`web.telegram.org/a/`) and Telegram Web K (`web.telegram.org/k/`). The selectors above target Web A. Web K uses different class names (e.g., `.message` instead of `.Message`). If the platform switches clients or adds a new web version, selectors need updating.
- **Channel vs group posts**: In channels, messages have no per-message sender name — the channel name from the header is used. In groups, each message bubble has its own sender label.
- **Off-DOM video elements**: Telegram creates `<video>` elements off-DOM (not attached to the document) and sets their `src` programmatically before inserting them. A DOM query (`querySelectorAll('video')`) won't find these, which is why the `src` setter interceptor in inject-api.js is necessary.
- **Canvas thumbnails**: Before a photo fully loads, Telegram renders a blurred thumbnail on a `<canvas>` element. `canvas.toDataURL()` captures this; the full-resolution image may load later. If capturing at form-render time, the canvas may be the only available representation.
- **`data-message-id` is the only reliable ID**: Unlike web platforms, there are no URL-based post IDs. If Telegram changes the attribute name (e.g., to `data-mid` in Web K), update `postContainer` and `extractMessageDetails`.
- **Service Worker Range fetch**: The Range-chunk fetch in inject-api.js loops until `totalSize` is satisfied. If a chunk's `Content-Range` header is missing (non-206 response), it reads the full response and breaks. This handles both chunked and non-chunked responses.
- **Extension context invalidation**: inject.js guards several paths with `isExtensionContextValid()` and auto-reloads the tab if the context is invalidated mid-session — this is Telegram-specific because users often keep the tab open for days.