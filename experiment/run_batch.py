#!/usr/bin/env python3
"""
Batch evaluation of the self-healing selector agent across all test fixtures.

Usage:
    python experiment/run_batch.py
    python experiment/run_batch.py --llm-only        # skip browser (steps 1-2 only)
    python experiment/run_batch.py --fixture x_twitter/x.html   # single fixture

Output:
    experiment/results/batch_results.json   — full per-fixture data
    experiment/results/screenshots/         — injection screenshots
    experiment/results/selectors/           — proposed selector diffs
    Prints a summary table to stdout at the end.

Environment:
    ANTHROPIC_API_KEY  or  GEMINI_API_KEY   (same as run_healer.py)
"""

import argparse
import asyncio
import json
import shutil
import sys
import traceback as _tb
from dataclasses import asdict
from datetime import datetime
from pathlib import Path


class _Encoder(json.JSONEncoder):
    """Handle Pydantic models and other non-serializable objects."""
    def default(self, obj):
        if hasattr(obj, 'model_dump'):
            return obj.model_dump()
        if hasattr(obj, '__dict__'):
            return obj.__dict__
        return super().default(obj)

# Project root on path
_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))

from agents.healer import SelectorHealer, HealerResult  # noqa: E402
from agents.registry import REGISTRY  # noqa: E402

_RESULTS_DIR = _ROOT / "experiment" / "results"
_SCREENSHOTS_DIR = _RESULTS_DIR / "screenshots"
_SELECTORS_DIR = _RESULTS_DIR / "selectors"

# ── Fixture manifest ──────────────────────────────────────────────────────────
# Each entry: (fixture_rel, platform, year, extra_context, block_spa_scripts, survey_type, strip_csp)
# block_spa_scripts=None uses the platform agent's default.
# survey_type=None uses the platform agent's default.

FIXTURES = [
    # X / Twitter — historical snapshots from Wayback Machine
    ("test_fixtures/x_twitter/post/twitter_2010.html", "x", "2010",
     "This is a 2010 Twitter archive snapshot. Server-rendered layout, pre-React. "
     "Engagement metrics may be absent or minimal.", None, None, False),

    ("test_fixtures/x_twitter/post/twitter_2014.html", "x", "2014",
     "This is a 2014 Twitter archive snapshot. Server-rendered layout, pre-React.", None, None, False),

    ("test_fixtures/x_twitter/post/twitter_2017.html", "x", "2017",
     "This is a 2017 Twitter archive snapshot. Server-rendered layout, pre-React.", None, None, False),

    ("test_fixtures/x_twitter/post/twitter_2020.html", "x", "2020",
     "This is a 2020 Twitter archive snapshot. Early React SPA layout.", None, None, False),

    # X / Twitter — current (2026)
    ("test_fixtures/x_twitter/post/x.html", "x", "2026", "", None, None, False),
    ("test_fixtures/x_twitter/user/x.html", "x", "2026", "", None, "x-user", False),

    # Bluesky — historical and current
    # 2023 is a Wayback Machine archive: block its scripts to prevent redirect away from the fixture
    ("test_fixtures/bluesky/post/bluesky_2023.html", "bluesky", "2023",
     "This is a 2023 Bluesky snapshot from early public beta. "
     "Post containers and selectors may differ from the current layout.", True, None, False),

    ("test_fixtures/bluesky/post/bluesky2026.html", "bluesky", "2026", "", None, None, False),
    ("test_fixtures/bluesky/user/jack dorsey.html", "bluesky", "2026", "", None, "bluesky-user", False),

    # Telegram Web
    ("test_fixtures/telegram/post/sample.html", "telegram", "2026", "", None, None, False),
    ("test_fixtures/telegram/post/sample2.html", "telegram", "2026", "", None, None, False),

    # WhatsApp Web
    ("test_fixtures/whatsapp/post/WhatsApp-mark-channel.html", "whatsapp", "2026",
     "This is a WhatsApp Channel view.", None, None, False),

    # LinkedIn — saved pages have a strict nonce-based CSP that blocks fonts/scripts locally;
    # also block SPA scripts to prevent domcontentloaded timeout from LinkedIn JS bundles
    ("test_fixtures/linkedin/user/linkedin_user.html", "linkedin-user", "2026", "", True, "linkedin-user", True),
    ("test_fixtures/linkedin/post/linkein_feed_sample.html", "linkedin", "2026", "", True, None, True),

    # TruthSocial
    ("test_fixtures/truthsocial/post/truthsocial_sample.html", "truthsocial", "2026", "", None, None, False),
    ("test_fixtures/truthsocial/user/truthsocial_sample.html", "truthsocial", "2026", "", None, "truthsocial-user", False),
]


# ── Evaluation helpers ────────────────────────────────────────────────────────

