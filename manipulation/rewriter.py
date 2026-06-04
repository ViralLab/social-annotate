#!/usr/bin/env python3
"""
Offline post rewriter for Social Annotate manipulation studies.

Input  : JSON array — [{ "post_id": str, "text": str }, ...]
Output : manipulation_map.json — { "_meta": {...}, "<post_id>": { rewritten_text, ... }, ... }

The extension reads this file and patches post text in the feed at runtime.
Only "rewritten_text" is required per entry; all other fields are for audit/traceability.
"_meta" is skipped by the extension during lookup.
"""

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

# ── Prompt presets ─────────────────────────────────────────────────────────────

PRESETS = {
    "detoxify": (
        "Rewrite the following social media post to remove insults, aggression, and offensive "
        "language while preserving the core argument and meaning. "
        "Return only the rewritten text, nothing else."
    ),
    "simplify": (
        "Rewrite the following social media post at an 8th-grade reading level. "
        "Keep the same meaning but use simpler vocabulary and shorter sentences. "
        "Return only the rewritten text, nothing else."
    ),
    "neutralize": (
        "Rewrite the following social media post to remove partisan framing, emotional language, "
        "and tribal signaling. Make it politically neutral while preserving the factual content. "
        "Return only the rewritten text, nothing else."
    ),
}

# ── LLM callers ────────────────────────────────────────────────────────────────

def _make_claude_caller():
    import anthropic
    model = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5-20251001")
    client = anthropic.Anthropic()
    print(f"🤖  LLM: Claude ({model})", file=sys.stderr)

    def call(system_prompt: str, text: str) -> str:
        response = client.messages.create(
            model=model,
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": text}],
        )
        return response.content[0].text.strip()

    return call, model


def _make_gemini_caller():
    from google import genai
    from google.genai import types
    model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
    client = genai.Client()
    print(f"🤖  LLM: Gemini ({model})", file=sys.stderr)

    def call(system_prompt: str, text: str) -> str:
        response = client.models.generate_content(
            model=model,
            contents=f"{system_prompt}\n\n{text}",
            config=types.GenerateContentConfig(temperature=0.3),
        )
        return response.text.strip()

    return call, model


def _get_caller(model_pref: str | None):
    if model_pref == "gemini":
        return _make_gemini_caller()
    if model_pref == "claude":
        return _make_claude_caller()
    if os.environ.get("ANTHROPIC_API_KEY"):
        return _make_claude_caller()
    if os.environ.get("GEMINI_API_KEY"):
        return _make_gemini_caller()
    raise EnvironmentError("No LLM API key found. Set ANTHROPIC_API_KEY or GEMINI_API_KEY.")


# ── Core logic ─────────────────────────────────────────────────────────────────

def _rewrite_with_retry(caller, system_prompt: str, post_id: str, text: str, retries: int) -> str:
    last_err = None
    for attempt in range(retries):
        try:
            return caller(system_prompt, text)
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"    ⚠  attempt {attempt + 1} failed for {post_id}, retrying in {wait}s: {e}", file=sys.stderr)
                time.sleep(wait)
    raise RuntimeError(f"All {retries} attempts failed for post '{post_id}': {last_err}")


def _map_hash(entries: dict) -> str:
    """First 8 hex chars of SHA-256 over the canonical post entries (excluding _meta)."""
    raw = json.dumps(entries, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()[:8]


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Rewrite social media posts offline for Social Annotate manipulation studies.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"Built-in prompt presets: {', '.join(PRESETS)}",
    )
    parser.add_argument("--input",   required=True, help="Path to input JSON file.")
    parser.add_argument("--prompt",  required=True, help="Preset name or a custom prompt string.")
    parser.add_argument("--output",  default="manipulation_map.json", help="Output file path (default: manipulation_map.json).")
    parser.add_argument("--model",   choices=["claude", "gemini"], default=None, help="LLM backend (auto-detected from env if omitted).")
    parser.add_argument("--retries", type=int, default=3, help="Max API attempts per post (default: 3).")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be sent without making API calls.")
    args = parser.parse_args()

    # Load and validate input
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: '{input_path}' not found.", file=sys.stderr)
        sys.exit(1)

    try:
        posts = json.loads(input_path.read_text())
    except json.JSONDecodeError as e:
        print(f"Error: invalid JSON in '{input_path}': {e}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(posts, list) or not posts:
        print("Error: input must be a non-empty JSON array.", file=sys.stderr)
        sys.exit(1)

    for i, p in enumerate(posts):
        if "post_id" not in p or "text" not in p:
            print(f"Error: entry {i} missing 'post_id' or 'text'.", file=sys.stderr)
            sys.exit(1)

    prompt_label  = args.prompt if args.prompt in PRESETS else "custom"
    system_prompt = PRESETS.get(args.prompt, args.prompt)

    print(f"\n📋  Posts   : {len(posts)}", file=sys.stderr)
    print(f"📝  Prompt  : {prompt_label}", file=sys.stderr)
    print(f"🔁  Retries : {args.retries}", file=sys.stderr)

    if args.dry_run:
        print("\n── DRY RUN (no API calls) ──", file=sys.stderr)
        for p in posts[:3]:
            print(f"\n  post_id : {p['post_id']}", file=sys.stderr)
            print(f"  text    : {str(p['text'])[:120]}", file=sys.stderr)
        if len(posts) > 3:
            print(f"\n  ... and {len(posts) - 3} more post(s)", file=sys.stderr)
        print(f"\n  system prompt: {system_prompt[:120]}", file=sys.stderr)
        return

    caller, model_name = _get_caller(args.model)
    print("", file=sys.stderr)

    entries: dict = {}
    failed: list  = []
    ts = int(time.time())

    for i, post in enumerate(posts, 1):
        post_id = str(post["post_id"])
        text    = str(post["text"])
        label   = post_id[:24]
        print(f"  [{i:>{len(str(len(posts)))}}/{len(posts)}] {label:<24}", end=" ", file=sys.stderr)
        sys.stderr.flush()

        try:
            rewritten = _rewrite_with_retry(caller, system_prompt, post_id, text, args.retries)
            entries[post_id] = {
                "rewritten_text": rewritten,
                "original_text":  text,
                "prompt_label":   prompt_label,
                "model":          model_name,
                "timestamp":      ts,
            }
            print("✓", file=sys.stderr)
        except RuntimeError as e:
            failed.append(post_id)
            print(f"✗  {e}", file=sys.stderr)

    if not entries:
        print("\nError: no posts were successfully rewritten.", file=sys.stderr)
        sys.exit(1)

    map_id = _map_hash(entries)
    output = {
        "_meta": {
            "map_id":    map_id,
            "prompt_label": prompt_label,
            "model":     model_name,
            "timestamp": ts,
            "total":     len(posts),
            "succeeded": len(entries),
            "failed":    len(failed),
        },
        **entries,
    }

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False))

    print(f"\n✅  {len(entries)} entries written → {out_path}", file=sys.stderr)
    print(f"    map_id : {map_id}", file=sys.stderr)
    if failed:
        print(f"    ⚠  {len(failed)} failed: {', '.join(failed)}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
