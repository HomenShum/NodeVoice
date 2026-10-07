// Condition 7 — the Web Interface Guidelines review, performed against the
// RENDERED app rather than inferred from a Lighthouse score.
//
// The two are not interchangeable and this file exists because they are
// routinely confused. Lighthouse (condition 8) scores a page against its own
// audit set. The Vercel Web Interface Guidelines
// (https://vercel.com/design/guidelines, fetched 2026-08-13) are a checklist of
// interface *behaviour* — does Enter submit, is the label visible, does a hit
// target reach 24px, is a control still on screen at 390px. Every finding below
// names the guideline it violates and carries the DOM measurement that decided
// it, so a reader can re-measure rather than take the verdict.
//
//   1. npm run build
//   2. PORT=4901 npx tsx src/server.ts
//   3. npm i --no-save playwright              (capture-only dep, as in record-readme-hero.mjs)
//   4. node scripts/review-web-interface-guidelines.mjs
//
// Writes promotion/evidence/wig-review/: wig-findings.json plus one screenshot
// per surface reviewed. Exits non-zero if any MAJOR finding is open, so the
// condition-7 claim is a failing run when it stops being true.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "promotion", "evidence", "wig-review");
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:4901";
mkdirSync(outDir, { recursive: true });

const findings = [];
const measurements = {};
const add = (f) => findings.push(f);

/** Everything measurable in one page, in the page. Returns raw numbers only —
 *  the severity call is made below, in the open, not hidden inside the DOM. */
