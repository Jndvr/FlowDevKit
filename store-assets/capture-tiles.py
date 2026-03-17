"""
Capture promo tiles as PNG files at exact store dimensions.
Run: python3 store-assets/capture-tiles.py  (from FlowDevKit/ root)
"""
import asyncio, os
from pathlib import Path
from playwright.async_api import async_playwright

TILES = [
    {"id": "marquee", "w": 1400, "h": 560,  "out": "promo-marquee-1400x560.png"},
    {"id": "large",   "w": 920,  "h": 680,  "out": "promo-large-920x680.png"},
    {"id": "small",   "w": 440,  "h": 280,  "out": "promo-small-440x280.png"},
]

HTML = Path(__file__).parent / "promo-tiles.html"
OUT  = Path(__file__).parent

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for t in TILES:
            # give a tiny margin so nothing clips
            page = await browser.new_page(viewport={"width": t["w"] + 4, "height": t["h"] + 4})
            await page.goto(f"file://{HTML.resolve()}")
            elem = page.locator(f"#{t['id']}")
            await elem.screenshot(
                path=str(OUT / t["out"]),
                omit_background=False,
                type="png",
            )
            print(f"✓  {t['out']}  ({t['w']}×{t['h']})")
            await page.close()
        await browser.close()
    print("\nAll tiles saved to store-assets/")

asyncio.run(main())
