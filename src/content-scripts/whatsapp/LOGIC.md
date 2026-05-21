# WhatsApp Web — Injection & Data Capture Logic

## Two-World Architecture

| File | World | Purpose |
|------|-------|---------|
| `inject-api.js` | MAIN | Patches `URL.createObjectURL` to capture all video blob URLs WhatsApp generates; provides blob fetcher |
| `inject.js` | Isolated (content script) | Detects messages, injects survey forms, captures data |

Communication via custom `window` events (not `document` events — WhatsApp uses shadow DOMs extensively):
- `mh:wa-video-blob-created` — new video blob URL created
- `mh:get-wa-video-blobs` / `mh:get-wa-video-blobs-result` — query all known blob URLs on load
- `mh:fetch-wa-blob` / `mh:fetch-wa-blob-result` — delegate blob fetch to MAIN world

---

## Initialization Flow

1. On script load, `inject.js` immediately:
   - Queries existing video blob URLs via `mh:get-wa-video-blobs` (for blobs created before script load)
   - Starts `videoModalObserver` on `document.documentElement` to capture blob URLs added to the DOM
   - Listens for `mh:wa-video-blob-created` events from MAIN world
2. `initializeSurveys()` fires on script load
3. Reads `selectors`, `config`, `isEnabled` from `chrome.storage.local`
4. Flattens `selectors.whatsapp.shared + selectors.whatsapp.account + selectors.whatsapp.post` → `SEL_WA`
5. Calls `checkSelectorHealth('whatsapp', SEL_WA, activeSurveys)`
6. Sets `waMessagesRoot = document.querySelector(SEL_WA.conversationMessages || "[data-testid='conversation-panel-messages']") || document.body`
7. Creates `MutationObserver` (`waObserver`)
8. For each active context, configures and calls `enableWhatsAppObserver()`

---

## Post Detection

**Observer root:** `waMessagesRoot` (`[data-testid='conversation-panel-messages']` or `document.body` fallback)

**Observer config:** `SEL_WA.observerFilter || { attributes: false, childList: true, subtree: true }`

**Post selector:** `SEL_WA.postContainer || "[data-testid^='conv-msg-']"`

The observer checks both direct matches and nested descendants for the post selector.

**1.5s delayed rescan** in `enableWhatsAppObserver`.

---

## Post ID Extraction

Post ID comes from the DOM node's **attributes** — not from URLs.

**Primary:** `messageNode.getAttribute('data-testid')` — format: `conv-msg-{id}` → strip prefix to get `postID`

**Fallback:** `messageNode.getAttribute('data-id')`

**Returns:** `null` if neither attribute is present.

No anchor-scan fallback is used here because WhatsApp message IDs are not URL-based.

---

## Survey Injection

```
div.survey-container-post#surveyFormContainer-{postID}  (inserted beforebegin of messageNode)
  └─ shadow root
       └─ iframe[src="sandbox/survey.html"]
[data-testid^='conv-msg-{id}']  ← messageNode
```

Unlike other platforms, the survey is inserted **before** the message node (not inside it or at its top). This means the form appears **above** the message in the chat.

`messageNode.insertAdjacentElement('beforebegin', surveyContainer)`

The download handler retrieves `messageNode` as `surveyContainer.nextElementSibling` (the element right after the form).

---

## Author & Timestamp Extraction

**Author (`userID`):**
1. `data-pre-plain-text` attribute on `.copyable-text` element — format: `[time, date] Author:` — regex `/\]\s([^:]+):\s*$/` extracts author name
2. Fallback: `span[aria-label$=":"]` — sender name label, strip trailing colon

**Timestamp (`postAuthorTime`):**
1. `data-pre-plain-text` attribute — extracts `[Time, Date]` string with regex `/\[(.*?)\]/`
2. Fallback: `SEL_WA.postTimestamp || '[data-testid="msg-meta"] span[dir="auto"]'` → `innerText`

---

## Data Capture

| Field | Source | Selector / Logic |
|-------|--------|-----------------|
| `body` | DOM | `SEL_WA.postText \|\| "[data-testid='selectable-text']"` — joins all matching `textContent` blocks with `\n` |
| `media_urls` | DOM + blob cache | See media section |
| `created_at` | DOM attribute | From `data-pre-plain-text` or `[data-testid="msg-meta"] span` |
| `post_metrics` | DOM (SEL_WA only) | `SEL_WA.metricsLike` only; all other metrics null |
| `account_id` | DOM attribute | From `data-pre-plain-text` or `aria-label` |