const probePage = () => {
  const vw = document.documentElement.clientWidth;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  // `title` counts: it DOES reach the accessibility tree, which is why axe's
  // button-name rule passes on the two agent-count steppers. It is reported
  // separately below because a title-only name is invisible to a touch user and
  // axe raises `label-title-only` for form controls that rely on it.
  const nameSource = (el) => {
    const forLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    if (el.getAttribute("aria-label")?.trim()) return "aria-label";
    const by = el.getAttribute("aria-labelledby");
    if (by && document.getElementById(by)?.textContent?.trim()) return "aria-labelledby";
    if (forLabel?.textContent?.trim()) return "label[for]";
    if (el.closest("label")?.textContent?.trim()) return "wrapping label";
    if (el.getAttribute("title")?.trim()) return "title";
    return null;
  };
  const name = (el) => nameSource(el);

  const controls = [...document.querySelectorAll("input,textarea,select")].filter(visible);
  const interactive = [...document.querySelectorAll("button,a[href],input,select,textarea,[tabindex]:not([tabindex='-1'])")].filter(visible);

  // Guideline: "Labels everywhere" / "Form elements should have a visible label".
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    selector: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}[${el.getAttribute("title") ? "title" : "placeholder"}="${el.getAttribute("title") ?? el.getAttribute("placeholder") ?? ""}"]`,
    title: el.getAttribute("title"),
    placeholder: el.getAttribute("placeholder"),
    nameSource: name(el),
  });
  const unlabelled = controls.filter((el) => !name(el)).map(describe);
  const titleOnlyControls = controls.filter((el) => name(el) === "title").map(describe);

  // Guideline: "Match visual & hit targets" — <24px anywhere, 44px on mobile.
  // A link set inline in a sentence is exempt (WCAG 2.5.8 inline exception):
  // its target is the line box, and padding it out would break the paragraph.
  const sized = (el) => {
    const r = el.getBoundingClientRect();
    return {
      text: (el.textContent ?? "").trim().slice(0, 40),
      tag: el.tagName.toLowerCase(),
      inline: getComputedStyle(el).display === "inline",
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  };
  const measurable = interactive.map(sized).filter((t) => !(t.tag === "a" && t.inline));
  const smallTargets = measurable.filter((t) => Math.min(t.w, t.h) < 24);
  const under44 = measurable.filter((t) => Math.min(t.w, t.h) < 44);
  const inlineLinksExempt = interactive.map(sized).filter((t) => t.tag === "a" && t.inline && Math.min(t.w, t.h) < 24);

  // Guideline: "Responsive coverage" / "No excessive scrollbars" — anything whose
  // right edge is past the viewport in a container that does not scroll is a
  // control the user cannot reach.
  const clipped = interactive
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el.textContent ?? "").trim().slice(0, 40), tag: el.tagName.toLowerCase(), right: Math.round(r.right), left: Math.round(r.left), w: Math.round(r.width) };
    })
    .filter((t) => t.right > vw + 1 || t.left < -1);

  // Guideline: "Mobile input size" — <input> font >=16px or iOS Safari zooms.
  const smallFontInputs = controls
    .map((el) => ({ tag: el.tagName.toLowerCase(), fontSize: parseFloat(getComputedStyle(el).fontSize), selector: el.id ? `#${el.id}` : el.tagName.toLowerCase() }))
    .filter((c) => c.fontSize < 16);

  // Guideline: "Icon-only buttons are named".
  const iconOnly = [...document.querySelectorAll("button")].filter(visible).filter((el) => !(el.textContent ?? "").trim());
  const iconOnlyUnnamed = iconOnly.filter((el) => !name(el)).map((el) => ({ html: el.outerHTML.slice(0, 120) }));
  const iconOnlyTitleOnly = iconOnly
    .filter((el) => name(el) === "title")
    .map((el) => ({ title: el.getAttribute("title"), nameSource: "title" }));

  // Guideline: "Prevent double-tap zoom on controls" — touch-action: manipulation.
  const noTouchAction = [...document.querySelectorAll("button")].filter(visible).filter((el) => getComputedStyle(el).touchAction === "auto").length;

  // Guideline: "Headings & skip link" + "Semantics before ARIA" (landmarks).
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible).map((h) => Number(h.tagName[1]));
  const skipLink = [...document.querySelectorAll("a[href^='#']")].some((a) => /skip/i.test(a.textContent ?? ""));

  // Guideline: "Honor prefers-reduced-motion" — only a finding if the page moves.
  let reducedMotionRules = 0;
  let animatedRules = 0;
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet; none here, but do not pretend to have read it
    }
    for (const rule of rules) {
      const text = rule.cssText ?? "";
      if (/prefers-reduced-motion/.test(text)) reducedMotionRules += 1;
      // Longhands too: Tailwind emits `transition-property`/`animation-name`,
      // never the `transition:` shorthand, so a shorthand-only test reports 1
      // animated rule in a stylesheet that has nine.
      if (/(^|[;{\s])(transition|animation)(-[a-z-]+)?\s*:/.test(text) || rule.type === CSSRule.KEYFRAMES_RULE) animatedRules += 1;
    }
  }

  // Guideline: "Don't pre-disable submit".
  const disabledOnLoad = [...document.querySelectorAll("button")].filter(visible).filter((b) => b.disabled).map((b) => (b.textContent ?? "").trim().slice(0, 40));

  // Guideline: "Tabular numbers for comparisons" — the live counters.
  const counters = [...document.querySelectorAll("*")]
    .filter((el) => el.children.length === 0 && /^\s*\d+\s*\/\s*\d+\s*$/.test(el.textContent ?? ""))
    .map((el) => ({ text: (el.textContent ?? "").trim(), tabular: getComputedStyle(el).fontVariantNumeric.includes("tabular-nums") }));

  const viewportMeta = document.querySelector("meta[name=viewport]")?.getAttribute("content") ?? null;

  return {
    viewportWidth: vw,
    title: document.title,
    lang: document.documentElement.lang || null,
    viewportMeta,
    themeColor: document.querySelector("meta[name=theme-color]")?.getAttribute("content") ?? null,
    colorScheme: getComputedStyle(document.documentElement).colorScheme || null,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: vw,
    controlCount: controls.length,
    interactiveCount: interactive.length,
    anchorCount: document.querySelectorAll("a[href]").length,
    mainLandmarks: document.querySelectorAll("main,[role=main]").length,
    headings,
    skipLink,
    unlabelled,
    titleOnlyControls,
    smallTargets,
    under44,
    inlineLinksExempt,
    clipped,
    smallFontInputs,
    iconOnlyUnnamed,
    iconOnlyTitleOnly,
    noTouchAction,
    reducedMotionRules,
    animatedRules,
    disabledOnLoad,
    counters,
  };
};

