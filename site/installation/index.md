# Installation

Social Annotate is distributed as an unpacked Chrome extension (Manifest V3). No Chrome Web Store listing is required.

## Download

<a href="https://github.com/ViralLab/social-annotate/releases/latest" target="_blank" style="display:inline-block;padding:10px 24px;background:#646cff;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">⬇ Download Latest Release</a>

Download the ZIP from the [Releases page](https://github.com/ViralLab/social-annotate/releases/latest), unzip it, then follow the steps below.

## Load the Extension

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the **`src/`** folder from the unzipped download.
5. The Social Annotate icon will appear in your Chrome toolbar.

## Getting Started (from source)

**Requirements:** Google Chrome (or any Chromium-based browser).

Clone the repository if you prefer to work from source:

```bash
git clone https://github.com/ViralLab/social-annotate.git
cd social-annotate
```

Then follow the Load the Extension steps above, pointing at the `src/` folder in the repo.

> Reload the extension from `chrome://extensions` any time you change source files.

## Quick Start

1. Click the **Social Annotate icon** in the toolbar to open the popup.
2. Select an active survey from the dropdown (default: `x-post`).
3. Navigate to the corresponding platform — a survey form will appear next to each post.
4. Fill in the survey and click **Submit**. The annotation counter in the popup increments.
5. Click **Export** in the popup footer to download your labels as a `.jsonl` file.

## The Popup

| Control | Description |
|---|---|
| **Active Survey** dropdown | Switches which survey type is active (e.g. `x-post`, `bluesky-user`). Only one survey is active at a time. |
| **Extension** toggle | Globally enables or disables injection without uninstalling. |
| **Guided Mode** toggle | Activates target-list navigation. Progress bar and Prev/Next controls appear. |
| **Download Media** toggle | (Post surveys) Saves post images and videos to disk on each submission. |
| **Download Profile Picture / Banner** | (User surveys) Saves avatar and banner images on each submission. |
| **Export** button | Downloads all collected annotations as a `.jsonl` file. |
| ⚙️ icon | Opens the Options page. |
| ☀️ / 🌙 icon | Toggles light/dark theme. |
