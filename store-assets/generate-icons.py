"""
Generate optimised FlowDevKit icons at 16, 32, 48, 128 px.
Run: python3 store-assets/generate-icons.py  (from FlowDevKit/ root)
"""
import asyncio, math
from pathlib import Path
from playwright.async_api import async_playwright

HTML = Path(__file__).parent / "generate-icons.html"
OUT  = Path(__file__).parent.parent / "icons"

SIZES = [16, 32, 48, 128]

SCRIPT = """
async (size) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const s = size;

  const grad = ctx.createLinearGradient(0, 0, 0, s);
  grad.addColorStop(0, '#4f8ef7');
  grad.addColorStop(1, '#2563eb');
  ctx.beginPath();
  ctx.roundRect(0, 0, s, s, s * 0.22);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.fillStyle = '#ffffff';

  if (size <= 16) {
    // Bold "F" — crisp at 1:1 pixel
    const pad = Math.round(s * 0.22);
    const sw  = Math.round(s * 0.22);
    const full = s - pad * 2;
    ctx.fillRect(pad, pad, sw, full);
    ctx.fillRect(pad, pad, full, sw);
    const midY = Math.round(s * 0.52) - Math.floor(sw / 2);
    ctx.fillRect(pad, midY, Math.round(full * 0.75), sw);

  } else if (size === 32) {
    // Clean 2×2 grid, no plus
    const pad  = Math.round(s * 0.18);
    const gap  = Math.round(s * 0.11);
    const cell = Math.round((s - pad * 2 - gap) / 2);
    const r    = Math.max(2, Math.round(s * 0.06));
    for (const [x, y] of [[pad, pad],[pad+cell+gap, pad],[pad, pad+cell+gap],[pad+cell+gap, pad+cell+gap]]) {
      ctx.beginPath(); ctx.roundRect(x, y, cell, cell, r); ctx.fill();
    }

  } else {
    // 48 / 128: 3-cell grid + plus in bottom-right
    const pad  = Math.round(s * 0.15);
    const gap  = Math.round(s * 0.08);
    const cell = Math.round((s - pad * 2 - gap) / 2);
    const r    = Math.max(3, Math.round(s * 0.05));
    const bx   = pad + cell + gap, by = pad + cell + gap;

    for (const [x, y] of [[pad,pad],[pad+cell+gap,pad],[pad,pad+cell+gap]]) {
      ctx.beginPath(); ctx.roundRect(x, y, cell, cell, r); ctx.fill();
    }
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.roundRect(bx, by, cell, cell, r); ctx.fill();
    ctx.globalAlpha = 1;

    const arm   = Math.round(cell * 0.55);
    const thick = Math.max(3, Math.round(cell * 0.18));
    const cx    = bx + Math.round(cell / 2);
    const cy    = by + Math.round(cell / 2);
    const armR  = Math.round(thick / 2);
    ctx.beginPath(); ctx.roundRect(cx - Math.round(arm/2), cy - Math.round(thick/2), arm, thick, armR); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx - Math.round(thick/2), cy - Math.round(arm/2), thick, arm, armR); ctx.fill();
  }

  return c.toDataURL('image/png');
}
"""

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 200, "height": 200})
        await page.goto(f"file://{HTML.resolve()}")

        for sz in SIZES:
            data_url = await page.evaluate(SCRIPT, sz)
            # strip data:image/png;base64,
            import base64
            b64 = data_url.split(",", 1)[1]
            png_bytes = base64.b64decode(b64)
            out_path = OUT / f"icon{sz}.png"
            out_path.write_bytes(png_bytes)
            print(f"✓  icon{sz}.png")

        await browser.close()
    print(f"\nIcons written to {OUT}/")

asyncio.run(main())