/**
 * Guideline: "Clear focus — every focusable element shows a visible focus ring."
 *
 * Decided by PIXELS, not by computed style. A first attempt read `outline` and
 * `box-shadow` and got the answer wrong in both directions: Tailwind leaves a
 * fully transparent ring placeholder (`rgba(0,0,0,0) 0px 0px 0px 0px`) on every
 * button, which reads as "has a shadow" and is invisible; and `outline: auto`
 * on a control the browser then overrides reads as present when nothing paints.
 * So: photograph the control's box with focus, blur it, photograph the same box
 * again, and compare the bytes. A ring that does not change any pixel is not a
 * ring.
 *
 * Three things are suppressed page-wide first, each because it made the diff
 * lie once: the blinking caret (a text input changes pixels with no ring), CSS
 * animation (anything moving inside the clip changes pixels with no ring, and
 * this page has six animated rules), and transition (a ring that fades in races
 * the screenshot). Focus is returned to `document.body` between stops, because
 * `blur()` alone leaves the sequential-navigation starting point where it was
 * and the walk then re-visits the same four controls instead of advancing.
 */
const focusWalk = async (page, stops = 16) => {
  await page.addStyleTag({
    content: "*, *::before, *::after { caret-color: transparent !important; animation: none !important; transition: none !important; }",
  });
  const toTop = () =>
    page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
  const seen = [];
  for (let i = 1; i <= stops; i += 1) {
    await toTop();
    for (let k = 0; k < i; k += 1) await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const pad = 6; // a ring is drawn outside the border box
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? "").trim().slice(0, 32),
        outline: `${s.outlineStyle} ${s.outlineWidth}`,
        box: {
          x: Math.max(0, Math.round(r.x - pad)),
          y: Math.max(0, Math.round(r.y - pad)),
          width: Math.min(Math.round(r.width + pad * 2), document.documentElement.clientWidth),
          height: Math.min(Math.round(r.height + pad * 2), document.documentElement.clientHeight),
        },
      };
    });
    if (!stop) break;
    if (stop.box.width < 2 || stop.box.height < 2) continue;
    const focused = await page.screenshot({ clip: stop.box });
    await page.evaluate(() => document.activeElement?.blur?.());
    const blurred = await page.screenshot({ clip: stop.box });
    const blurredAgain = await page.screenshot({ clip: stop.box });
    // If the region does not photograph the same twice while nothing is focused,
    // it moves on its own and the focused/blurred diff proves nothing. Say so
    // rather than scoring it.
    const stable = blurred.equals(blurredAgain);
    seen.push({
      ...stop,
      hasIndicator: stable ? !focused.equals(blurred) : null,
      stable,
      method: "pixel diff of the control's box, focused vs blurred, after a stability check",
    });
  }
  return seen;
};

const browser = await chromium.launch();

