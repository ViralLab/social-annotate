"""
SelectorHealer — 11-step self-healing selector agent.

Steps:
  1. Offline HTML validation (BeautifulSoup post count, missing _files/ warning)
  2. LLM selector extraction with retry loop
  3. Open fixture in browser with new selectors loaded
  4. Wait for extension injection (+ scroll to trigger MutationObserver)
  5. Screenshot
  6. Verify injection (count survey containers + shadow DOM iframes)
  7. Check form accessibility via page.frames
  8. Fill first available form option + click submit
  9. Validate submission (button 'Done!' state)
 10. Write new selectors to temp JSON (never touches src/selectors.json)
 11. Present diff vs current src/selectors.json
"""

import asyncio
import itertools
import json
import sys
import threading
import time as _time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

from agents.llm_client import get_llm_client
from agents.registry import REGISTRY

_PROJECT_ROOT = Path(__file__).resolve().parent.parent

from agents.browser_env import ExtensionBrowserEnv


# ──────────────────────────────────────────────────────────────────────────────
# Spinners
# ──────────────────────────────────────────────────────────────────────────────

_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]


class _Spinner:
    """Sync spinner — use as a context manager around blocking calls."""

    def __init__(self, message: str):
        self._msg = message
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        for frame in itertools.cycle(_FRAMES):
            if self._stop.is_set():
                break
            sys.stdout.write(f"\r    {frame}  {self._msg}")
            sys.stdout.flush()
            _time.sleep(0.08)
        sys.stdout.write(f"\r{' ' * (len(self._msg) + 8)}\r")
        sys.stdout.flush()

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *_):
        self._stop.set()
        self._thread.join()


async def _spin_while(message: str, coro):
    """Async spinner — wraps an awaitable and animates until it resolves."""
    stop = asyncio.Event()

    async def _anim():
        for frame in itertools.cycle(_FRAMES):
            if stop.is_set():
                break
            sys.stdout.write(f"\r    {frame}  {message}")
            sys.stdout.flush()
            await asyncio.sleep(0.08)
        sys.stdout.write(f"\r{' ' * (len(message) + 8)}\r")
        sys.stdout.flush()

    anim_task = asyncio.create_task(_anim())
    try:
        return await coro
    finally:
        stop.set()
        await anim_task


# ──────────────────────────────────────────────────────────────────────────────
# HTML pruning
# ──────────────────────────────────────────────────────────────────────────────

_PRUNE_TEXT_THRESHOLD = 50   # collapse text nodes longer than this
_PRUNE_MAX_CHARS = 80_000    # truncate pruned HTML if still too large


_ATTR_MAX_LEN = 120   # truncate long attribute values (e.g. proxy image URLs)


def _prune_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    # Remove non-content elements
    for tag in soup(["script", "style", "svg", "path", "iframe", "noscript",
                     "link", "meta", "head", "nav", "header", "footer", "aside"]):
        tag.decompose()

    for text_node in soup.find_all(string=True):
        if len(text_node.strip()) > _PRUNE_TEXT_THRESHOLD:
            text_node.replace_with("…")

    for tag in soup.find_all(True):
        tag.attrs.pop("style", None)
        # Truncate long attribute values (data URIs, proxy URLs, etc.)
        for attr, val in list(tag.attrs.items()):
            if isinstance(val, str) and len(val) > _ATTR_MAX_LEN:
                tag.attrs[attr] = val[:_ATTR_MAX_LEN] + "…"

    result = str(soup)
    return result[:_PRUNE_MAX_CHARS] if len(result) > _PRUNE_MAX_CHARS else result


# Prompt templates live in each platform agent. No global template here.


# ──────────────────────────────────────────────────────────────────────────────
# Result dataclass
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class HealerResult:
    fixture: str
    # Step 1
    offline_post_count: int = 0
    offline_warnings: list = field(default_factory=list)
    # Step 2
    selectors: Any | None = None
    llm_attempts: int = 0
    # Step 3
    browser_loaded: bool = False
    resource_404s: list = field(default_factory=list)
    # Step 6
    survey_containers: int = 0
    survey_iframes: int = 0
    # Step 5
    screenshot_path: str | None = None
    # Steps 7–9
    form_frames: int = 0
    form_submitted: bool = False
    submission_validated: bool = False
    # Step 10
    output_path: str | None = None
    # Error
    error: str | None = None


