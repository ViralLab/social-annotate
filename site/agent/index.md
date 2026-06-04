# Self-Healing Selector Agent

Social media platforms frequently change their HTML structure, which can silently break injection. The self-healing agent is a Python pipeline that detects broken CSS selectors and proposes replacements — automatically, using an LLM.

## Overview

The agent works offline: you save an HTML snapshot of the target platform, point the agent at it, and it does the rest. No live browsing of the platform is required.

The proposed selectors are never written to `src/selectors.json` automatically — the agent presents a **diff** for your review first (unless you pass `--apply`).

## How It Works

The agent runs an 11-step pipeline:

| Step | Action |
|---|---|
| 1 | Validates the HTML fixture offline (BeautifulSoup post count, missing asset warnings) |
| 2 | Sends the HTML to an LLM (Claude or Gemini) to extract new CSS selectors |
| 3 | Opens the fixture in a real Chromium instance with the extension loaded |
| 4 | Waits for injection and scrolls to trigger the `MutationObserver` |
| 5 | Takes a screenshot to visually confirm injection |
| 6 | Verifies injection by counting survey containers and shadow DOM iframes |
| 7 | Checks that survey forms are accessible inside the sandbox frames |
| 8 | Fills and submits the first available form option |
| 9 | Validates the submission (checks for the "Done!" button state) |
| 10 | Writes the proposed selectors to a temp JSON file |
| 11 | Presents a diff against the current `src/selectors.json` for review |

## Prerequisites

Install Python dependencies:

```bash
pip install anthropic playwright beautifulsoup4
playwright install chromium
```

Set your API key:

```bash
export ANTHROPIC_API_KEY=sk-...   # Claude (checked first)
# or
export GEMINI_API_KEY=...         # Gemini (fallback)
```

## Usage

Save an HTML snapshot of the target platform (e.g. by using *Save Page As* in Chrome), then point the agent at it:

```bash
# Inspect proposed selectors without applying them
python run_healer.py --file test_fixtures/x_twitter/x.html

# Retry LLM extraction up to 5 times
python run_healer.py --file test_fixtures/x_twitter/x.html --retries 5

# Apply the proposed selectors to src/selectors.json automatically
python run_healer.py --file test_fixtures/x_twitter/x.html --apply

# LLM extraction only — no browser step (fast, offline)
python run_healer.py --file test_fixtures/x_twitter/x.html --llm-only
```

Platform is auto-detected from the filename. Override with `--platform x` if needed.

### Available fixtures

The repository ships with saved HTML fixtures for all supported platforms under `test_fixtures/`:

```
test_fixtures/
├── x_twitter/
├── instagram/
├── bluesky/
├── linkedin/
├── whatsapp/
├── telegram/
└── truthsocial/
```

## Profile Annotation Healer

A separate script handles user/profile page selectors:

```bash
python run_profile_healer.py --file test_fixtures/x_twitter/x_profile.html
```

Same flags as `run_healer.py`.
