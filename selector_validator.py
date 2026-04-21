"""
Selector Validator — test CSS selectors against a saved HTML file.

Verifies that selectors from selectors.json actually match elements
in a downloaded HTML page, without needing to load the Chrome extension.

Usage:
    python selector_validator.py --html test_fixtures/mock_twitter.html --platform twitter
    python selector_validator.py --html test_fixtures/mock_twitter.html --platform twitter --selectors src/selectors.json
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("Error: beautifulsoup4 not installed. Run: uv add beautifulsoup4 lxml")
    sys.exit(1)


def load_selectors(path: str) -> dict:
    """Load selectors.json."""
    with open(path, 'r') as f:
        return json.load(f)


def test_selector(soup: BeautifulSoup, selector: str, field_name: str, field_type: str) -> dict:
    """Test a single CSS selector against the parsed HTML."""
    result = {
        "field": field_name,
        "selector": selector,
        "type": field_type,
        "status": "SKIP",
        "matches": 0,
        "sample": None,
    }

    if field_type == "testid_value":
        # For testid values, build the actual CSS selector
        actual_selector = f'[data-testid="{selector}"]'
        try:
            elements = soup.select(actual_selector)
            result["matches"] = len(elements)
            result["status"] = "PASS" if elements else "FAIL"
            if elements:
                el = elements[0]
                aria = el.get("aria-label", "")
                text = el.get_text(strip=True)[:80]
                result["sample"] = aria or text or str(el.name)
        except Exception as e:
            result["status"] = "ERROR"
            result["sample"] = str(e)

    elif field_type == "regex_fragment":
        # For regex patterns, search aria-labels for the pattern
        import re
        try:
            pattern = re.compile(selector, re.IGNORECASE)
            matches = soup.find_all(attrs={"aria-label": pattern})
            result["matches"] = len(matches)
            result["status"] = "PASS" if matches else "FAIL"
            if matches:
                result["sample"] = matches[0].get("aria-label", "")[:80]
        except Exception as e:
            result["status"] = "ERROR"
            result["sample"] = str(e)

    elif field_type in ("selector", "id_or_selector"):
        try:
            elements = soup.select(selector)
            result["matches"] = len(elements)
            result["status"] = "PASS" if elements else "FAIL"
            if elements:
                el = elements[0]
                tag = el.name
                classes = el.get("class", [])[:2]
                testid = el.get("data-testid", "")
                text = el.get_text(strip=True)[:60]
                parts = [f"<{tag}>"]
                if testid:
                    parts.append(f'data-testid="{testid}"')
                if classes:
                    parts.append(f'class="{" ".join(classes[:2])}"')
                if text:
                    parts.append(f'"{text}"')
                result["sample"] = " ".join(parts)
        except Exception as e:
            result["status"] = "ERROR"
            result["sample"] = str(e)
    else:
        result["status"] = "SKIP"

    return result


# Field type mappings (same as in selector_agent.py)
FIELD_TYPES = {
    "twitter": {
        "reactRoot": "id_or_selector",
        "tweetContainer": "selector",
        "tweetText": "selector",
        "tweetPhoto": "selector",
        "videoPlayer": "selector",
        "cardWrapper": "selector",
        "metricsReply": "testid_value",
        "metricsRetweet": "testid_value",
        "metricsLike": "testid_value",
        "metricsBookmark": "testid_value",
        "metricsViewsPattern": "regex_fragment",
        "tweetTimestamp": "selector",
    },
    "instagram": {
        "reactRoot": "id_or_selector",
    }
}


def main():
    parser = argparse.ArgumentParser(description="Validate CSS selectors against saved HTML.")
    parser.add_argument("--html", required=True, help="Path to saved HTML file.")
    parser.add_argument("--platform", required=True, choices=["twitter", "instagram"])
    parser.add_argument("--selectors", default="src/selectors.json", help="Path to selectors.json.")

    args = parser.parse_args()

    # Load HTML
    html_path = Path(args.html)
    if not html_path.exists():
        print(f"Error: HTML file not found: {args.html}")
        sys.exit(1)

    print(f"📄 Loading HTML: {html_path}")
    raw = html_path.read_text(encoding='utf-8', errors='replace')
    print(f"   Size: {len(raw):,} chars")

    # Parse with BeautifulSoup
    print("🔍 Parsing DOM...")
    soup = BeautifulSoup(raw, 'lxml')

    # Load selectors
    selectors = load_selectors(args.selectors)
    platform_selectors = selectors.get(args.platform, {})
    field_types = FIELD_TYPES.get(args.platform, {})

    if not platform_selectors:
        print(f"Error: no selectors found for platform '{args.platform}'")
        sys.exit(1)

    # Test each selector
    print(f"\n{'─' * 70}")
    print(f"{'Field':<25} {'Status':<8} {'Matches':<9} {'Sample'}")
    print(f"{'─' * 70}")

    passed = 0
    failed = 0
    skipped = 0

    for field, selector in platform_selectors.items():
        if field == "observerFilter":
            continue  # not a CSS selector

        ftype = field_types.get(field, "selector")
        result = test_selector(soup, selector, field, ftype)

        icon = {"PASS": "✅", "FAIL": "❌", "ERROR": "⚠️", "SKIP": "⏭️"}.get(result["status"], "?")
        sample = (result["sample"] or "—")[:40]
        print(f"{icon} {result['field']:<23} {result['status']:<8} {result['matches']:<9} {sample}")

        if result["status"] == "PASS":
            passed += 1
        elif result["status"] == "FAIL":
            failed += 1
        else:
            skipped += 1

    print(f"{'─' * 70}")
    print(f"\n📊 Results: {passed} passed, {failed} failed, {skipped} skipped")

    if failed > 0:
        print("\n⚠️  Some selectors didn't match. Run the selector agent to regenerate them:")
        print(f"   python selector_agent.py --html {args.html} --platform {args.platform} --provider gemini")
        sys.exit(1)
    else:
        print("\n✅ All selectors validated successfully!")


if __name__ == "__main__":
    main()