### Media Extraction

`extractMessageMedia(messageNode)`:

**Images:**
- Selector: `SEL_WA.postImage || 'img[src]'`
- Skips `data:` URLs (icons/inline SVGs)

**Videos:**
- Selector: `SEL_WA.postVideo || 'video, video source, [data-testid="video-content"] [style*="background-image"], [data-testid="msg-video"] [style*="background-image"]'`
- Extracts `.src` attribute or `background-image: url(...)` from style
- Skips `data:` URLs shorter than 1000 chars (small icons)
- Sets `isVideoPost = true` if any video-like element is found

**Video blob attachment:**
- If `isVideoPost && recentVideoUrls.size > 0`: appends all recently-seen blob URLs to `mediaUrls`
- Clears `recentVideoUrls` after consuming (to prevent bleeding into subsequent posts)
- `recentVideoUrls` is populated from: MAIN-world `mh:wa-video-blob-created` events, DOM `videoModalObserver` (catches blob URLs added to `<video>` elements), and initial query via `mh:get-wa-video-blobs`

---

## Media Download Flow (`mh:download-request`)

1. Triggered by survey iframe `postMessage({ type: 'downloadMedia' })`
2. Finds `messageNode = surveyContainer.nextElementSibling`
3. Calls `extractMessageMedia(messageNode)` → list of URLs (may include `blob:` URLs)
4. For each URL:
   - **Non-blob:** kept as-is
   - **`blob:` URL:** calls `fetchBlobFromMainWorld(url)` → sends `mh:fetch-wa-blob` event to MAIN world → receives data URL back (15s timeout)
5. All resolved URLs sent to background via `chrome.runtime.sendMessage`

### Why blob: URLs Need MAIN-World Delegation

Chrome extensions in isolated worlds **cannot fetch blob: URLs created by the page** (cross-origin restriction). The MAIN-world `inject-api.js` can fetch them directly (same origin as the page). The fetch returns a `Blob`, which is then read as a data URL via `FileReader` and sent back via `mh:fetch-wa-blob-result`.

---

## Selectors Reference

All selectors live in `selectors.json` under `whatsapp.shared`, `whatsapp.account`, or `whatsapp.post`.

| Key | Default value | What it targets |
|-----|--------------|----------------|
| `conversationMessages` | `[data-testid='conversation-panel-messages']` | Scrollable message list — observer root |
| `postContainer` | `[data-testid^='conv-msg-']` | Individual message bubble |
| `messageContainer` | `[data-testid='msg-container']` | Inner content of a message (used to skip empty/structural nodes) |
| `copyableText` | `.copyable-text[data-pre-plain-text]` | Element holding author + timestamp in `data-pre-plain-text` attribute |
| `postTimestamp` | `[data-testid="msg-meta"] span[dir="auto"]` | Fallback timestamp element |
| `postText` | `[data-testid='selectable-text']` | Message text content |
| `postImage` | `img[src]` | Message images |
| `postVideo` | `video, video source, [data-testid="video-content"] [style*="background-image"], [data-testid="msg-video"] [style*="background-image"]` | Message video elements and thumbnails |
| `metricsLike` | *(none)* | Reaction/emoji count element |

---

## Platform-Specific Quirks

- **WhatsApp opens videos in a fullscreen modal** which removes the `<video>` tag from the original message node. The `recentVideoUrls` set bridges this gap: blob URLs are captured when the video loads (even in the modal), then attached to the next video post that triggers a download.
- **`recentVideoUrls` is consumed on use** — cleared after attaching to a post. If the user downloads two video posts back-to-back, the second download will get an empty set. The user should play each video before downloading.
- **`data-pre-plain-text` format**: `[HH:MM AM/PM, DD/MM/YYYY] AuthorName: ` — the exact format depends on the user's locale. The timestamp regex `/\[(.*?)\]/` captures everything inside the first brackets; the author regex `/\]\s([^:]+):\s*$/` captures everything between `] ` and the trailing `: `.
- **`msg-container` guard**: `processMessageNode` checks for `[data-testid='msg-container']` inside the node before processing. This skips system/structural nodes that match the `conv-msg-*` pattern but contain no actual message content.
- **No URL-based post IDs**: WhatsApp Web has no URLs for individual messages. Post IDs come from DOM attributes only.