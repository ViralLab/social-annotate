"""
Selector Agent — LLM-powered self-healing CSS selector generator.

Given a downloaded HTML file from Twitter/X or Instagram, this script uses an LLM
to analyze the DOM structure and generate updated CSS selectors for the Social
Annotate extension's scraping functions.

After generating selectors, the agent automatically validates them against the
HTML using BeautifulSoup. If any selectors fail to match, it sends the failures
back to the LLM for a second attempt (controlled by --max-retries).

Scope:
    Selectors are grouped into 'tweet' and 'user' scopes. Use --scope to
    regenerate only one group while preserving the other from the existing file.
    This prevents a timeline-only HTML from clobbering user profile selectors
    (and vice versa).

Usage:
    # Regenerate tweet selectors only (from a timeline page):
    python selector_agent.py --html timeline.html --platform twitter --scope tweet --provider gemini

    # Regenerate user profile selectors only (from a profile page):
    python selector_agent.py --html profile.html --platform twitter --scope user --provider gemini

    # Regenerate all selectors (default, from a page with both):
    python selector_agent.py --html full_page.html --platform twitter --provider gemini

    # Use a different LLM provider:
    python selector_agent.py --html page.html --platform twitter --provider openai
    python selector_agent.py --html page.html --platform twitter --provider anthropic

    # Dry run (build prompt without calling LLM):
    python selector_agent.py --html page.html --platform twitter --dry-run

    # Custom output path and retry count:
    python selector_agent.py --html page.html --platform twitter --provider gemini --output custom/selectors.json --max-retries 2

Environment Variables (one required):
    GEMINI_API_KEY   or GOOGLE_API_KEY  — for --provider gemini
    OPENAI_API_KEY                      — for --provider openai
    ANTHROPIC_API_KEY                   — for --provider anthropic

Output:
    The generated selectors are written to src/selectors.json (by default), which
    the extension reads at runtime via chrome.storage.local. No JavaScript code
    changes are needed — just reload the extension.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

# ── Field Descriptions ─────────────────────────────────────
# These describe what data each selector should target.
# The LLM uses these to understand what to look for in the DOM.

TWITTER_FIELDS = {
    "reactRoot": {
        "description": "The root React container element for the entire Twitter/X app.",
        "example": "#react-root",
        "type": "id_or_selector",
        "optional": False,
        "scope": "shared",
    },
    "tweetContainer": {
        "description": "A single tweet post container. Usually an <article> element with role='article'.",
        "example": 'article[role="article"]',
        "type": "selector",
        "optional": False,
        "scope": "tweet",
    },
    "tweetText": {
        "description": "The element(s) inside a tweet that contain the tweet's text body.",
        "example": '[data-testid="tweetText"]',
        "type": "selector",
        "optional": False,
        "scope": "tweet",
    },
    "tweetPhoto": {
        "description": "Image elements inside a tweet's photo attachments. Should select the <img> tags.",
        "example": '[data-testid="tweetPhoto"] img',
        "type": "selector",
        "optional": True,
        "scope": "tweet",
    },
    "videoPlayer": {
        "description": "Video elements inside a tweet's video player. Should select the <video> tags.",
        "example": '[data-testid="videoPlayer"] video',
        "type": "selector",
        "optional": True,
        "scope": "tweet",
    },
    "cardWrapper": {
        "description": "Link preview card containers inside a tweet (for shared URLs).",
        "example": '[data-testid="card.wrapper"]',
        "type": "selector",
        "optional": True,
        "scope": "tweet",
    },
    "metricsReply": {
        "description": "The data-testid value (NOT a full selector) of the reply/comment button element. The code builds the selector as [data-testid='VALUE'].",
        "example": "reply",
        "type": "testid_value",
        "optional": False,
        "scope": "tweet",
    },
    "metricsRetweet": {
        "description": "The data-testid value of the retweet/repost button element.",
        "example": "retweet",
        "type": "testid_value",
        "optional": False,
        "scope": "tweet",
    },
    "metricsLike": {
        "description": "The data-testid value of the like/heart button element.",
        "example": "like",
        "type": "testid_value",
        "optional": False,
        "scope": "tweet",
    },
    "metricsBookmark": {
        "description": "The data-testid value of the bookmark button element.",
        "example": "bookmark",
        "type": "testid_value",
        "optional": True,
        "scope": "tweet",
    },
    "metricsViewsPattern": {
        "description": "A regex fragment (without delimiters) matching the word 'views' or equivalent in aria-label attributes. Used to find view counts.",
        "example": "views?",
        "type": "regex_fragment",
        "optional": True,
        "scope": "tweet",
    },
    "tweetTimestamp": {
        "description": "The <time> element inside a tweet. Its parent <a> tag contains the tweet's permalink URL.",
        "example": "time",
        "type": "selector",
        "optional": False,
        "scope": "tweet",
    },
    # ── User Profile Selectors ─────────────────────────────
    "userDisplayName": {
        "description": "The container element for the user's display name on their profile page. Usually has data-testid='UserName'.",
        "example": '[data-testid="UserName"]',
        "type": "selector",
        "optional": True,
        "scope": "user",
    },
    "userHandle": {
        "description": "The element containing the @username handle text. Typically a span inside the UserName container.",
        "example": '[data-testid="UserName"] a[href] span',
        "type": "selector",
        "optional": True,
        "scope": "user",
    },
    "userAvatar": {
        "description": "The profile picture <img> element. Should target the img with 'profile_images' in its src.",
        "example": '[data-testid="UserAvatar"] img[src*="profile_images"]',
        "type": "selector",
        "optional": True,
        "scope": "user",
    },
    "userBio": {
        "description": "The user's bio/description text container on their profile page.",
        "example": '[data-testid="UserDescription"]',
        "type": "selector",
        "optional": True,
        "scope": "user",
    },
    "userVerified": {
        "description": "The verified badge icon element on a user profile. Its presence indicates the user is verified.",
        "example": '[data-testid="icon-verified"]',
        "type": "selector",
        "optional": True,
        "scope": "user",
    },
    "userFollowers": {
        "description": "The link element showing the follower count. Usually an <a> tag whose href ends with '/followers' or '/verified_followers'.",
        "example": 'a[href$="/verified_followers"], a[href$="/followers"]',
        "type": "selector",
        "optional": True,
        "scope": "user",
    },
    "userFollowing": {
        "description": "The link element showing the following count. Usually an <a> tag whose href ends with '/following'.",
        "example": 'a[href$="/following"]',
        "type": "selector",
        "optional": True,
        "scope": "user",
    },
    "userLocation": {
        "description": "The element showing the user's location on their profile page.",
        "example": '[data-testid="UserLocation"]',
        "type": "selector",
        "optional": True,
        "scope": "user",
    },
    "userJoinDate": {
        "description": "The element showing when the user joined Twitter/X.",
        "example": '[data-testid="UserJoinDate"]',
        "type": "selector",
        "optional": True,
        "scope": "user",
    },
    "userUrl": {
        "description": "The element showing the user's website URL on their profile page.",
        "example": '[data-testid="UserUrl"]',
        "type": "selector",
        "optional": True,
        "scope": "user",
    },
}


def get_scoped_fields(platform: str, scope: str) -> dict:
    """Return only fields matching the requested scope.

    scope='tweet' → shared + tweet fields
    scope='user'  → shared + user fields
    scope='all'   → everything
    """
    all_fields = PLATFORM_FIELDS.get(platform, {})
    if scope == "all":
        return all_fields
    return {k: v for k, v in all_fields.items() if v.get("scope") in (scope, "shared")}

INSTAGRAM_FIELDS = {
    "reactRoot": {
        "description": "The root React container element for the Instagram app.",
        "example": "#react-root",
        "type": "id_or_selector",
        "optional": False,
    }
}

PLATFORM_FIELDS = {
    "twitter": TWITTER_FIELDS,
    "instagram": INSTAGRAM_FIELDS,
}


# ── HTML Cleaning ──────────────────────────────────────────

def clean_html(raw_html: str, max_chars: int = 80000) -> str:
    """Strip scripts, styles, and excessive whitespace to reduce token usage."""
    # Remove <script> and <style> blocks
    cleaned = re.sub(r'<script[^>]*>.*?</script>', '', raw_html, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r'<style[^>]*>.*?</style>', '', cleaned, flags=re.DOTALL | re.IGNORECASE)
    # Remove HTML comments
    cleaned = re.sub(r'<!--.*?-->', '', cleaned, flags=re.DOTALL)
    # Collapse whitespace
    cleaned = re.sub(r'\s+', ' ', cleaned)
    # Try to extract just the main content area for twitter
    # Look for the first <article> and grab a generous context around it
    article_match = re.search(r'<article[^>]*>.*?</article>', cleaned, flags=re.DOTALL | re.IGNORECASE)
    if article_match:
        start = max(0, article_match.start() - 2000)
        end = min(len(cleaned), article_match.end() + 2000)
        cleaned = cleaned[start:end]
    # Truncate if still too long
    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars] + "\n... [TRUNCATED]"
    return cleaned


# ── Prompt Building ────────────────────────────────────────

def build_prompt(platform: str, html_snippet: str, failed_fields: dict = None, scope: str = "all") -> str:
    """Build the structured prompt for the LLM."""
    fields = get_scoped_fields(platform, scope)

    field_descriptions = ""
    for key, info in fields.items():
        field_descriptions += f"""
