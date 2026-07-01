# Configuration

Open the Options page via the **⚙️** button in the popup, or by right-clicking the extension icon and selecting *Options*.

## Options Page

### Global Settings

| Field | Description |
|---|---|
| **API Endpoint** | If set, every annotation submission is also POSTed to this URL as JSON (e.g. `http://127.0.0.1:5000/response`). |
| **Downloads Folder** | Replaces `SocialAnnotateExports/` as the root folder for all exports and media downloads. Leave blank to use the default. |

### Survey Cards

Each supported survey has its own card on the Options page. Cards are collapsed by default; click the header to expand. Each card has three tabs: **Basic**, **Consent**, and **Form**.

#### Basic tab

| Field | Description |
|---|---|
| **Study ID** | An identifier written into consent records and annotation files (e.g. `hate_speech_2025`). |
| **Insert Location** | The HTML element where the survey is injected (user surveys only). |
| **Annotation List** | Target post IDs or usernames for guided mode. Accepts comma-separated values or a `.txt`/`.csv` file. |
| **Survey Theme** | `Light` or `Dark` — controls the visual style of the injected survey form. |

#### Consent tab

Toggle **Enable Consent Popup** to require participants to read and approve an informed consent statement before they can annotate on that platform.

The consent text is written in **Markdown** and rendered in a live side-by-side editor. Use `{platform}` as a placeholder for the platform name. A default IRB-style template is pre-filled.

#### Form tab

Configure the survey questions shown to annotators. Two editing modes:

- **⚡ Visual** — add, remove, and reorder fields using a builder UI. Supported types: Radio Buttons, Range/Slider, Text Input, Checkbox.
- **{ } JSON** — edit the raw [jsonform](https://github.com/jsonform/jsonform) schema directly.

Switching between modes syncs state in both directions.

### Saving, Importing, and Exporting

| Button | Description |
|---|---|
| **💾 Save Changes** | Persists all options to `chrome.storage.local`. |
| **↗ Export Config** | Downloads the full configuration as `config.json`. |
| **📂 Import Config** | Load a previously exported `config.json` to restore or share a study setup. |
| **🔄 Factory Reset** | Erases all settings, annotations, and stored data. Requires confirmation. |

---

## Survey Form Schema

Forms are defined as [jsonform](https://github.com/jsonform/jsonform) schemas. Below is an example hate-speech survey:

```json
{
  "schema": {
    "hatespeech": {
      "type": "string",
      "title": "Does this text contain hate speech?",
      "enum": ["Yes", "No", "Unsure"]
    },
    "severity": {
      "type": "number",
      "title": "Severity (1–5)",
      "minimum": 1,
      "maximum": 5
    },
    "notes": {
      "type": "string",
      "title": "Notes"
    }
  },
  "form": [
    { "key": "hatespeech", "type": "radios" },
    { "key": "severity",   "type": "range" },
    { "key": "notes",      "type": "textarea" },
    { "type": "submit", "title": "Submit" }
  ]
}
```

Validate your schema using the [jsonform playground](https://jsonform.github.io/jsonform/playground/index.html).

---

## Informed Consent

When consent is enabled, a full-screen overlay blocks annotation until the participant approves. On approval:

1. Consent is stored in the extension so the overlay does not reappear.
2. A JSON consent record is automatically downloaded to:
   ```
   {Downloads Folder}/consent_records/{platform}_{survey_type}_{unix_timestamp}.json
   ```

The consent record contains: timestamp (ISO 8601 + Unix), platform, survey type, study ID, anonymous client ID, the exact consent text the participant saw (Markdown + rendered HTML), user agent, and extension version.

---

## Guided Mode

Guided mode walks annotators through a pre-defined target list one item at a time.

1. In the **Annotation List** field, enter post IDs or usernames (comma-separated or uploaded from a file).
2. Save options.
3. Enable **Guided Mode** in the popup.
4. The extension navigates to each target in order. The popup shows a progress bar and Prev/Next navigation.
5. After every submission the extension automatically advances to the next target.

---

## Data Export

Every annotation is stored in `chrome.storage.local` and exported as **JSONL** (one JSON object per line).

A typical annotation record looks like:

```json
{
  "platform": "x",
  "survey_type": "x-post",
  "study_id": "hate_speech_2025",
  "clientID": "_lx3k1a-9f2zq",
  "post_id": "1234567890",
  "survey_init_timestamp": 1748779200,
  "submission_timestamp": 1748779250,
  "hatespeech": "No",
  "severity": 1
}
```

`clientID` is a pseudo-unique anonymous identifier generated at install time and stable across sessions.

### Media download folder structure

```
SocialAnnotateExports/
├── consent_records/
│   └── x_x-post_1748779200.json
├── x/
│   └── x-post/
│       └── media/
│           ├── pictures/
│           └── videos/
└── bluesky/
    └── bluesky-user/
        └── media/
            ├── profile_pictures/
            └── profile_banner/
```

---

## API Endpoint

If an **API Endpoint** is configured, every submission fires a POST request with the annotation JSON as the body (`Content-Type: application/json`). Any HTTP server can receive these — Flask, FastAPI, Express, a cloud function, or any endpoint that accepts JSON POST requests.

The repository ships a ready-to-use collector at `flask-collect/main.py` that appends every submission to a `responses.jsonl` file:

```bash
pip install flask flask-cors
python flask-collect/main.py
```

Set `http://127.0.0.1:5050/response` as the **API Endpoint** in Global Settings. The server just needs to return any `2xx` response — the extension does not read the body.

This is also the recommended approach for **multi-annotator studies**. Deploy the server on a shared machine or cloud instance and give all annotators its public URL (e.g. `http://192.168.1.10:5050/response`). Each annotator's extension posts independently — all responses land in the same `responses.jsonl` on the server, tagged with a per-device `clientID` so you can separate them later. The `clientID` is generated once at extension install time (base-36 timestamp + random suffix, e.g. `_lx3k1a-9f2zq`) and never changes, so it reliably identifies a single annotator across sessions.
