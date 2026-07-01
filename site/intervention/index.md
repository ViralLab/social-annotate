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

Posts are rewritten as they appear in the feed. Two sources are available: a live researcher-controlled server or a pre-built static map.

---

### Live Server

Point the extension at a researcher-controlled endpoint. As posts appear in the feed the extension batches them into POST requests and applies rewrites from the server response in real time.

Configure `http://127.0.0.1:5001/intervene` as the intervention endpoint in the **Manipulation** tab of the Options page.

#### Running the server

The repository ships a ready-to-use Flask server at `server/intervention_server.py`:

```bash
uv run server/intervention_server.py
# or
python server/intervention_server.py
```

Optional flags:

```bash
python server/intervention_server.py --port 5001 --host 0.0.0.0 --no-debug
```

#### Implementing intervention logic

Subclass `InterventionHandler` and override `process_post()`. Drop your file in `server/handlers/` and wire it in at the bottom of `intervention_server.py`.

```python
from intervention_server import InterventionHandler, InterventionServer

class MyHandler(InterventionHandler):
    def process_post(self, post: dict) -> dict:
        # post keys: post_id, account_id, body, created_at, media_urls, post_metrics
        rewritten = post["body"].upper()   # your logic here
        return {
            "rewritten_text": rewritten,
            "prompt_label": "my-condition",   # stored in annotation output
        }

if __name__ == "__main__":
    InterventionServer(MyHandler()).run()
```

`process_post()` receives one post at a time. If you need batch-level logic (e.g. a single LLM batch API call), override `process_batch()` instead — it receives the full list and must return a `{ post_id: result }` dict.

#### Included example handlers

| Handler | File | What it does |
|---|---|---|
| `LoremIpsumHandler` | `handlers/lorem_ipsum.py` | Replaces post text with Lorem Ipsum of the same character length |
| `HashtagRemovalHandler` | `handlers/hashtag_removal.py` | Strips all hashtags from post text (`keep_text=True` keeps the word without `#`) |
| `PassthroughHandler` | `intervention_server.py` | Returns posts unchanged — useful as a control condition |

**LoremIpsumHandler:**

```python
from handlers.lorem_ipsum import LoremIpsumHandler
InterventionServer(LoremIpsumHandler(match_length=True, prompt_label="lorem")).run()
```

**HashtagRemovalHandler:**

```python
from handlers.hashtag_removal import HashtagRemovalHandler
InterventionServer(HashtagRemovalHandler(keep_text=False)).run()
```

#### Request / Response format

**Request** (sent by the extension):

```json
{
  "survey_type": "x-post",
  "platform": "x",
  "posts": [
    { "post_id": "2061186561002127617", "body": "Original text…", "account_id": "@handle" },
    { "post_id": "1984123456789012345", "body": "Another post…",  "account_id": "@other"  }
  ]
}
```

Up to 20 posts are batched per request. Requests are debounced by 300 ms.

**Response** (expected from the server):

```json
{
  "results": {
    "2061186561002127617": {
      "rewritten_text": "Replacement text shown to the participant.",
      "original_text":  "Original text…",
      "prompt_label":   "condition-B"
    }
  }
}
```

Posts absent from `results` are left unmodified. The extension retries failed requests up to **2 times** with an 800 ms backoff and aborts after a **10 s timeout**.

#### User / Profile Intervention

When a user-profile survey is active, the extension can also rewrite account-level fields (display name, bio, follower count) via a dedicated endpoint at `/user-intervene`.

Subclass `UserInterventionHandler` and pass it as `user_handler` to `InterventionServer`:

```python
from intervention_server import UserInterventionHandler, InterventionServer
from handlers.lorem_ipsum import LoremIpsumHandler

class MyUserHandler(UserInterventionHandler):
    def process_user(self, user: dict) -> dict:
        # user keys: account_id, profile_name, handle, followers_count,
        #            following_count, posts_count, likes_count, bio, fields_to_intervene
        return {
            "followers_count": "—",
            "bio": "[redacted]",
        }

InterventionServer(LoremIpsumHandler(), user_handler=MyUserHandler()).run()
```

Return only the fields you want to rewrite — any key absent from the response is left unchanged on screen.

**Request** (sent by the extension when a profile page loads):

```json
{
  "survey_type": "x-user",
  "platform": "x",
  "account_id": "@handle",
  "profile_name": "Display Name",
  "followers_count": "12,345",
  "bio": "Profile bio text.",
  "fields_to_intervene": ["followers_count", "bio"]
}
```

**Response:** a flat dict of field names to replacement values.

```json
{
  "followers_count": "—",
  "bio": "[redacted]"
}
```

Set the endpoint (`http://127.0.0.1:5001/user-intervene`) in the **User Intervention** section of the survey card's Manipulation tab.

---

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