- **{key}** ({info['type']}): {info['description']}
  Current/example value: `{info['example']}`"""

    retry_section = ""
    if failed_fields:
        retry_section = "\n\n## ⚠️  Previous Attempt Failed\nThe following selectors from your previous attempt did NOT match any elements in the HTML. Please examine the DOM more carefully and provide corrected selectors:\n"
        for field, info in failed_fields.items():
            retry_section += f"\n- **{field}**: `{info['tried']}` → 0 matches. {info['hint']}"
        retry_section += "\n\nLook harder at the HTML structure. Check for variant data-testid values, different attribute names, or alternative DOM patterns."

    return f"""You are an expert web scraper analyzing a saved HTML page from {platform.title()}.

Your task: examine the DOM structure below and output updated CSS selectors for each data field listed. The selectors are used by a Chrome extension to scrape data from the live website.

## Data Fields Needed
{field_descriptions}
{retry_section}

## Important Rules
1. For `type: "selector"` fields, output a valid CSS selector string (e.g. `[data-testid="tweetText"]`, `article[role="article"]`).
2. For `type: "testid_value"` fields, output ONLY the data-testid attribute value (e.g. `reply`, NOT `[data-testid="reply"]`).
3. For `type: "regex_fragment"` fields, output a regex fragment without delimiters (e.g. `views?`).
4. For `type: "id_or_selector"` fields, output a CSS selector (e.g. `#react-root`).
5. Prefer `data-testid` attributes when available — they are the most stable.
6. If an element uses `aria-label` for identification, include that in the selector.
7. If you cannot find a field, return the example/current value unchanged.
8. Output ONLY valid JSON — no markdown fences, no explanation.

