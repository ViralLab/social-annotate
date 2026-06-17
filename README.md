# Social Annotate

> A Chrome browser extension that injects customizable annotation surveys directly into social media feeds — so researchers can label content in context, without leaving the platform.

Human-labeled data is at the core of computational social science and content moderation research. Social Annotate eliminates the friction of switching between a platform and a separate labeling tool: annotators see real posts in their native interface, answer a configurable survey inline, and their labels are stored locally and optionally sent to a research server in real time.

---

## A Visual Demo Is Worth a Thousand Words

[![Watch the demo](https://github.com/uluturki/twitter_annotate/blob/master/docs/img/youtube-thumbnail.png)](https://www.youtube.com/watch?v=rSJiVwJzM2k)

---

## Supported Platforms

| Platform | Posts | Accounts | Comments | Videos / Reels |
|---|:---:|:---:|:---:|:---:|
| <img src="src/images/x.png" width="16"> X / Twitter | ✅ | ✅ | | |
| <img src="src/images/tiktok.png" width="16"> TikTok | ✅ | ✅ | | ✅ |
| <img src="src/images/instagram.png" width="16"> Instagram | ✅ | ✅ | ✅ | ✅ |
| <img src="src/images/facebook.png" width="16"> Facebook | ✅ | ✅ | | |
| <img src="src/images/bluesky.png" width="16"> Bluesky | ✅ | ✅ | | |
| <img src="src/images/mastodon.png" width="16"> Mastodon | ✅ | ✅ | | |
| <img src="src/images/truthsocial.png" width="16"> Truth Social | ✅ | ✅ | | |
| <img src="src/images/linkedin.png" width="16"> LinkedIn | ✅ | ✅ | | |
| <img src="src/images/reddit.png" width="16"> Reddit | ✅ | ✅ | ✅ | |
| <img src="src/images/youtube.png" width="16"> YouTube | ✅ | ✅ | ✅ | ✅ |
| <img src="src/images/whatsapp.png" width="16"> WhatsApp Web | ✅ | | | |
| <img src="src/images/telegram.png" width="16"> Telegram Web | ✅ | ✅ | | |

---

## Key Features

- **In-feed surveys** — annotation forms appear directly alongside posts; no copy-pasting, no context switching.
- **Fully configurable questions** — build survey forms visually or write raw JSON. Supports radio buttons, sliders, text inputs, and checkboxes.
- **Per-survey informed consent** — write IRB consent text in Markdown per survey. When enabled, a full-screen consent overlay blocks annotation until the participant approves — and a timestamped consent record is automatically saved to disk for legal compliance.
- **Guided annotation mode** — upload a target list (post IDs or usernames); the extension navigates annotators through the list in order and tracks progress.
- **Media downloads** — optionally save post images, videos, profile pictures, and banners alongside labels, organized into a consistent folder structure.
- **JSONL export** — download all collected labels from the popup in one click, or stream them to an API endpoint on every submission.
- **Config import / export** — share a study configuration as a single JSON file across your team.
- **Light and dark themes** — both the extension UI and injected survey forms support user-toggleable themes.
- **Self-healing selectors** — an accompanying Python agent pipeline detects when platform DOM changes break injection and proposes updated CSS selectors automatically.

---

## Installation

Social Annotate is distributed as an unpacked Chrome extension (Chrome MV3).

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `src/` folder inside this repository.
5. The Social Annotate icon will appear in your Chrome toolbar.

> Reload the extension from `chrome://extensions` any time you change source files.

---

## Quick Start

1. Click the Social Annotate icon in the toolbar to open the **popup**.
2. Select an active survey from the dropdown (default: `x-post`).
3. Navigate to the corresponding platform — a survey form will appear next to each post.
4. Fill in the survey and click **Submit**. The annotation counter in the popup increments.
5. Click **Export** in the popup footer to download your labels as a `.jsonl` file.

---

## The Popup

<!-- 📸 Screenshot: popup overview -->

| Control | Description |
|---|---|
| **Active Survey** dropdown | Switches which survey type is active (e.g. `x-post`, `bluesky-user`). Only one survey is active at a time to prevent duplicate forms. |
| **Extension** toggle | Globally enables or disables injection without uninstalling. |
| **Guided Mode** toggle | Activates target-list navigation. The progress bar and Prev / Next controls appear. |
| **Download Media** toggle | (Post surveys) Saves post images and videos to disk on each submission. |
| **Download Profile Picture / Banner** toggles | (User surveys) Saves avatar and banner images on each submission. |
| **Export** button | Downloads all collected annotations for the active survey as a `.jsonl` file. |
| ⚙️ icon | Opens the Options page. |
| ☀️ / 🌙 icon | Toggles light/dark theme. |

---

## Options Page

Open the Options page via the ⚙️ button in the popup, or by right-clicking the extension icon and selecting *Options*.

### Global Settings

| Field | Description |
|---|---|
| **API Endpoint** | If set, every annotation submission is also POSTed to this URL as JSON (e.g. `http://127.0.0.1:5000/response`). |
| **Downloads Folder** | Replaces `SocialAnnotateExports/` as the root folder for all exports and media downloads. Leave blank to use the default. |

### Survey Cards

Each supported survey has its own card. Cards are collapsed by default; click the header to expand. Each card has three tabs:

#### Basic tab

| Field | Description |
|---|---|
| **Study ID** | An identifier for your study, written into consent records and annotation files (e.g. `hate_speech_2025`). |
| **Insert Location** | The HTML element name where the survey is injected (user surveys only; post surveys use a MutationObserver). |
| **Annotation List** | Target post IDs or usernames for guided mode. Accepts comma-separated values or a `.txt` / `.csv` file. |
| **Survey Theme** | `Light` or `Dark` — controls the visual style of the injected survey form. |

#### Consent tab

Toggle **Enable Consent Popup** to require participants to read and approve an informed consent statement before they can annotate on that platform.

The consent text is written in **Markdown** and rendered in a live side-by-side editor. Use `{platform}` as a placeholder for the platform name. A default IRB-style template is pre-filled.

When a participant clicks **Approve**:
1. Their consent is stored in the extension so the overlay does not reappear.
2. A JSON consent record is automatically downloaded to `{Downloads Folder}/consent_records/{platform}_{survey_type}_{unix_timestamp}.json`.

The consent record contains: timestamp (ISO 8601 + Unix), platform, survey type, study ID, anonymous client ID, the exact consent text the participant saw (Markdown + rendered HTML), user agent, and extension version. This is sufficient documentation for most IRB requirements.

#### Form tab

Configure the survey questions shown to annotators. Two editing modes:

- **⚡ Visual** — add, remove, and reorder fields using a drag-free builder. Supported field types: Radio Buttons, Range/Slider, Text Input, Checkbox.
- **{ } JSON** — edit the raw [jsonform](https://github.com/jsonform/jsonform) schema directly for full control.

Switching between modes syncs the state in both directions.

### Saving, Importing, and Exporting

| Button | Description |
|---|---|
| **💾 Save Changes** | Persists all options to `chrome.storage.local`. The page reloads on next visit reflecting saved values. |
| **↗ Export Config** | Downloads the full configuration as `config.json`. |
| **📂 Choose File + Import Config** | Load a previously exported `config.json` to restore or share a study setup. |
| **🔄 Factory Reset** | Erases all settings, annotations, and stored data. Requires confirmation. |

---

## Survey Form Schema

Forms are defined as [jsonform](https://github.com/jsonform/jsonform) schemas. Below is the default hate-speech example:

```json
{
  "schema": {
    "hatespeech": {
      "type": "string",
      "title": "Does this text contain hate speech?",
      "enum": ["Yes", "No"],
      "required": true
    }
  },
  "form": [
    { "key": "hatespeech", "type": "radiobuttons" },
    { "type": "submit", "title": "Submit", "htmlClass": "surveySubmitBtn" }
  ]
}
```

### Supported field types

| `type` in `form[]` | Description |
|---|---|
| `radiobuttons` | Horizontal button group, one selection |
| `range` | Numeric slider (uses `minimum` / `maximum` from schema) |
| `text` | Free-text input |
| `checkbox` | Boolean toggle |

---

## Export and Data Format

### JSONL annotations

Each annotation is one JSON object per line. Example record:

```json
{
  "surveyType": "x-post",
  "hatespeech": "No",
  "account_id": "elonmusk",
  "post_id": "1234567890",
  "survey_init_timestamp": 1748779200,
  "submission_timestamp": 1748779250,
  "clientID": "_lx3k1a-9f2zq"
}
```

`clientID` is a pseudo-unique anonymous identifier generated at install time and stable across sessions — useful for multi-annotator studies.

### Folder structure for media downloads

```
{Downloads Folder or SocialAnnotateExports}/
├── consent_records/
│   └── x_x-post_1748779200.json
├── x/
│   └── x-post/
│       └── media/
│           ├── pictures/
│           │   └── elonmusk_1234567890_1.jpg
│           └── videos/
│               └── elonmusk_1234567890_1.mp4
└── bluesky/
    └── bluesky-user/
        └── media/
            ├── profile_pictures/
            └── profile_banner/
```

### API endpoint

If an **API Endpoint** is configured, every submission also fires a POST request with the annotation JSON as the body (`Content-Type: application/json`). A minimal Flask receiver:

```python
from flask import Flask, request
app = Flask(__name__)

@app.route('/response', methods=['POST'])
def receive():
    print(request.json)
    return '', 200

app.run(port=5000)
```

---

## Guided Mode

Guided mode walks annotators through a pre-defined target list one item at a time.

1. In the **Annotation List** field of the target survey, enter post IDs or usernames (comma-separated or uploaded from a file).
2. Save options.
3. Enable **Guided Mode** in the popup.
4. The extension navigates to each target in order. The popup shows a progress bar and Prev / Next navigation.
5. After every submission the extension automatically advances to the next target.

---

## Extending to New Platforms

Each platform requires four additions:

| File | Purpose |
|---|---|
| `src/content-scripts/{platform}/inject.js` | Main content script: builds survey `Context` objects and injects `<div>` wrappers into the DOM using a `MutationObserver`. |
| `src/content-scripts/{platform}/inject.css` | Styles for the injected survey container. |
| `src/content-scripts/{platform}/inject-api.js` | (Optional) MAIN-world script for intercepting XHR/fetch to extract post metadata. |
| `src/config.js` | Add a new survey entry under `config.surveys` with `socialMediaPlatform`, `studyID`, `surveyFormSchema`, etc. |
| `src/manifest.json` | Add `host_permissions` and `content_scripts` entries for the new domain. |
| `src/selectors.json` | Add platform-specific CSS selectors used by `inject.js` and the health-check system. |

The `shared.js` `Context` class handles all the common logic: consent overlay, form rendering in a sandboxed iframe, submission routing, guided-mode advancement, and media download dispatch. Your `inject.js` only needs to call `context.renderSurvey(userID, postID)` at the right moment.

---

## Self-Healing Selector Agent

Social media platforms frequently change their HTML structure, which can silently break injection. The self-healing agent is a Python pipeline that detects broken CSS selectors and proposes replacements — automatically, using an LLM.

### How it works

The agent runs an 11-step pipeline:

1. Validates the HTML fixture offline (BeautifulSoup post count, missing asset warnings)
2. Sends the HTML to an LLM (Claude or Gemini) to extract new CSS selectors
3. Opens the fixture in a real Chromium instance with the extension loaded
4. Waits for injection and scrolls to trigger the `MutationObserver`
5. Takes a screenshot to visually confirm injection
6. Verifies injection by counting survey containers and shadow DOM iframes
7. Checks that survey forms are accessible inside the sandbox frames
8. Fills and submits the first available form option
9. Validates the submission (checks for the "Done!" button state)
10. Writes the proposed selectors to a temp JSON file (never touches `src/selectors.json` directly)
11. Presents a diff against the current selectors for review

### Prerequisites

```bash
pip install anthropic playwright beautifulsoup4
playwright install chromium
```

Set your API key in the environment:

```bash
export ANTHROPIC_API_KEY=sk-...   # Claude (checked first)
# or
export GEMINI_API_KEY=...         # Gemini (fallback)
```

### Usage

Point the agent at a saved HTML fixture of the target platform:

```bash
# Inspect proposed selectors without applying them
python run_healer.py --file test_fixtures/x_twitter/x.html

# Retry LLM extraction up to 5 times
python run_healer.py --file test_fixtures/x_twitter/x.html --retries 5

# Apply the proposed selectors to src/selectors.json automatically
python run_healer.py --file test_fixtures/x_twitter/x.html --apply

# Skip the browser step — LLM extraction only (fast, offline)
python run_healer.py --file test_fixtures/x_twitter/x.html --llm-only
```

Platform is auto-detected from the filename. Override with `--platform x` if needed.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser Tab (e.g. x.com)                               │
│                                                         │
│  inject.js + shared.js                                  │
│    └─ MutationObserver detects posts                    │
│    └─ Injects <div> shadow host per post                │
│    └─ Shadow DOM contains sandboxed <iframe>            │
│         └─ sandbox/survey.html + jsonform               │
│              Posts messages → inject.js via postMessage │
└───────────────────────┬─────────────────────────────────┘
                        │ chrome.runtime.sendMessage
┌───────────────────────▼─────────────────────────────────┐
│  background.js  (MV3 Service Worker)                    │
│    └─ Handles: downloadMedia, exportAnnotations,        │
│       saveConsentRecord, postApi                        │
│    └─ chrome.downloads.onDeterminingFilename            │
│       sets reliable subdirectory paths via #sa_fn= key  │
└─────────────────────────────────────────────────────────┘
                        │ chrome.storage.local
┌───────────────────────▼─────────────────────────────────┐
│  Popup  (popup.html / popup.js)                         │
│    └─ Survey selector, toggles, export, guided nav      │
│                                                         │
│  Options Page  (options.html / options.js)              │
│    └─ Global settings, per-survey config cards          │
│    └─ EasyMDE consent editor, visual form builder       │
└─────────────────────────────────────────────────────────┘
```

All persistent state lives in `chrome.storage.local`. The sandbox iframe is served from `sandbox/survey.html` and communicates with the parent content script exclusively via `postMessage` — it has no access to the page DOM or extension APIs.

---

## Cite

If you use Social Annotate in your research, please cite:

```bibtex
@article{najafi2026socialannotate,
  title   = {Social-Annotate: Self-Healing Browser Extension to Annotate and Collect Social Media Data},
  author  = {Najafi, Ali and Varol, Onur and Uluturk, Ismail},
  journal = {Journal of Open Source Software},
  volume  = {X},
  number  = {XX},
  pages   = {XXXX},
  year    = {2026}
}
```

---

## Team

- **Ali Najafi** — [najafi-ali.com](https://najafi-ali.com) · [@najafialiai](https://x.com/najafialiai)
- **Ismail Uluturk** — [uluturki.github.io](https://uluturki.github.io) · [@strictlynofun](https://x.com/strictlynofun)
- **Onur Varol** — [onurvarol.com](http://www.onurvarol.com) · [@onurvarol](https://x.com/onurvarol)

Issues and pull requests are welcome. For questions, reach out via the public profiles above.

---

## License

GPL-3.0 — see [LICENSE](LICENSE).
