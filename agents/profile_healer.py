"""
Self-healing profile selector agent.

Companion to healer.py — handles user/profile page HTML fixtures.
Produces selectors for the account section of selectors.json only;
the shared and post sections are preserved from the existing file.

Steps:
1.  Offline HTML check  — count profile selectors found by BeautifulSoup
2.  LLM extraction      — generate account selectors from pruned HTML
3.  Open in browser     — load fixture with extension + new selectors
4.  Wait for injection  — pause for survey-container-user to appear
5.  Screenshot          — capture viewport
6.  Verify injection    — confirm survey-container-user count
7.  Check form frames   — verify survey iframe accessible
8.  Fill & submit       — select an option and submit
9.  Validate capture    — check resultsArrays['x-user'] in storage
10. Write temp selectors — dump JSON (never touches src/selectors.json)
11. Present diff        — show delta vs current selectors.json
"""

import asyncio
import json
import sys
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

# Reuse utilities from healer without modifying it
from agents.healer import _prune_html, _spin_while, _Spinner  # noqa: F401 (re-exported)
from agents.llm_client import get_llm_client
from agents.browser_env import ExtensionBrowserEnv
from agents.base_agent import PlatformAgent

_PROJECT_ROOT = Path(__file__).resolve().parent.parent


# ──────────────────────────────────────────────────────────────────────────────
# Result dataclass
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class ProfileHealerResult:
    fixture: str
    offline_selectors_found: int = 0
    offline_warnings: list = field(default_factory=list)
    selectors: Any | None = None
    browser_loaded: bool = False
    survey_visible: bool = False
    form_submitted: bool = False
    submission_validated: bool = False
    screenshot_path: str = ""
    output_path: str = ""
    error: str = ""


# ──────────────────────────────────────────────────────────────────────────────
# ProfileHealer
# ──────────────────────────────────────────────────────────────────────────────