## Output Format
Return a JSON object with this exact structure:
{{
{chr(10).join(f'  "{k}": "..."' + (',' if i < len(fields) - 1 else '') for i, (k, _) in enumerate(fields.items()))}
}}

## HTML Snippet
```html
{html_snippet}
```

Output the JSON now:"""


# ── LLM Providers ──────────────────────────────────────────

def call_openai(prompt: str, model: str = "gpt-4o") -> str:
    """Call OpenAI API."""
    try:
        from openai import OpenAI
    except ImportError:
        print("Error: openai package not installed. Run: uv add openai")
        sys.exit(1)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY environment variable not set.")
        sys.exit(1)

    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a precise CSS selector extraction tool. Output only valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.0,
        max_tokens=4000
    )
    return response.choices[0].message.content.strip()


def call_anthropic(prompt: str, model: str = "claude-sonnet-4-20250514") -> str:
    """Call Anthropic API."""
    try:
        import anthropic
    except ImportError:
        print("Error: anthropic package not installed. Run: uv add anthropic")
        sys.exit(1)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set.")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
        system="You are a precise CSS selector extraction tool. Output only valid JSON.",
        temperature=0.0
    )
    return response.content[0].text.strip()


def call_gemini(prompt: str, model: str = "gemini-2.5-flash") -> str:
    """Call Google Gemini API."""
    try:
        from google import genai
    except ImportError:
        print("Error: google-genai package not installed. Run: uv add google-genai")
        sys.exit(1)

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY (or GOOGLE_API_KEY) environment variable not set.")
        sys.exit(1)

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=genai.types.GenerateContentConfig(
            system_instruction="You are a precise CSS selector extraction tool. Output only valid JSON.",
            temperature=0.0,
            max_output_tokens=4000,
        ),
    )
    return response.text.strip()


def call_llm(provider: str, prompt: str, model: str = None) -> str:
    """Dispatch to the appropriate LLM provider."""
    if provider == "openai":
        return call_openai(prompt, model or "gpt-4o")
    elif provider == "anthropic":
        return call_anthropic(prompt, model or "claude-sonnet-4-20250514")
    else:
        return call_gemini(prompt, model or "gemini-2.5-flash")


# ── Response Parsing ───────────────────────────────────────

def parse_llm_response(response_text: str) -> dict:
    """Extract JSON from LLM response, handling markdown fences if present."""
    # Strip markdown code fences
    cleaned = re.sub(r'^```(?:json)?\s*', '', response_text, flags=re.MULTILINE)
    cleaned = re.sub(r'\s*```$', '', cleaned, flags=re.MULTILINE)
    cleaned = cleaned.strip()
    return json.loads(cleaned)


def merge_selectors(existing_path: str, platform: str, new_selectors: dict) -> dict:
    """Load existing selectors.json and merge the updated platform section."""
    if os.path.exists(existing_path):
        with open(existing_path, 'r') as f:
            full_config = json.load(f)
    else:
        full_config = {}

    full_config[platform] = new_selectors
    return full_config


# ── Validator ──────────────────────────────────────────────

def validate_selectors(raw_html: str, platform: str, selectors: dict) -> list:
    """
    Validate selectors against the HTML. Returns a list of result dicts:
      { field, selector, type, optional, status, matches, sample }

    Status: PASS, FAIL, WARN (optional field not found — acceptable)
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        print("Warning: beautifulsoup4 not installed. Skipping validation.")
        return []

    soup = BeautifulSoup(raw_html, 'lxml')
    fields = PLATFORM_FIELDS.get(platform, {})
    results = []

    for field, selector in selectors.items():
        if field == "observerFilter":
            continue  # not a CSS selector

        info = fields.get(field)
        if not info:
            continue

        ftype = info["type"]
        is_optional = info.get("optional", False)
        result = {
            "field": field,
            "selector": selector,
            "type": ftype,
            "optional": is_optional,
            "status": "SKIP",
            "matches": 0,
            "sample": None,
        }

        try:
            if ftype == "testid_value":
                actual = f'[data-testid="{selector}"]'
                elements = soup.select(actual)
                result["matches"] = len(elements)
                if elements:
                    result["status"] = "PASS"
                    el = elements[0]
                    result["sample"] = el.get("aria-label", el.get_text(strip=True)[:80]) or el.name
                else:
                    result["status"] = "WARN" if is_optional else "FAIL"

            elif ftype == "regex_fragment":
                pattern = re.compile(selector, re.IGNORECASE)
                matches = soup.find_all(attrs={"aria-label": pattern})
                result["matches"] = len(matches)
                if matches:
                    result["status"] = "PASS"
                    result["sample"] = matches[0].get("aria-label", "")[:80]
                else:
                    result["status"] = "WARN" if is_optional else "FAIL"

            elif ftype in ("selector", "id_or_selector"):
                elements = soup.select(selector)
                result["matches"] = len(elements)
                if elements:
                    result["status"] = "PASS"
                    el = elements[0]
                    tag = el.name
                    testid = el.get("data-testid", "")
                    text = el.get_text(strip=True)[:50]
                    parts = [f"<{tag}>"]
                    if testid:
                        parts.append(f'testid="{testid}"')
                    if text:
                        parts.append(f'"{text}"')
                    result["sample"] = " ".join(parts)
                else:
                    result["status"] = "WARN" if is_optional else "FAIL"

        except Exception as e:
            result["status"] = "ERROR"
            result["sample"] = str(e)

        results.append(result)

    return results