for (const [surface, url] of [["lobby", "/"], ["demo", "/demo"]]) {
  for (const [label, width, height] of [["desktop", 1280, 800], ["mobile", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto(`${baseUrl}${url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const m = await page.evaluate(probePage);
    m.focusStops = label === "desktop" ? await focusWalk(page) : [];
    const shot = `${surface}-${label}-${width}.png`;
    await page.screenshot({ path: path.join(outDir, shot), fullPage: false });
    m.screenshot = shot;
    measurements[`${surface}-${label}`] = m;
    await context.close();
  }
}
await browser.close();

// ── the review: one entry per guideline, severity argued from the number ──
const G = (section, guideline, severity, page, detail, evidence) => add({ section, guideline, severity, page, detail, evidence });

for (const [key, m] of Object.entries(measurements)) {
  const mobile = key.endsWith("mobile");

  if (m.unlabelled.length) {
    G("Forms", "Labels everywhere — every control has a <label> or an associated label", "major", key,
      `${m.unlabelled.length} visible control(s) reach the accessibility tree with no name. A screen-reader user hears an unnamed field.`,
      m.unlabelled);
  }
  if (m.clipped.length) {
    G("Layout", "Responsive coverage — verify on mobile, laptop and ultra-wide", "major", key,
      `${m.clipped.length} interactive element(s) sit outside the ${m.viewportWidth}px viewport in a container that does not scroll, so they cannot be reached.`,
      m.clipped);
  }
  if (m.smallTargets.length) {
    G("Interactions", "Match visual & hit targets — expand targets <24px to >=24px", "major", key,
      `${m.smallTargets.length} interactive element(s) measure under 24px on their short side.`,
      m.smallTargets);
  }
  if (mobile && m.under44.length) {
    G("Interactions", "Match visual & hit targets — 44px minimum on mobile", "minor", key,
      `${m.under44.length} interactive element(s) are under 44px on their short side at 390px.`,
      m.under44.slice(0, 12));
  }
  if (mobile && m.smallFontInputs.length) {
    G("Interactions", "Mobile input size — <input> font >=16px to prevent iOS Safari auto-zoom", "minor", key,
      `${m.smallFontInputs.length} control(s) render below 16px, so iOS Safari zooms the page on focus.`,
      m.smallFontInputs);
  }
  if (m.iconOnlyUnnamed.length) {
    G("Content", "Icon-only buttons are named — provide a descriptive aria-label", "major", key,
      `${m.iconOnlyUnnamed.length} button(s) have neither text nor an accessible name.`, m.iconOnlyUnnamed);
  }
  if (m.iconOnlyTitleOnly.length) {
    G("Content", "Icon-only buttons are named — provide a descriptive aria-label", "minor", key,
      `${m.iconOnlyTitleOnly.length} icon-only button(s) are named ONLY by title. The name does reach the accessibility tree — axe's button-name rule passes — but a title never appears for a touch user, who sees an unlabelled icon.`,
      m.iconOnlyTitleOnly);
  }
  if (m.titleOnlyControls.length) {
    G("Forms", "Labels everywhere — every control has a <label> or an associated label", "major", key,
      `${m.titleOnlyControls.length} form control(s) are named ONLY by title, with no visible label. Independently flagged by axe as label-title-only (serious).`,
      m.titleOnlyControls);
  }
  if (m.mainLandmarks === 0) {
    G("Content", "Semantics before ARIA — prefer native elements; headings & landmarks", "minor", key,
      "No <main> landmark, so every region of the page is orphaned and a landmark-navigating screen-reader user has nothing to jump to.",
      { mainLandmarks: 0 });
  }
  if (!m.skipLink) {
    G("Content", "Headings & skip link — hierarchical h1-h6 and a 'Skip to content' link", "minor", key,
      "No skip link. A keyboard user re-tabs the header on every page.", { headings: m.headings, skipLink: false });
  }
  if (m.headings.length && m.headings[0] !== 1) {
    G("Content", "Headings & skip link — hierarchical h1-h6", "minor", key,
      `The first visible heading is an h${m.headings[0]}, not an h1.`, { headings: m.headings });
  }
  if (m.animatedRules > 0 && m.reducedMotionRules === 0) {
    G("Animations", "Honor prefers-reduced-motion — provide a reduced-motion variant", "major", key,
      `${m.animatedRules} CSS rule(s) declare a transition or animation and no rule anywhere responds to prefers-reduced-motion.`,
      { animatedRules: m.animatedRules, reducedMotionRules: 0 });
  }
  if (m.viewportMeta && /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(m.viewportMeta)) {
    G("Interactions", "Respect zoom — never disable browser zoom", "major", key, `viewport meta: ${m.viewportMeta}`, { viewportMeta: m.viewportMeta });
  }
  if (m.scrollWidth > m.clientWidth) {
    G("Layout", "No excessive scrollbars — fix overflow issues", "major", key,
      `document.scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}.`, { scrollWidth: m.scrollWidth, clientWidth: m.clientWidth });
  }
  if (m.counters.length && m.counters.some((c) => !c.tabular)) {
    G("Content", "Tabular numbers for comparisons — font-variant-numeric: tabular-nums", "minor", key,
      "A live counter re-flows as its digits change because it is not set in tabular figures.", m.counters);
  }
  if (m.noTouchAction > 0) {
    G("Interactions", "Prevent double-tap zoom on controls — touch-action: manipulation", "minor", key,
      `${m.noTouchAction} button(s) leave touch-action at auto, so a double tap zooms instead of acting.`, { buttons: m.noTouchAction });
  }
  if (m.disabledOnLoad.length) {
    G("Forms", "Don't pre-disable submit — surface validation instead", "minor", key,
      `${m.disabledOnLoad.length} button(s) are disabled before the user has done anything.`, m.disabledOnLoad);
  }
  if (!m.themeColor) {
    G("Design", "Browser UI matches your background — <meta name=theme-color>", "minor", key,
      "No theme-color, so mobile browser chrome does not match the app's dark surface.", { themeColor: null });
  }
  const stops = m.focusStops ?? [];
  const noRing = stops.filter((s) => s.hasIndicator === false);
  const unmeasured = stops.filter((s) => s.hasIndicator === null);
  if (noRing.length) {
    G("Interactions", "Clear focus — every focusable element shows a visible focus ring", "major", key,
      `${noRing.length} of ${stops.length} tab stops change no pixel when focused.`, noRing);
  }
  if (unmeasured.length) {
    G("Interactions", "Clear focus — every focusable element shows a visible focus ring", "minor", key,
      `${unmeasured.length} of ${stops.length} tab stops sit in a region that does not photograph identically twice, so the diff cannot decide them. Recorded UNMEASURED, not passed.`,
      unmeasured);
  }
}

// "Accurate page titles — <title> reflects current context" is a cross-surface
// check: two different routes sharing one title is the finding.
const lobbyTitle = measurements["lobby-desktop"]?.title;
const demoTitle = measurements["demo-desktop"]?.title;
if (lobbyTitle && lobbyTitle === demoTitle) {
  G("Content", "Accurate page titles — <title> reflects the current context", "minor", "lobby+demo",
    `Both routes report the same document title, so a tab, a bookmark and the Back menu cannot tell them apart.`,
    { lobby: lobbyTitle, demo: demoTitle });
}

const major = findings.filter((f) => f.severity === "major");
const report = {
  review: "Vercel Web Interface Guidelines",
  guidelinesSource: "https://vercel.com/design/guidelines",
  guidelinesFetched: "2026-08-13",
  method: "Rendered app driven in headless Chromium (Playwright). Every finding carries the DOM measurement that produced it. This is NOT a Lighthouse score — condition 8 holds those, and the two measure different things.",
  capturedAt: new Date().toISOString(),
  baseUrl,
  surfaces: Object.keys(measurements),
  majorCount: major.length,
  minorCount: findings.length - major.length,
  findings,
  measurements,
};
writeFileSync(path.join(outDir, "wig-findings.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`${findings.length} finding(s): ${major.length} major, ${findings.length - major.length} minor`);
for (const f of findings) console.log(`  [${f.severity}] ${f.page} — ${f.guideline}\n      ${f.detail}`);
console.log(`\nwrote ${path.join(outDir, "wig-findings.json")}`);
if (major.length) process.exit(1);