class ProfileHealer:
    def __init__(
        self,
        fixture_path: str | Path,
        platform: str,
        profile_agent: PlatformAgent,
        max_llm_retries: int = 3,
        extra_context: str | None = None,
    ):
        self.fixture_path = Path(fixture_path)
        self.platform = platform
        self.profile_agent = profile_agent
        self.survey_type = profile_agent.survey_type
        self.max_llm_retries = max_llm_retries
        self.extra_context = extra_context
        self.output_dir = _PROJECT_ROOT / "agents" / "output"
        self.output_dir.mkdir(exist_ok=True)
        self._llm = get_llm_client()

    # ── Phase 1: Offline ──────────────────────────────────────────────────────

    def _step1_validate_offline(self) -> tuple[int, list[str]]:
        print("\n── Step 1: Offline HTML validation ──")
        warnings: list[str] = []

        with open(self.fixture_path, encoding="utf-8", errors="replace") as f:
            html = f.read()
        soup = BeautifulSoup(html, "html.parser")

        found = 0
        for sel in self.profile_agent.offline_selectors:
            if soup.select(sel):
                found += 1
                print(f"  ✅ {sel}")
            else:
                print(f"  –  {sel} (no match)")

        if found == 0:
            msg = "Zero profile selectors matched. LLM will analyze raw HTML structure."
            print(f"  ⚠️  {msg}")
            warnings.append(msg)
        else:
            print(f"  Profile selectors matched: {found}/{len(self.profile_agent.offline_selectors)}")

        return found, warnings

    def _step2_extract_selectors(self, html: str):
        print("\n── Step 2: LLM selector extraction ──")

        pruned = _prune_html(html)
        print(f"  HTML: {len(html):,} chars → pruned: {len(pruned):,} chars")

        schema = self.profile_agent.schema_class
        validate = self.profile_agent.validate_fn
        template = self.profile_agent.prompt_template

        soup = BeautifulSoup(html, "html.parser")
        error_feedback: str | None = None

        for attempt in range(1, self.max_llm_retries + 1):
            print(f"  Attempt {attempt}/{self.max_llm_retries} …")

            context_section = (
                f"\nEXTRA CONTEXT:\n{self.extra_context}\n"
                if self.extra_context else ""
            )
            error_section = (
                f"\nPREVIOUS ATTEMPT FAILED:\n{error_feedback}\nFix the issue above.\n"
                if error_feedback else ""
            )

            prompt = (
                template
                .replace("{context_section}", context_section)
                .replace("{error_section}", error_section)
                .replace("{html}", pruned)
            )

            with _Spinner(f"Calling LLM (attempt {attempt}/{self.max_llm_retries}) …"):
                result = self._llm.generate_structured(prompt, schema)

            err = validate(soup, result)
            if err:
                print(f"  ❌ Validation: {err}")
                error_feedback = err
            else:
                print(f"  ✅ Selectors validated.")
                return result

        raise RuntimeError(
            f"Could not extract valid profile selectors after {self.max_llm_retries} attempts."
        )

    # ── Phase 2: Browser ──────────────────────────────────────────────────────

    async def _push_selectors_to_storage(self, env: ExtensionBrowserEnv, new_selectors: dict) -> None:
        await env._wait_for_storage_init()
        sw = await env._get_service_worker()
        payload = json.dumps(new_selectors)
        consent_key = f"consentGiven_{self.platform}"
        # isEnabled must be true: injectTwitterUserSurvey is gated on it (unlike post
        # injection which uses a MutationObserver that runs unconditionally).
        await sw.evaluate(
            f"""() => new Promise((res, rej) => {{
                chrome.storage.local.set({{
                    selectors: {payload},
                    isEnabled: true,
                    "{consent_key}": true
                }}, () => {{
                    chrome.runtime.lastError
                        ? rej(chrome.runtime.lastError.message)
                        : res();
                }});
            }})"""
        )

    async def _step3_open_browser(self, env: ExtensionBrowserEnv, new_selectors: dict):
        print("\n── Step 3: Open in browser with new selectors ──")
        failed_urls: list[str] = []

        page = await env.open_file(
            self.fixture_path,
            block_spa_scripts=self.profile_agent.block_spa_scripts,
        )
        page.on("response", lambda r: failed_urls.append(r.url) if r.status == 404 else None)


        await env.set_active_survey(self.survey_type)
        await self._push_selectors_to_storage(env, new_selectors)

        reload_wait = (
            "domcontentloaded" if self.profile_agent.block_spa_scripts else "load"
        )
        try:
            await _spin_while(
                "Reloading page with new selectors …",
                page.reload(wait_until=reload_wait, timeout=45_000),
            )
        except Exception:
            await _spin_while(
                "Reloading (fallback) …",
                page.reload(wait_until="domcontentloaded", timeout=30_000),
            )

        if failed_urls:
            print(f"  ⚠️  {len(failed_urls)} resource(s) returned 404 (non-critical).")
        print(f"  Page URL: {page.url}")
        return page, failed_urls

    async def _step4_wait_for_injection(self, page, wait_secs: float = 3.0) -> None:
        print(f"\n── Step 4: Waiting {wait_secs}s for extension injection ──")
        await _spin_while("Waiting for user survey injection …", asyncio.sleep(wait_secs))

    async def _step5_screenshot(self, page) -> Path:
        print("\n── Step 5: Screenshot ──")
        await page.evaluate("window.scrollTo(0, 250)")
        path = self.output_dir / f"{self.fixture_path.stem}_profile_injection.png"
        await _spin_while("Capturing screenshot …", page.screenshot(path=str(path)))
        print(f"  📸 {path}")
        return path

    async def _step6_verify_injection(self, page) -> bool:
        print("\n── Step 6: Verify injection ──")
        info = await page.evaluate("""() => {
            const appRoot = document.querySelector('#doc') || document.querySelector('#react-root') || document.body;
            const bodySiblings = Array.from(document.body.children).map(el => el.tagName + (el.id ? '#'+el.id : '') + (el.className ? '.'+[...el.classList].join('.') : '')).slice(0, 8);
            return {
                containerCount: document.querySelectorAll('.survey-container-user').length,
                anySurveyEl: document.querySelectorAll('[class*="survey-container"]').length,
                appRootExists: !!appRoot,
                bodyChildren: bodySiblings,
            };
        }""")
        print(f"  survey-container-user : {info['containerCount']}")
        print(f"  any survey-container  : {info['anySurveyEl']}")
        print(f"  appRoot found         : {info['appRootExists']}")
        print(f"  <body> first children : {info['bodyChildren']}")
        if info["containerCount"] == 0:
            print("  ❌ No user survey container found.")
            return False
        print("  ✅ User survey injection confirmed.")
        return True

    async def _step7_check_form_frames(self, page) -> dict:
        print("\n── Step 7: Check form accessibility ──")
        survey_frames = [f for f in page.frames if "survey.html" in f.url]
        print(f"  Survey frames: {len(survey_frames)}")
        has_form = False
        if survey_frames:
            has_form = await survey_frames[0].evaluate(
                "() => !!document.querySelector('#surveyForm, form')"
            )
            print(f"  Form element present: {has_form}")
        return {"frames": len(survey_frames), "has_form": has_form}

    async def _step8_fill_and_submit(self, page) -> dict:
        print("\n── Step 8: Fill and submit form ──")
        survey_frames = [f for f in page.frames if "survey.html" in f.url]
        if not survey_frames:
            print("  ⚠️  No survey frames — skipping.")
            return {"submitted": False}

        submitted = 0
        for i, frame in enumerate(survey_frames):
            try:
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
                await _spin_while("Waiting for submission …", asyncio.sleep(1.5))

                btn = await frame.text_content(".surveySubmitBtn")
                done = btn and ("Done" in btn or "Submitted" in btn)
                print(f"  Frame {i}: {'✅' if done else '⚠️ '} button = '{(btn or '').strip()}'")
                if done:
                    submitted += 1
            except Exception as exc:
                print(f"  Frame {i}: ❌ {exc}")

        return {"submitted": submitted > 0}

    async def _step9_validate_capture(self, env: ExtensionBrowserEnv) -> bool:
        print("\n── Step 9: Validate captured data ──")
        sw = await env._get_service_worker()
        storage = await sw.evaluate("""() => new Promise((resolve) => {
            chrome.storage.local.get(['resultsArrays'], (r) => resolve(r));
        })""")

        entries = (storage.get("resultsArrays") or {}).get(self.survey_type) or []
        if not entries:
            print(f"  ⚠️  No entries in resultsArrays['{self.survey_type}'].")
            return False

        entry = entries[-1]
        account_group = entry.get("account") or {}
        account_id    = entry.get("account_id") or ""
        profile_name  = account_group.get("profile_name") or ""
        handle        = account_group.get("handle") or ""

        print(f"  account_id   : {account_id!r}")
        print(f"  account      : {json.dumps(account_group, ensure_ascii=False)[:120]}")

        issues = []
        if not account_id:
            issues.append("account_id is empty — userHandle selector may not be extracting the username")
        if not profile_name and not handle:
            issues.append("account group is empty — profile selectors may not be matching")

        if issues:
            for iss in issues:
                print(f"  ⚠️  {iss}")
            return False

        print("  ✅ Captured profile data looks valid.")
        return True

    # ── Phase 3: Output ───────────────────────────────────────────────────────

    def _step10_write_temp_selectors(self, new_selectors: dict) -> Path:
        print("\n── Step 10: Write temp selectors ──")
        out = self.output_dir / f"{self.fixture_path.stem}_profile_selectors.json"
        with open(out, "w") as f:
            json.dump(new_selectors, f, indent=2)
        print(f"  📄 {out}")
        return out

    def _step11_present_diff(self, new_selectors: dict) -> None:
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

        old_flat = _flatten(existing.get(self.platform, {}).get("account", {}))
        new_flat = _flatten(new_selectors.get(self.platform, {}).get("account", {}))

        changed = [
            (k, old_flat.get(k), new_flat.get(k))
            for k in sorted(set(old_flat) | set(new_flat))
            if old_flat.get(k) != new_flat.get(k)
        ]

        if not changed:
            print("  ✅ Generated account selectors match src/selectors.json exactly.")
        else:
            print(f"  {len(changed)} account field(s) differ:\n")
            for key, old_val, new_val in changed:
                print(f"  {key}")
                print(f"    current : {old_val!r}")
                print(f"    proposed: {new_val!r}")

    # ── Orchestrator ──────────────────────────────────────────────────────────

    async def run(self) -> ProfileHealerResult:
        res = ProfileHealerResult(fixture=str(self.fixture_path))

        # Phase 1: Offline
        try:
            res.offline_selectors_found, res.offline_warnings = self._step1_validate_offline()
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

        src_sel_path = _PROJECT_ROOT / "src" / "selectors.json"
        existing_sel: dict = {}
        if src_sel_path.exists():
            with open(src_sel_path) as f:
                existing_sel = json.load(f)

        new_selectors = self.profile_agent.to_nested_fn(llm_result, existing_sel)

        # Phase 2: Browser
        env = ExtensionBrowserEnv()
        await env.start()
        try:
            page, _ = await self._step3_open_browser(env, new_selectors)
            res.browser_loaded = True

            await self._step4_wait_for_injection(page)
            shot = await self._step5_screenshot(page)
            res.screenshot_path = str(shot)

            res.survey_visible = await self._step6_verify_injection(page)
            form_check = await self._step7_check_form_frames(page)

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

        # Phase 3: Output
        out = self._step10_write_temp_selectors(new_selectors)
        res.output_path = str(out)
        self._step11_present_diff(new_selectors)

        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print(f"  Fixture          : {self.fixture_path.name}")
        print(f"  Profile selectors: {res.offline_selectors_found} offline match(es)")
        print(f"  Survey injected  : {'✅' if res.survey_visible else '❌'}")
        print(f"  Form submitted   : {'✅' if res.form_submitted else '❌'}")
        print(f"  Screenshot       : {res.screenshot_path}")
        print(f"  Temp selectors   : {res.output_path}")
        if res.error:
            print(f"  Error            : {res.error}")
        print()

        return res