def print_validation(results: list) -> tuple:
    """Print validation table. Returns (passed, failed, warned)."""
    passed = failed = warned = 0

    print(f"\n{'─' * 75}")
    print(f" {'Field':<23} {'Status':<8} {'Matches':<9} {'Sample'}")
    print(f"{'─' * 75}")

    for r in results:
        icon = {"PASS": "✅", "FAIL": "❌", "WARN": "⚠️", "ERROR": "💥", "SKIP": "⏭️"}.get(r["status"], "?")
        sample = (r["sample"] or "— (not on this page)")[:38]
        print(f" {icon} {r['field']:<21} {r['status']:<8} {r['matches']:<9} {sample}")

        if r["status"] == "PASS":
            passed += 1
        elif r["status"] == "FAIL":
            failed += 1
        elif r["status"] == "WARN":
            warned += 1

    print(f"{'─' * 75}")
    print(f"\n📊 Results: {passed} passed, {failed} failed, {warned} warned (optional)")
    return passed, failed, warned


def get_failed_for_retry(results: list) -> dict:
    """Extract truly failed (non-optional) selectors for retry prompt."""
    failed = {}
    for r in results:
        if r["status"] == "FAIL":
            hint = f"Expected type: {r['type']}."
            if r["type"] == "testid_value":
                hint += " Look for data-testid attributes on interactive buttons."
            elif r["type"] == "selector":
                hint += " Check the DOM for this element under a different structure."
            failed[r["field"]] = {"tried": r["selector"], "hint": hint}
    return failed


