/**
 * Does the hero copy still read over the photograph?
 *
 * The landing hero puts type on top of a street scene. Whether that is legible is
 * not a property of the CSS — it is a property of the CSS AND the photograph AND
 * the viewport width, because `cover` crops differently at every size. Swap the
 * image, or move the gradient a few points, and the answer changes with nothing in
 * any test suite noticing: jsdom has no layout engine and no pixels, so no vitest
 * assertion in this repo can see it.
 *
 * So this measures the rendered pixels. For each text element it hides the copy,
 * screenshots what is BEHIND it, composites the element's own colour (including its
 * alpha — the small type is translucent, and ignoring that overstates contrast by a
 * lot) and reports the WCAG ratio.
 *
 * It reports against the LIGHTEST pixel in each element's box, not the average.
 * A mean is what makes a photograph look safe: the average backdrop is dark and one
 * bright patch of pavement under one line is what a reader actually trips over.
 *
 *   npm run dev -w @agent-researcher/fbizlab      # in one shell
 *   node apps/fbizlab/scripts/check-hero-contrast.mjs [url]
 *
 * Exits non-zero if anything falls under its threshold (WCAG AA: 4.5:1, or 3:1 for
 * large text — ≥24px, or ≥18.66px bold).
 */
import { PNG_DECODE } from './png-lum.mjs';

const puppeteer = (await import('puppeteer-core')).default;

const URL_ = process.argv[2] ?? 'http://localhost:5173/';
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** The widths the hero's own stylesheet branches on, plus the extremes. */
const VIEWPORTS = [
  ['wide', 1920, 1000], ['desktop', 1440, 900], ['boundary', 1024, 950],
  ['tablet', 900, 1100], ['mobile', 430, 1000], ['small', 375, 1000], ['tiny', 320, 1000],
];

const TARGETS = [
  ['eyebrow', '.hero .eyebrow'],
  ['h1', '.hero h1'],
  ['lead', '.hero .lead'],
  ['fineprint', '.hero .fineprint'],
  ['tagline', '.hero .mono.muted'],
];

const srgb = (v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const parseColor = (c) => {
  const n = c.replace(/rgba?\(|\)/g, '').split(',').map(Number);
  return { rgb: [n[0], n[1], n[2]], alpha: n[3] ?? 1 };
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const failures = [];

for (const [name, w, h] of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(URL_, { waitUntil: 'networkidle0', timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 900));

  const meta = await page.evaluate((targets) => {
    const out = {};
    for (const [key, sel] of targets) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[key] = {
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        color: cs.color, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400,
      };
    }
    // Hide the copy so the shot below is only what sits behind it.
    document.querySelectorAll('.hero .stack > *').forEach((e) => { e.style.visibility = 'hidden'; });
    return out;
  }, TARGETS);

  await new Promise((r) => setTimeout(r, 250));
  const shot = await page.screenshot({ encoding: 'binary' });
  await page.close();

  const img = PNG_DECODE(Buffer.from(shot));
  console.log(`\n${name} (${w}x${h})`);
  for (const [key, m] of Object.entries(meta)) {
    const { rgb, alpha } = parseColor(m.color);
    let lightest = null;
    for (let y = Math.max(m.y, 0); y < Math.min(m.y + m.h, img.height); y++) {
      for (let x = Math.max(m.x, 0); x < Math.min(m.x + m.w, img.width); x += 2) {
        const px = img.at(x, y);
        if (!lightest || lum(px) > lum(lightest)) lightest = px;
      }
    }
    if (!lightest) continue;
    const effective = rgb.map((t, i) => alpha * t + (1 - alpha) * lightest[i]);
    const large = m.size >= 24 || (m.size >= 18.66 && m.weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(effective, lightest);
    const ok = got >= need;
    if (!ok) failures.push(`${name}/${key}: ${got.toFixed(2)}:1 < ${need}:1`);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${key.padEnd(10)} ${m.size.toFixed(1)}px α=${alpha}  ${got.toFixed(2)}:1 (needs ${need}:1)`);
  }
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} contrast failure(s):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nEvery hero text element clears WCAG AA against the lightest pixel behind it.');