def _failure_step(res: HealerResult, llm_only: bool) -> str | None:
    """Return the label of the first failed step, or None if fully successful."""
    if res.error and "Step 1" in res.error:
        return "Step 1: HTML validation"
    if res.selectors is None:
        return "Step 2: LLM extraction"
    if llm_only:
        return None  # in llm-only mode, successful extraction = pass
    if not res.browser_loaded:
        return "Step 3: Browser load"
    if res.survey_containers == 0:
        return "Step 6: Survey injection"
    if res.form_frames == 0:
        return "Step 7: Form accessibility"
    if not res.form_submitted:
        return "Step 8: Form submission"
    if not res.submission_validated:
        return "Step 9: Data validation"
    return None


def _result_record(
    fixture_rel: str,
    platform: str,
    year: str,
    res: HealerResult,
    duration_s: float,
    llm_only: bool = False,
) -> dict:
    fail = _failure_step(res, llm_only)
    return {
        "fixture": fixture_rel,
        "platform": platform,
        "year": year,
        "duration_s": round(duration_s, 1),
        # Step-level flags
        "llm_extracted": res.selectors is not None,
        "browser_loaded": res.browser_loaded,
        "surveys_injected": res.survey_containers,
        "form_accessible": res.form_frames > 0,
        "form_submitted": res.form_submitted,
        "data_validated": res.submission_validated,
        # Verdict
        "success": fail is None,
        "failure_step": fail,
        "error": res.error,
    }


# ── Single-fixture runner ─────────────────────────────────────────────────────

async def _run_one(
    fixture_rel: str,
    platform: str,
    year: str,
    context: str,
    llm_only: bool,
    block_spa_scripts: bool | None = None,
    survey_type: str | None = None,
    strip_csp: bool = False,
) -> tuple[dict, HealerResult]:
    fixture_path = _ROOT / fixture_rel
    if not fixture_path.exists():
        print(f"  ⚠️  File not found, skipping: {fixture_rel}")
        res = HealerResult(fixture=fixture_rel, error="File not found")
        return _result_record(fixture_rel, platform, year, res, 0, llm_only), res

    healer = SelectorHealer(
        fixture_path=fixture_path,
        platform=platform,
        output_dir=_SELECTORS_DIR,
        max_llm_retries=3,
        extra_context=context or None,
        block_spa_scripts=block_spa_scripts,
        survey_type=survey_type,
        strip_csp=strip_csp,
    )

    t0 = asyncio.get_event_loop().time()

    if llm_only:
        # Steps 1-2 only, no browser
        res = HealerResult(fixture=fixture_rel)
        try:
            res.offline_post_count, res.offline_warnings = healer._step1_validate_offline()
            with open(fixture_path, encoding="utf-8", errors="replace") as f:
                html = f.read()
            res.selectors = healer._step2_extract_selectors(html)
        except Exception as exc:
            res.error = str(exc)
            _tb.print_exc()
    else:
        try:
            res = await healer.run()
        except Exception as exc:
            res = HealerResult(fixture=fixture_rel, error=str(exc))
            _tb.print_exc()

    duration = asyncio.get_event_loop().time() - t0

    # Move screenshot to experiment/results/screenshots/
    if res.screenshot_path:
        src = Path(res.screenshot_path)
        if src.exists():
            dest = _SCREENSHOTS_DIR / f"{platform}_{year}_{src.name}"
            shutil.copy2(src, dest)

    return _result_record(fixture_rel, platform, year, res, duration, llm_only), res


# ── Summary table ─────────────────────────────────────────────────────────────

def _print_table(records: list[dict]) -> None:
    print("\n" + "=" * 90)
    print("BATCH EVALUATION SUMMARY")
    print("=" * 90)
    header = f"{'Platform':<14} {'Year':<6} {'LLM':^5} {'Inject':^7} {'Submit':^7} {'Validate':^9} {'Result':<20} {'Fixture'}"
    print(header)
    print("-" * 90)

    passed = 0
    for r in records:
        ok = lambda v: "✅" if v else "❌"
        result_str = "✅ PASS" if r["success"] else f"❌ FAIL @ {r['failure_step'] or 'unknown'}"
        fixture_name = Path(r["fixture"]).name
        print(
            f"{r['platform']:<14} {r['year']:<6} "
            f"{ok(r['llm_extracted']):^5} "
            f"{ok(r['surveys_injected'])  :^7} "
            f"{ok(r['form_submitted']):^7} "
            f"{ok(r['data_validated']):^9} "
            f"{result_str:<30} {fixture_name}"
        )
        if r["success"]:
            passed += 1

    total = len(records)
    print("-" * 90)
    print(f"\nOverall: {passed}/{total} passed ({100*passed//total if total else 0}%)\n")

    # Breakdown by platform
    from collections import defaultdict
    by_platform: dict = defaultdict(lambda: {"pass": 0, "total": 0})
    for r in records:
        by_platform[r["platform"]]["total"] += 1
        if r["success"]:
            by_platform[r["platform"]]["pass"] += 1

    print("By platform:")
    for plat, counts in sorted(by_platform.items()):
        pct = 100 * counts["pass"] // counts["total"] if counts["total"] else 0
        print(f"  {plat:<14} {counts['pass']}/{counts['total']} ({pct}%)")

    # Failure breakdown
    failures = [r for r in records if not r["success"]]
    if failures:
        from collections import Counter
        step_counts = Counter(r["failure_step"] for r in failures)
        print("\nFailure breakdown by step:")
        for step, count in step_counts.most_common():
            print(f"  {step}: {count} fixture(s)")