# ── Main ───────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="LLM-powered CSS selector generator for Social Annotate extension."
    )
    parser.add_argument("--html", required=True, help="Path to saved HTML file from the target website.")
    parser.add_argument("--platform", required=True, choices=["twitter", "instagram"],
                        help="Target platform (twitter or instagram).")
    parser.add_argument("--provider", default="openai", choices=["openai", "anthropic", "gemini"],
                        help="LLM provider to use (default: openai).")
    parser.add_argument("--model", default=None,
                        help="Model name override (default: gpt-4o for openai, claude-sonnet-4-20250514 for anthropic, gemini-2.5-flash for gemini).")
    parser.add_argument("--output", default="src/selectors.json",
                        help="Path to output selectors.json (default: src/selectors.json).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the generated selectors without writing to file.")
    parser.add_argument("--max-retries", type=int, default=1,
                        help="Max retry attempts for failed selectors (default: 1).")
    parser.add_argument("--scope", default="all", choices=["tweet", "user", "all"],
                        help="Which selector group to regenerate (default: all). "
                             "Use 'tweet' with timeline HTML, 'user' with profile HTML. "
                             "Out-of-scope selectors are preserved from the existing file.")

    args = parser.parse_args()

    if args.platform not in PLATFORM_FIELDS:
        print(f"Error: unsupported platform '{args.platform}'")
        sys.exit(1)

    # Read HTML
    html_path = Path(args.html)
    if not html_path.exists():
        print(f"Error: HTML file not found: {args.html}")
        sys.exit(1)

    print(f"📄 Reading HTML from: {html_path}")
    raw_html = html_path.read_text(encoding='utf-8', errors='replace')
    print(f"   Raw size: {len(raw_html):,} chars")

    # Clean and trim
    snippet = clean_html(raw_html)
    print(f"   Cleaned size: {len(snippet):,} chars")

    # Scope info
    scope = args.scope
    scoped_fields = get_scoped_fields(args.platform, scope)
    all_fields = PLATFORM_FIELDS[args.platform]
    skipped = len(all_fields) - len(scoped_fields)
    if scope != "all":
        print(f"   Scope: {scope} ({len(scoped_fields)} fields, {skipped} preserved from existing file)")

    # Build prompt
    prompt = build_prompt(args.platform, snippet, scope=scope)
    print(f"   Prompt size: {len(prompt):,} chars")

    if args.dry_run:
        print("\n🔍 Dry run — prompt built successfully. Skipping LLM call.")
        print(f"\nPrompt preview (first 500 chars):\n{prompt[:500]}...")
        return

    # ── Step 1: Generate selectors ─────────────────────────
    model_name = args.model
    if not model_name:
        model_name = {"openai": "gpt-4o", "anthropic": "claude-sonnet-4-20250514", "gemini": "gemini-2.5-flash"}[args.provider]

    print(f"\n🤖 Calling {args.provider.title()} ({model_name})...")
    response_text = call_llm(args.provider, prompt, model_name)

    try:
        new_selectors = parse_llm_response(response_text)
    except json.JSONDecodeError as e:
        print(f"\n❌ Failed to parse LLM response as JSON: {e}")
        print(f"Raw response:\n{response_text}")
        sys.exit(1)

    print(f"\n✅ Generated selectors for {args.platform}:")
    print(json.dumps(new_selectors, indent=2))

    # Fill in any missing scoped fields with defaults
    expected_fields = set(scoped_fields.keys())
    received_fields = set(new_selectors.keys())
    missing = expected_fields - received_fields
    if missing:
        print(f"\n⚠️  Warning: missing fields: {', '.join(missing)}")
        for field in missing:
            new_selectors[field] = scoped_fields[field]["example"]

    # Remove any out-of-scope fields the LLM might have added
    new_selectors = {k: v for k, v in new_selectors.items() if k in scoped_fields}

    # ── Step 2: Validate scoped selectors against HTML ─────
    print("\n🔍 Validating selectors against HTML...")
    results = validate_selectors(raw_html, args.platform, new_selectors)

    if not results:
        print("   (validation skipped — install beautifulsoup4 for validation)")
    else:
        passed, failed, warned = print_validation(results)

        # ── Step 3: Retry if needed ────────────────────────
        retry = 0
        while failed > 0 and retry < args.max_retries:
            retry += 1
            failed_fields = get_failed_for_retry(results)
            print(f"\n🔄 Retry {retry}/{args.max_retries} — {len(failed_fields)} selectors need fixing...")

            retry_prompt = build_prompt(args.platform, snippet, failed_fields=failed_fields, scope=scope)
            print(f"   Retry prompt size: {len(retry_prompt):,} chars")
            print(f"   Calling {args.provider.title()} ({model_name})...")

            retry_response = call_llm(args.provider, retry_prompt, model_name)

            try:
                retry_selectors = parse_llm_response(retry_response)
            except json.JSONDecodeError as e:
                print(f"   ❌ Retry response not valid JSON: {e}")
                break

            # Merge only the fixed fields
            for field in failed_fields:
                if field in retry_selectors:
                    new_selectors[field] = retry_selectors[field]
                    print(f"   📝 {field}: {retry_selectors[field]}")

            # Re-validate
            print("\n   Re-validating...")
            results = validate_selectors(raw_html, args.platform, new_selectors)
            passed, failed, warned = print_validation(results)

        # Final summary
        if failed > 0:
            print(f"\n⚠️  {failed} required selector(s) still failing after {retry} retries.")
            print("   The generated selectors are saved but may not work correctly.")
            print("   Consider saving a different page with more diverse tweet content.")
        elif warned > 0:
            print(f"\n✅ All required selectors valid! ({warned} optional field(s) not on this page — that's OK)")
        else:
            print("\n✅ All selectors validated successfully!")

    # ── Step 4: Write output (scope-aware merge) ───────────
    output_path = args.output

    # Load existing config so we can preserve out-of-scope selectors
    if os.path.exists(output_path):
        with open(output_path, 'r') as f:
            full_config = json.load(f)
    else:
        full_config = {}

    existing_platform = full_config.get(args.platform, {})

    # Merge: update only scoped fields, keep everything else
    existing_platform.update(new_selectors)
    full_config[args.platform] = existing_platform

    # Preserve observerFilter from defaults if not present
    if args.platform == "twitter" and "observerFilter" not in full_config["twitter"]:
        full_config["twitter"]["observerFilter"] = {
            "attributes": True,
            "childList": True,
            "subtree": True,
            "attributeFilter": ["role"]
        }

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(full_config, f, indent=2)

    print(f"\n💾 Written to: {output_path}")
    print("   Reload the extension to pick up the new selectors.")


if __name__ == "__main__":
    main()