# ──────────────────────────────────────────────────────────────────────────────
# Healer
# ──────────────────────────────────────────────────────────────────────────────

class SelectorHealer:
    """Orchestrates all 11 steps for a single fixture + platform."""

    def __init__(
        self,
        fixture_path: str | Path,
        platform: str = "x",
        output_dir: str | Path = "agents/output",
        max_llm_retries: int = 3,
        extra_context: str | None = None,
    ):
        if platform not in REGISTRY:
            raise ValueError(
                f"Unknown platform '{platform}'. Supported: {sorted(REGISTRY)}"
            )
        self.fixture_path = Path(fixture_path).resolve()
        self.platform = platform
        self.platform_agent = REGISTRY[platform]
        self.survey_type = self.platform_agent.survey_type
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.max_llm_retries = max_llm_retries
        self.extra_context = extra_context.strip() if extra_context else None
        self.llm = get_llm_client()

    # ── Phase 1: Offline ──────────────────────────────────────────────────────

    def _step1_validate_offline(self) -> tuple[int, list[str]]:
        print("\n── Step 1: Offline HTML validation ──")

        with open(self.fixture_path, encoding="utf-8", errors="replace") as f:
            html = f.read()

        soup = BeautifulSoup(html, "html.parser")

        posts: list = []
        for sel in self.platform_agent.offline_selectors:
            posts = soup.select(sel)
            if posts:
                break

        warnings = []
        files_dir = self.fixture_path.parent / (self.fixture_path.stem + "_files")
        if not files_dir.exists():
            warnings.append(
                f"No companion _files/ dir at '{files_dir.name}' — "
                "linked assets may 404 in browser."
            )

        print(f"  Posts detected (BeautifulSoup): {len(posts)}")
        for w in warnings:
            print(f"  ⚠️  {w}")

        if len(posts) == 0:
            print(
                "  ⚠️  Zero posts found with common selectors. "
                "LLM will analyze raw HTML structure."
            )

        return len(posts), warnings

    def _step2_extract_selectors(self, html: str) -> Any:
        print("\n── Step 2: LLM selector extraction ──")

        pruned = _prune_html(html)
        print(f"  HTML: {len(html):,} chars → pruned: {len(pruned):,} chars")

        soup = BeautifulSoup(html, "html.parser")
        error_feedback: str | None = None

        context_section = (
            f"\nUSER CONTEXT — take this into account when generating selectors:\n"
            f"{self.extra_context}\n"
            if self.extra_context else ""
        )

        for attempt in range(1, self.max_llm_retries + 1):
            print(f"  Attempt {attempt}/{self.max_llm_retries} …")
            error_section = (
                f"\nPREVIOUS ERROR — do NOT repeat these selectors: {error_feedback}\n"
                if error_feedback else ""
            )
            prompt = (
                self.platform_agent.prompt_template
                .replace("{context_section}", context_section)
                .replace("{error_section}", error_section)
                .replace("{html}", pruned)
            )

            try:
                with _Spinner(f"Calling LLM (attempt {attempt}/{self.max_llm_retries}) …"):
                    result = self.llm.generate_structured(prompt, self.platform_agent.schema_class)
                error = self.platform_agent.validate_fn(soup, result)
                if error is None:
                    print(f"  ✅ Validated on attempt {attempt}")
                    return result
                print(f"  ❌ Validation: {error}")
                error_feedback = error
            except KeyboardInterrupt:
                raise
            except BaseException as exc:
                print(f"  ❌ LLM error ({type(exc).__name__}): {exc}")
                traceback.print_exc()
                error_feedback = str(exc)

        raise RuntimeError(
            f"Could not extract valid selectors after {self.max_llm_retries} attempts."
        )

    # ── Phase 2: Browser ──────────────────────────────────────────────────────

    async def _push_selectors_to_storage(
        self, env: ExtensionBrowserEnv, new_selectors: dict
    ) -> None:
        """Write new selectors + pre-accept consent into chrome.storage.local."""
        await env._wait_for_storage_init()
        sw = await env._get_service_worker()
        payload = json.dumps(new_selectors)
        consent_key = f"consentGiven_{self.platform}"
        await sw.evaluate(
            f"""() => new Promise((res, rej) => {{
                chrome.storage.local.set({{
                    selectors: {payload},
                    "{consent_key}": true
                }}, () => {{
                    chrome.runtime.lastError
                        ? rej(chrome.runtime.lastError.message)
                        : res();
                }});
            }})"""
        )

    async def _step3_open_browser(
        self, env: ExtensionBrowserEnv, new_selectors: dict
    ):
        """
        Load fixture in browser.
        Sets survey type + new selectors in one shot, then reloads once.
        Returns (page, list_of_404_urls).
        """
        print("\n── Step 3: Open in browser with new selectors ──")

        failed_urls: list[str] = []

        block_scripts = self.platform_agent.block_spa_scripts

        # Initial load (seeds extension storage via onInstalled)
        page = await env.open_file(self.fixture_path, block_spa_scripts=block_scripts)

        # Track 404s from this point on
        page.on("response", lambda r: failed_urls.append(r.url) if r.status == 404 else None)

        # Batch-set survey type + new selectors, then single reload
        await env.set_active_survey(self.survey_type)
        await self._push_selectors_to_storage(env, new_selectors)
        # Use "load" for SPA platforms: waits for HTML-referenced resources but not
        # async fetches (which never settle on offline fixtures hitting missing CDN).
        # "domcontentloaded" for script-blocked platforms where CSS is static.
        reload_wait = "domcontentloaded" if block_scripts else "load"
        try:
            await _spin_while("Reloading page with new selectors …", page.reload(wait_until=reload_wait, timeout=45_000))
        except Exception:
            await _spin_while("Reloading (fallback) …", page.reload(wait_until="domcontentloaded", timeout=30_000))

        if failed_urls:
            print(f"  ⚠️  {len(failed_urls)} resource(s) returned 404 (non-critical):")
            for url in failed_urls[:5]:
                print(f"     {url[:120]}")

        print(f"  Page URL: {page.url}")
        return page, failed_urls

    async def _step4_wait_for_injection(self, page, wait_secs: float = 4.0) -> None:
        """Pause and scroll to trigger MutationObserver + delayed rescan."""
        print(f"\n── Step 4: Waiting {wait_secs}s for extension injection ──")
        await _spin_while("Waiting for extension to inject …", asyncio.sleep(wait_secs / 2))
        await page.evaluate("window.scrollTo(0, 500)")
        await _spin_while("Scrolling to trigger MutationObserver …", asyncio.sleep(wait_secs / 2))
        await page.evaluate("window.scrollTo(0, 0)")

    async def _step5_screenshot(self, page) -> Path:
        """Scroll slightly down and capture a viewport screenshot."""
        print("\n── Step 5: Screenshot ──")
        await page.evaluate("window.scrollTo(0, 250)")
        await _spin_while("Capturing screenshot …", page.screenshot(path=str(
            self.output_dir / f"{self.fixture_path.stem}_injection.png"
        )))
        path = self.output_dir / f"{self.fixture_path.stem}_injection.png"
        print(f"  📸 {path}")
        return path

    async def _step6_verify_injection(self, page) -> dict:
        """Count survey containers and shadow DOM iframes in the live page."""
        print("\n── Step 6: Verify injection ──")

        counts = await page.evaluate("""() => {
            const sel = '.survey-container-post, .survey-container-tweet, .survey-container-user';
            const containers = document.querySelectorAll(sel);
            let iframes = 0;
            for (const c of containers) {
                if (c.shadowRoot && c.shadowRoot.querySelector('iframe')) iframes++;
            }
            return { containers: containers.length, iframes };
        }""")

        print(f"  Survey containers : {counts['containers']}")
        print(f"  Shadow iframes    : {counts['iframes']}")

        if counts["containers"] == 0:
            print(
                "  ❌ No survey containers — new selectors may not match this fixture."
            )
        else:
            print("  ✅ Injection confirmed.")

        return counts

    async def _step7_check_form_frames(self, page) -> dict:
        """
        Verify survey iframes are accessible via Playwright's page.frames.
        Extension iframes (chrome-extension://…/sandbox/survey.html) appear in this list.
        """
        print("\n── Step 7: Check form accessibility ──")

        survey_frames = [f for f in page.frames if "survey.html" in f.url]
        print(f"  Survey frames via page.frames: {len(survey_frames)}")

        has_form = False
        if survey_frames:
            has_form = await survey_frames[0].evaluate(
                "() => !!document.querySelector('#surveyForm, form')"
            )
            print(f"  Form element present: {has_form}")

        return {"frames": len(survey_frames), "has_form": has_form}

    async def _step8_fill_and_submit(self, page) -> dict:
        """
        For each accessible survey iframe: select the first radio/checkbox,
        click submit, and check if the button transitions to 'Done!'.
        """
        print("\n── Step 8: Fill and submit form ──")

        survey_frames = [f for f in page.frames if "survey.html" in f.url]
        if not survey_frames:
            print("  ⚠️  No survey frames — skipping.")
            return {"frames_found": 0, "submitted": False}

        submitted = 0
        for i, frame in enumerate(survey_frames):
            try:
                # Select first available input
                chosen = await frame.evaluate("""() => {
                    const radio = document.querySelector('input[type="radio"]');
                    if (radio) { radio.click(); return 'radio'; }
                    const cb = document.querySelector('input[type="checkbox"]');
                    if (cb) { cb.click(); return 'checkbox'; }
                    return null;
                }""")
                if chosen:
                    print(f"  Frame {i}: selected {chosen}")

                await frame.click(
                    '.surveySubmitBtn, button[type="submit"], input[type="submit"]',
                    timeout=4000,
                )
                await _spin_while("Waiting for submission response …", asyncio.sleep(1.5))

                btn = await frame.text_content(".surveySubmitBtn")
                done = btn and ("Done" in btn or "Submitted" in btn)
                print(
                    f"  Frame {i}: {'✅' if done else '⚠️ '} button text = '{(btn or '').strip()}'"
                )
                if done:
                    submitted += 1

            except Exception as exc:
                print(f"  Frame {i}: ❌ {exc}")

        return {"frames_found": len(survey_frames), "submitted": submitted > 0}

    async def _step9_validate_capture(self, env: ExtensionBrowserEnv) -> bool:
        """
        Read the last submitted entry from chrome.storage.local.resultsArrays
        and verify that critical fields (post_id, created_at, post_metrics) are
        actually populated — not just that the form was submitted.
        """
        print("\n── Step 9: Validate captured data ──")

        sw = await env._get_service_worker()

        # resultsArrays is keyed by surveyType (e.g. 'x-post')
        survey_type = self.survey_type  # e.g. "x-post"
        storage = await sw.evaluate(f"""() => new Promise((resolve) => {{
            chrome.storage.local.get(['resultsArrays'], (r) => resolve(r));
        }})""")

        results_arrays = storage.get("resultsArrays") or {}
        entries = results_arrays.get(survey_type) or []

        if not entries:
            print(f"  ⚠️  No entries found in resultsArrays['{survey_type}'].")
            return False

        # Check the last submitted entry
        entry = entries[-1]
        post_id    = entry.get("post_id") or entry.get("account_id") or ""
        created_at = entry.get("created_at") or ""
        body       = entry.get("body") or ""
        metrics    = entry.get("post_metrics") or {}
        media_urls = entry.get("media_urls") or []

        print(f"  post_id    : {post_id!r}")
        print(f"  created_at : {created_at!r}")
        print(f"  body       : {body[:80]!r}{'…' if len(body) > 80 else ''}")
        print(f"  post_metrics: {metrics}")
        print(f"  media_urls : {len(media_urls)} URL(s)")

        issues = []
        if not post_id:
            issues.append("post_id is empty — postTimestamp / postContainer may not extract the post ID")
        if not created_at:
            issues.append("created_at is empty — postTimestamp selector may be wrong")
        if metrics and all(v == 0 for v in metrics.values()):
            issues.append("all metric values are 0 — metrics selectors may not match")
        elif not metrics:
            issues.append("post_metrics is empty — metric selectors produced nothing")

        if issues:
            for iss in issues:
                print(f"  ⚠️  {iss}")
            return False

        print("  ✅ Captured data looks valid.")
        return True

    # ── Phase 3: Output ───────────────────────────────────────────────────────

    def _step10_write_temp_selectors(self, new_selectors: dict) -> Path:
        """Write proposed selectors to a temp file. Never touches src/selectors.json."""
        print("\n── Step 10: Write temp selectors ──")

        out = self.output_dir / f"{self.fixture_path.stem}_selectors.json"
        with open(out, "w") as f:
            json.dump(new_selectors, f, indent=2)
        print(f"  📄 {out}")
        return out

    def _step11_present_diff(self, new_selectors: dict) -> None:
        """Print a human-readable diff of new vs existing src/selectors.json."""
        print("\n── Step 11: Review diff ──")

        src_path = _PROJECT_ROOT / "src" / "selectors.json"
        if not src_path.exists():
            print("  ℹ️  src/selectors.json not found — no diff to show.")
            return

        with open(src_path) as f:
            existing = json.load(f)

        def _flatten(d: dict, prefix: str = "") -> dict:
            out: dict = {}
            for k, v in d.items():
                key = f"{prefix}.{k}" if prefix else k
                if isinstance(v, dict):
                    out.update(_flatten(v, key))
                else:
                    out[key] = v
            return out

        old_flat = _flatten(existing.get(self.platform, {}))
        new_flat = _flatten(new_selectors.get(self.platform, {}))

        changed = [
            (k, old_flat.get(k), new_flat.get(k))
            for k in sorted(set(old_flat) | set(new_flat))
            if old_flat.get(k) != new_flat.get(k)
        ]

        if not changed:
            print("  ✅ Generated selectors match src/selectors.json exactly.")
        else:
            print(f"  {len(changed)} field(s) differ:\n")
            for key, old_val, new_val in changed:
                print(f"  {key}")
                print(f"    current : {old_val!r}")
                print(f"    proposed: {new_val!r}")

    # ── Orchestrator ──────────────────────────────────────────────────────────

    async def run(self) -> HealerResult:
        """Execute all 11 steps. Returns HealerResult summary."""
        res = HealerResult(fixture=str(self.fixture_path))

        # ── Phase 1: Offline ──────────────────────────────────────────────
        try:
            res.offline_post_count, res.offline_warnings = self._step1_validate_offline()
        except Exception as exc:
            res.error = f"Step 1: {exc}"
            print(f"\n❌ {res.error}")
            traceback.print_exc()
            return res

        with open(self.fixture_path, encoding="utf-8", errors="replace") as f:
            html = f.read()

        try:
            llm_result = self._step2_extract_selectors(html)
            res.selectors = llm_result
        except Exception as exc:
            res.error = f"Step 2: {exc}"
            print(f"\n❌ {res.error}")
            traceback.print_exc()
            return res

        # Load existing selectors to preserve non-LLM fields
        src_sel_path = _PROJECT_ROOT / "src" / "selectors.json"
        existing_sel: dict = {}
        if src_sel_path.exists():
            with open(src_sel_path) as f:
                existing_sel = json.load(f)

        new_selectors = self.platform_agent.to_nested_fn(llm_result, existing_sel)

        # ── Phase 2: Browser ──────────────────────────────────────────────
        env = ExtensionBrowserEnv()
        await env.start()

        try:
            page, res.resource_404s = await self._step3_open_browser(env, new_selectors)
            res.browser_loaded = True

            await self._step4_wait_for_injection(page)

            shot = await self._step5_screenshot(page)
            res.screenshot_path = str(shot)

            inj = await self._step6_verify_injection(page)
            res.survey_containers = inj["containers"]
            res.survey_iframes = inj["iframes"]

            form_check = await self._step7_check_form_frames(page)
            res.form_frames = form_check["frames"]

            if form_check["frames"] > 0:
                submit = await self._step8_fill_and_submit(page)
                res.form_submitted = submit["submitted"]

                if res.form_submitted:
                    res.submission_validated = await self._step9_validate_capture(env)

        except Exception as exc:
            print(f"\n❌ Browser phase error: {exc}")
            traceback.print_exc()
            res.error = f"Browser: {exc}"

        finally:
            await env.close()

        # ── Phase 3: Output ───────────────────────────────────────────────
        out = self._step10_write_temp_selectors(new_selectors)
        res.output_path = str(out)

        self._step11_present_diff(new_selectors)

        # ── Summary ───────────────────────────────────────────────────────
        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print(f"  Fixture        : {self.fixture_path.name}")
        print(f"  Posts (offline): {res.offline_post_count}")
        print(f"  Surveys injected: {res.survey_containers}")
        print(f"  Form submitted : {'✅' if res.form_submitted else '❌'}")
        print(f"  Screenshot     : {res.screenshot_path}")
        print(f"  Temp selectors : {res.output_path}")
        if res.error:
            print(f"  Error          : {res.error}")
        print()

        return res