# ── Entry point ───────────────────────────────────────────────────────────────

async def _main(args: argparse.Namespace) -> None:
    _SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    _SELECTORS_DIR.mkdir(parents=True, exist_ok=True)

    # Filter fixtures if --fixture was supplied
    fixtures_to_run = FIXTURES
    if args.fixture:
        needle = args.fixture.replace("\\", "/")
        fixtures_to_run = [f for f in FIXTURES if needle in f[0]]
        if not fixtures_to_run:
            print(f"❌ No fixture matched '{args.fixture}'")
            print("Available fixtures:")
            for f in FIXTURES:
                print(f"  {f[0]}")
            sys.exit(1)

    # Tee all output to a log file
    import io
    log_path = _RESULTS_DIR / f"batch_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    _log_file = open(log_path, "w", buffering=1)

    _orig_stdout = sys.stdout
    _orig_stderr = sys.stderr

    class _Tee:
        def __init__(self, *streams): self._s = streams
        def write(self, data):
            for s in self._s: s.write(data)
        def flush(self):
            for s in self._s: s.flush()

    sys.stdout = _Tee(_orig_stdout, _log_file)
    sys.stderr = _Tee(_orig_stderr, _log_file)

    print(f"🔧  Social Annotate — Batch Evaluation")
    print(f"    Fixtures : {len(fixtures_to_run)}")
    print(f"    Mode     : {'LLM-only (no browser)' if args.llm_only else 'Full 11-step'}")
    print(f"    Log      : {log_path}")
    print(f"    Output   : {_RESULTS_DIR}\n")

    records = []
    all_results = []

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = _RESULTS_DIR / f"batch_results_{timestamp}.json"
    latest_path = _RESULTS_DIR / "batch_results_latest.json"
    mode_str = "llm_only" if args.llm_only else "full"

    def _save():
        payload = {"timestamp": timestamp, "mode": mode_str, "results": all_results}
        with open(out_path, "w") as f:
            json.dump(payload, f, indent=2, cls=_Encoder)
        shutil.copy2(out_path, latest_path)

    for i, (fixture_rel, platform, year, context, block_spa, survey_type, strip_csp) in enumerate(fixtures_to_run, 1):
        print(f"\n{'='*60}")
        print(f"[{i}/{len(fixtures_to_run)}] {platform.upper()} {year} — {Path(fixture_rel).name}")
        print(f"{'='*60}")

        record, res = await _run_one(fixture_rel, platform, year, context, args.llm_only, block_spa, survey_type, strip_csp)
        records.append(record)
        all_results.append({"record": record, "detail": asdict(res)})
        _save()  # save after every fixture so a crash doesn't lose results

        # Print per-fixture result immediately
        ok = lambda v: "✅" if v else "❌"
        print(f"\n┌─ RESULT [{i}/{len(fixtures_to_run)}] {platform.upper()} {year} ─────────────────────")
        print(f"│  LLM extraction : {ok(record['llm_extracted'])}")
        print(f"│  Survey injected: {ok(record['surveys_injected'])}")
        print(f"│  Form submitted : {ok(record['form_submitted'])}")
        print(f"│  Data validated : {ok(record['data_validated'])}")
        if record['success']:
            print(f"│  → ✅ PASS")
        else:
            print(f"│  → ❌ FAIL @ {record['failure_step']}")
        if record['error']:
            print(f"│  Error: {record['error']}")
        print(f"└──────────────────────────────────────────────────────")

    print(f"\n📄 Full results saved to: {out_path}")
    print(f"📋 Full log saved to    : {log_path}")

    _print_table(records)

    sys.stdout = _orig_stdout
    sys.stderr = _orig_stderr
    _log_file.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Batch evaluation of the self-healing selector agent.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--llm-only", action="store_true",
        help="Run steps 1-2 only (offline, no browser). Fast but no injection/submission check."
    )
    parser.add_argument(
        "--fixture", "-f", default=None,
        help="Run a single fixture (partial path match, e.g. 'twitter_2014' or 'whatsapp/sample')."
    )
    args = parser.parse_args()
    try:
        asyncio.run(_main(args))
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted.")
        sys.exit(1)
