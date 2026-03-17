"""
Capture store screenshots at exactly 1280×800 px.
Run: python3 store-assets/capture-screenshots.py  (from FlowDevKit/ root)
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

HTML = Path(__file__).parent / "screenshots.html"
OUT  = Path(__file__).parent

SHOTS = [
    {"id": "shot-overview", "out": "screenshot-1-overview.png"},
    {"id": "shot-runs",     "out": "screenshot-2-run-performance.png"},
    {"id": "shot-picker",   "out": "screenshot-3-select-actions.png"},
    {"id": "shot-lint",     "out": "screenshot-4-analyze-flow.png"},
]

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1300, "height": 820})
        await page.goto(f"file://{HTML.resolve()}")
        await page.wait_for_timeout(400)

        for shot in SHOTS:
            elem = page.locator(f"#{shot['id']}")
            await elem.screenshot(
                path=str(OUT / shot["out"]),
                type="png",
            )
            print(f"✓  {shot['out']}")

        await browser.close()
    print(f"\nScreenshots saved to store-assets/")

asyncio.run(main())
