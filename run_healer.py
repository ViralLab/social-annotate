#!/usr/bin/env python3
"""
Self-healing selector agent CLI.

Usage:
    python run_healer.py --file test_fixtures/x_twitter/post/x.html
    python run_healer.py --file test_fixtures/x_twitter/post/twitter_2020.html --retries 5
    python run_healer.py --file test_fixtures/x_twitter/post/x.html --apply
    python run_healer.py --file test_fixtures/x_twitter/post/x.html --llm-only

Environment:
    ANTHROPIC_API_KEY  →  use Claude (checked first)
    GEMINI_API_KEY     →  use Gemini (fallback)
    CLAUDE_MODEL       →  override Claude model (default: claude-haiku-4-5-20251001)
    GEMINI_MODEL       →  override Gemini model (default: gemini-2.5-pro)
"""

import argparse
import asyncio
import json
import sys
import traceback as _tb
from pathlib import Path

# Ensure project root is on path for BK.back_up_agents imports
sys.path.insert(0, str(Path(__file__).parent))

from agents.healer import SelectorHealer  # noqa: E402
from agents.registry import REGISTRY  # noqa: E402

# Mapping of path keywords → platform key for auto-detection.
_DETECT_RULES: list[tuple[list[str], str]] = [
    (["twitter", "x_twitter", "x.html"], "x"),
    (["instagram"],                        "instagram"),
    (["bluesky", "bsky"],                  "bluesky"),
    (["truthsocial", "truth_social"],      "truthsocial"),
    (["linkedin"],                         "linkedin"),
    (["telegram"],                         "telegram"),
    (["whatsapp", "whats_app"],            "whatsapp"),
    (["tiktok"],                           "tiktok"),
    (["youtube/comment"],                  "youtube-comment"),
    (["reddit/user_posts"],                "reddit-user-posts"),
    (["reddit/user"],                      "reddit-user"),
    (["reddit/comments"],                  "reddit-post"),
    (["reddit/feed"],                      "reddit-feed"),
]


def _detect_platform(path: Path) -> str:
    name = str(path).lower()
    stem = path.stem.lower()
    for keywords, platform in _DETECT_RULES:
        if any(kw in name or kw == stem for kw in keywords):
            return platform
    raise ValueError(
        f"Cannot auto-detect platform from '{path.name}'. "
        f"Use --platform. Supported: {sorted(REGISTRY)}"
    )


async def _run(args: argparse.Namespace) -> None:
    fixture = Path(args.file).resolve()
    if not fixture.exists():
        print(f"❌ File not found: {fixture}")
        sys.exit(1)

    try:
        platform = args.platform or _detect_platform(fixture)
    except ValueError as exc:
        print(f"❌ {exc}")
        sys.exit(1)

    if platform not in REGISTRY:
        print(f"❌ Unknown platform '{platform}'. Supported: {sorted(REGISTRY)}")
        sys.exit(1)

    print("🔧  Social Annotate — Self-Healing Selector Agent")
    print(f"    Platform : {platform}")
    print(f"    Fixture  : {fixture.name}")

    # Collect extra context: use --context if supplied, otherwise prompt interactively.
    if args.context is not None:
        extra_context = args.context.strip()
    else:
        print(
            "\nOptional: add extra context for the LLM "
            "(e.g. 'This is a 2010 snapshot, no post metrics exist')."
        )
        try:
            extra_context = input("    Extra context (Enter to skip): ").strip()
        except (EOFError, KeyboardInterrupt):
            extra_context = ""

    if extra_context:
        print(f"    Context  : {extra_context}")

    healer = SelectorHealer(
        fixture_path=fixture,
        platform=platform,
        max_llm_retries=args.retries,
        extra_context=extra_context or None,
    )

    _sel_key = healer.platform_agent.selectors_key or platform

    if args.llm_only:
        # Offline-only: steps 1-2 + output, no browser
        _, _ = healer._step1_validate_offline()
        with open(fixture, encoding="utf-8", errors="replace") as f:
            html = f.read()
        result = healer._step2_extract_selectors(html)

        src_path = Path("src/selectors.json")
        existing: dict = {}
        if src_path.exists():
            with open(src_path) as f:
                existing = json.load(f)

        new_sel = healer.platform_agent.to_nested_fn(result, existing)

        out = healer._step10_write_temp_selectors(new_sel)
        healer._step11_present_diff(new_sel)

        if args.apply:
            _apply_selectors(out, src_path, platform, selectors_key=_sel_key)
        return

    # Full 11-step run
    res = await healer.run()

    if args.apply and res.output_path:
        _apply_selectors(
            Path(res.output_path),
            Path("src/selectors.json"),
            platform,
            selectors_key=_sel_key,
        )
    elif not args.apply and res.output_path:
        print(
            f"\nTo apply these selectors run:\n"
            f"  python run_healer.py --file {args.file} --apply\n"
            f"\nOr copy manually from: {res.output_path}"
        )


def _apply_selectors(src: Path, dest: Path, platform: str, selectors_key: str | None = None) -> None:
    if not src.exists():
        print(f"⚠️  Temp file not found: {src}")
        return
    if not dest.exists():
        print(f"⚠️  Target not found: {dest}")
        return

    key = selectors_key or platform

    with open(src) as f:
        new_data: dict = json.load(f)
    with open(dest) as f:
        existing: dict = json.load(f)

    if key not in new_data:
        print(f"⚠️  Key '{key}' not found in generated selectors — cannot apply.")
        return

    existing[key] = new_data[key]

    with open(dest, "w") as f:
        json.dump(existing, f, indent=2)

    print(f"\n✅ Applied '{key}' selectors to {dest}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Self-healing selector agent for social-annotate-plus.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--file", "-f", required=True, help="Path to HTML fixture file.")
    parser.add_argument(
        "--platform", "-p", default=None,
        help="Platform key (auto-detected from path if omitted)."
    )
    parser.add_argument(
        "--retries", "-r", type=int, default=3,
        help="Max LLM retry attempts (default: 3)."
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Write generated selectors to src/selectors.json after success."
    )
    parser.add_argument(
        "--llm-only", action="store_true",
        help="Run offline steps only (1-2 + output). No browser launched."
    )
    parser.add_argument(
        "--context", "-c", default=None,
        help=(
            "Extra context passed to the LLM prompt "
            "(e.g. 'This is a 2010 snapshot, ignore post metrics'). "
            "If omitted, the CLI will ask interactively."
        ),
    )

    args = parser.parse_args()
    try:
        asyncio.run(_run(args))
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted.")
        sys.exit(1)
    except Exception:
        print("\n❌ Unhandled exception:")
        _tb.print_exc()
        sys.exit(1)
