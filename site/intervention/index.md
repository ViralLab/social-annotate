# Intervention

Social Annotate can replace post content before participants see it — a technique used in randomized controlled experiments, framing studies, and content moderation research. The extension rewrites text (and optionally images) in-feed, keeping participants on the platform while exposing them to researcher-controlled stimuli.

---

## Modes

| Mode | Behavior |
|---|---|
| **Blind** | Participants see only the rewritten version. The original is never exposed. |
| **Aware** | A "Show original" toggle appears on each post so participants can compare the rewritten and original content. |

Select the mode in the **Manipulation** tab of any survey card in the Options page.

---

## Post Intervention

Posts are rewritten as they appear in the feed. Two sources are available: a pre-built static map or a live researcher-controlled server.

### Static Map

Load a JSON mapping file generated offline (e.g. by an LLM pipeline) before the study begins. The extension looks up each post ID as it appears and swaps the text in place.

**File format:**

```json
{
  "_meta": {
    "map_id": "condition-a",
    "prompt_label": "high-framing",
    "model": "claude-haiku-4-5",
    "total": 120,
    "succeeded": 118,
    "failed": 2
  },
  "2061186561002127617": {
    "rewritten_text": "Replacement text shown to the participant.",
    "original_text": "Original post text — stored in annotation for audit.",
    "prompt_label": "high-framing",
    "model": "claude-haiku-4-5",
    "timestamp": 1750000000
  },
  "1984123456789012345": {
    "rewritten_text": "Another replacement."
  }
}
```

**Per-entry fields (keyed by post ID):**

| Field | Required | Description |
|---|---|---|
| `rewritten_text` | **Yes** | Text shown to the participant in place of the original. |
| `original_text` | No | Original text — stored in the annotation record for traceability. |
| `replacement_image` | No | Replaces the post's first image. Accepts a `data:` URI. |
| `prompt_label` | No | Condition label (e.g. `"high-framing"`) stored in the annotation. |
| `model` | No | How the rewrite was produced (e.g. `"manual"`, `"claude-haiku-4-5"`). |
| `timestamp` | No | Unix timestamp of when the entry was generated. |

**`_meta` block (optional — skipped during lookup):**

| Field | Description |
|---|---|
| `map_id` | Identifier for this map — appears in annotations for cross-referencing. |
| `prompt_label` | Default condition label for the whole map. |
| `model` | LLM or method used to produce the map. |
| `total` / `succeeded` / `failed` | Counts from batch generation (informational only). |

**Post ID format by platform:**

| Platform | Post ID |
|---|---|
| X / Twitter | Numeric tweet ID (e.g. `"2061186561002127617"`) |
| Bluesky | AT-URI record key (e.g. `"3lp6vkgdu4s2x"`) |
| Facebook | Numeric post ID |
| Instagram | Shortcode (e.g. `"DYsGBvnjGBA"`) |
| Mastodon | Numeric status ID |
| Reddit | Full post ID with prefix (e.g. `"t3_abc123"`) |
| Telegram | Message ID |
| WhatsApp | Message timestamp key |

---

### Live Server

Point the extension at a researcher-controlled endpoint. As posts appear in the feed the extension batches them into POST requests and applies rewrites from the server response in real time.

**Request** (sent by the extension):

```json
{
  "survey_type": "x-post",
  "platform": "x",
  "posts": [
    { "post_id": "2061186561002127617", "text": "Original text…", "author": "@handle" },
    { "post_id": "1984123456789012345", "text": "Another post…",  "author": "@other"  }
  ]
}
```

Up to 20 posts are batched per request. Requests are debounced by 300 ms so rapidly-loading feeds don't generate excessive calls.

**Response** (expected from the server):

```json
{
  "results": {
    "2061186561002127617": {
      "rewritten_text": "Replacement text shown to the participant.",
      "original_text":  "Original text…",
      "prompt_label":   "condition-B",
      "model":          "gpt-4o"
    }
  }
}
```

Posts absent from `results` are left unmodified. The extension retries failed requests up to **2 times** with an 800 ms backoff, and aborts after a **10 s timeout**.

**Minimal Flask server:**

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

REWRITES = {
    "2061186561002127617": "This is the rewritten version.",
}

@app.route('/intervene', methods=['POST'])
def intervene():
    data = request.json
    results = {}
    for post in data.get('posts', []):
        pid = post['post_id']
        if pid in REWRITES:
            results[pid] = {"rewritten_text": REWRITES[pid]}
    return jsonify({"results": results})

app.run(port=5001)
```

Configure `http://127.0.0.1:5001/intervene` as the intervention endpoint in the Options page Manipulation tab.

---

## User / Profile Intervention

When a user-profile survey is active, the extension can also rewrite account-level fields (display name, bio, follower count) via a dedicated endpoint.

**Request** (sent by the extension when a profile page is loaded):

```json
{
  "survey_type": "x-user",
  "platform": "x",
  "account_id": "@handle",
  "profile_name": "Display Name",
  "followers": "12,345",
  "bio": "Profile bio text."
}
```

**Response:** same `{ results: { account_id: { ... } } }` structure as post intervention. Field names in the result object correspond to the profile fields to overwrite.

Set the endpoint in the **User Intervention** section of the survey card's Manipulation tab.
