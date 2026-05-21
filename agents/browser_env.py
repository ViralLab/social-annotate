import asyncio
import os
import shutil
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler
from socketserver import TCPServer
from pathlib import Path
from playwright.async_api import async_playwright, Page, BrowserContext

class ExtensionBrowserEnv:
    def __init__(self, extension_path: str = None, port: int = 0):
        self.base_dir = Path(__file__).resolve().parent.parent
        
        if extension_path is None:
            # Default to the 'src' directory in the project root
            self.extension_path = str(self.base_dir / "src")
        else:
            self.extension_path = str(Path(extension_path).resolve())
        
        self.port = port
        self.server = None
        self.server_thread = None
        self.playwright = None
        self.browser_context = None
        self.temp_user_data_dir = None

    def _start_server(self):
        base_dir = self.base_dir
        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(base_dir), **kwargs)
                
            def log_message(self, format, *args):
                pass # suppress logging
                
        self.server = TCPServer(("127.0.0.1", self.port), Handler)
        self.port = self.server.server_address[1] # get actual port if 0 was passed
        
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()

    def _stop_server(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()

    async def start(self) -> BrowserContext:
        """Starts the local server and launches the browser with the extension loaded."""
        self._start_server()
        
        self.playwright = await async_playwright().start()
        
        args = [
            f"--disable-extensions-except={self.extension_path}",
            f"--load-extension={self.extension_path}",
        ]
        
        self.temp_user_data_dir = tempfile.TemporaryDirectory()
        
        # Extensions only work in persistent contexts in Playwright
        # headless=False is required for extensions, but we can use new headless mode if needed:
        # headless=False is safer for general extension compatibility
        self.browser_context = await self.playwright.chromium.launch_persistent_context(
            user_data_dir=self.temp_user_data_dir.name,
            headless=False,
            args=args,
            viewport={"width": 1280, "height": 800}
        )
        return self.browser_context

    async def _get_service_worker(self):
        """Waits for and returns the extension's background service worker."""
        sw = None
        for _ in range(20):  # up to ~10 seconds
            workers = self.browser_context.service_workers
            for w in workers:
                if "background" in w.url:
                    sw = w
                    break
            if sw:
                break
            await asyncio.sleep(0.5)
        if not sw:
            raise RuntimeError(
                "Could not find the extension background service worker. "
                "Make sure the extension path is correct."
            )
        return sw

    async def _wait_for_storage_init(self, timeout: float = 10.0):
        """
        Waits until the background service worker's onInstalled handler has seeded
        chrome.storage.local (i.e., the 'config' key is present).
        """
        sw = await self._get_service_worker()
        elapsed = 0.0
        interval = 0.3
        while elapsed < timeout:
            has_config = await sw.evaluate("""() => new Promise((resolve) => {
                chrome.storage.local.get(['config'], (r) => resolve(!!r.config));
            })""")
            if has_config:
                return
            await asyncio.sleep(interval)
            elapsed += interval
        raise TimeoutError("Timed out waiting for extension storage to initialise.")

    async def set_active_survey(self, survey_type: str):
        """
        Updates chrome.storage.local to activate a specific survey type.
        This patches the live extension config without modifying config.js.
        Waits for storage to be seeded by onInstalled before writing.
        """
        await self._wait_for_storage_init()
        sw = await self._get_service_worker()
        await sw.evaluate(f"""() => new Promise((resolve, reject) => {{
            chrome.storage.local.get(['config'], (result) => {{
                if (chrome.runtime.lastError) return reject(chrome.runtime.lastError.message);
                const cfg = result.config || {{}};
                cfg.activeSurveys = ["{survey_type}"];
                chrome.storage.local.set({{ config: cfg }}, () => {{
                    if (chrome.runtime.lastError) return reject(chrome.runtime.lastError.message);
                    resolve();
                }});
            }});
        }})""")
        print(f"✅ Active survey set to: {survey_type}")

    async def open_file(self, file_path: str | Path, survey_type: str | None = None, block_spa_scripts: bool = False) -> Page:
        """
        Opens a local HTML file via the local HTTP server.

        Args:
            file_path:         Path to an HTML file inside the project directory.
            survey_type:       Optional survey key to activate (e.g. 'truthsocial-post').
                               If provided, chrome.storage.local is updated before navigation
                               so the injected content script sees the right active survey.
            block_spa_scripts: If True, neutralises the page's own <script> tags before
                               execution so SPA frameworks don't crash on missing API calls.
                               The extension's content scripts are unaffected.
        """
        if not self.browser_context:
            raise RuntimeError("Browser is not started. Call start() first.")

        path_obj = Path(file_path).resolve()

        try:
            rel_path = path_obj.relative_to(self.base_dir)
        except ValueError:
            raise ValueError(f"File {file_path} must be within the project directory {self.base_dir} to be served.")

        url = f"http://127.0.0.1:{self.port}/{rel_path.as_posix()}"

        # In a persistent context, Playwright opens an initial blank page automatically
        pages = self.browser_context.pages
        if len(pages) > 0 and pages[0].url == "about:blank":
            page = pages[0]
        else:
            page = await self.browser_context.new_page()

        if block_spa_scripts:
            # Block the page's JS bundle files via network interception so the SPA
            # never runs and the static pre-rendered HTML stays intact.
            # Chrome extension content scripts are injected by the browser separately
            # and are completely unaffected by this route interception.
            async def _block_js(route):
                req = route.request
                # Let chrome-extension:// requests pass through normally
                if req.url.startswith("chrome-extension://"):
                    await route.continue_()
                elif req.resource_type == "script":
                    await route.abort()
                else:
                    await route.continue_()

            await page.route("**/*", _block_js)

        # Load the page once so the extension's onInstalled fires and seeds storage
        await page.goto(url, wait_until="domcontentloaded")

        # Now that storage is seeded, safely patch activeSurveys
        if survey_type:
            await self.set_active_survey(survey_type)
            # Reload so the content script re-runs initializeSurveys with the new config
            await page.reload(wait_until="domcontentloaded")

        return page





    async def close(self):
        """Closes the browser and stops the server."""
        if self.browser_context:
            await self.browser_context.close()
        if self.playwright:
            await self.playwright.stop()
        if self.temp_user_data_dir:
            # TemporaryDirectory.cleanup() raises OSError on macOS when Chrome
            # leaves non-empty Cache subdirectories. Use shutil instead.
            shutil.rmtree(self.temp_user_data_dir.name, ignore_errors=True)
        self._stop_server()

# Simple test to verify functionality
if __name__ == "__main__":
    import asyncio
    
    async def test():
        env = ExtensionBrowserEnv()
        await env.start()
        print(f"Server running on port {env.port}")
        
        test_file = env.base_dir / "test_fixtures" / "mock_twitter.html"
        if not test_file.exists():
            print(f"Test file not found at {test_file}. Creating a dummy file.")
            test_file.parent.mkdir(exist_ok=True)
            test_file.write_text("<html><body><h1>Test Timeline</h1></body></html>")
            
        print(f"Opening {test_file}...")
        page = await env.open_file(test_file)
        
        # Give extension time to inject
        await asyncio.sleep(2)
        
        print(f"Page title: {await page.title()}")
        await env.close()
        print("Closed successfully.")
        
    asyncio.run(test())
