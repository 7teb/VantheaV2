"""
Design output checker. Works on Windows, macOS and Linux.

Usage:  python <skill folder>/tools/check.py <folder or index.html> [--shots <dir>] [--lint-only]

What it does
  1. Lints the source (syntax, id mismatches, banned characters, placeholder words, leftover TODO markers)
  2. If the folder has a brief.md (a composed ad), lints the brief against the compose rules
  3. Opens the page in a REAL browser (tools/live.mjs): waits, takes screenshots, moves the mouse over the stage,
     clicks and drags every control, reports runtime errors, plays the scenes, checks sideways overflow at 1440, 800 and 390
  4. Measures blank, flat, no idle motion

It FAILS when the browser part cannot run (no Edge or Chrome, no node 22 or newer, no Pillow). It never passes silently.
--lint-only skips step 3 on purpose and says so in the result line. Set CHECK_BROWSER to a browser path to override detection.

Exit code 0 means no FAIL lines. WARN lines are advice.
"""
import argparse, json, re, subprocess, sys, pathlib, shutil, warnings
warnings.filterwarnings("ignore")

results = []
def report(level, msg):
    results.append((level, msg))
    print(f"{level:4}  {msg}")

EMOJI = re.compile("[\U0001F300-\U0001FAFF\u2600-\u27BF\u2B50\u2B55\uFE0F]")
PLACEHOLDERS = re.compile(r"\b(KICKER_TEXT|HEADLINE_TEXT|SUB_TEXT|CTA_TEXT|FOOT_TEXT|SUBJECT_TITLE|STYLE_NAME)\b|>NN<|>LABEL<")

STYLES = ["particles", "liquid_morph", "holographic", "neon_glow", "wireframe_3d", "glassmorphism", "kinetic_type",
          "isometric", "clay_3d", "ascii_art", "gradient_mesh", "comic_book", "split_flap", "retro_vhs", "halftone",
          "bauhaus", "pixel_art", "blueprint", "art_deco", "neo_brutalism"]
WORLDS = {"comic_book", "split_flap", "pixel_art", "bauhaus", "art_deco", "neo_brutalism", "blueprint"}
ROLES = {
    "gradient_mesh": {"background"}, "particles": {"background", "overlay"}, "ascii_art": {"background"},
    "isometric": {"background", "hero"}, "halftone": {"background", "overlay"}, "liquid_morph": {"hero", "background"},
    "holographic": {"hero", "headline"}, "wireframe_3d": {"hero"}, "clay_3d": {"hero"}, "neon_glow": {"headline", "hero"},
    "kinetic_type": {"headline"}, "glassmorphism": {"panel"}, "retro_vhs": {"overlay"},
}

def read(p):
    return pathlib.Path(p).read_text(encoding="utf-8", errors="replace")

def strip_tags(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip().lower()

# ---------- source lint ----------
def lint(folder):
    files = {p.name: p for p in folder.glob("*") if p.suffix in (".html", ".css", ".js")}
    if "index.html" not in files:
        report("FAIL", "index.html is missing")
        return None
    html = read(files["index.html"])
    css = "\n".join(read(p) for n, p in files.items() if n.endswith(".css"))
    js = "\n".join(read(p) for n, p in files.items() if n.endswith(".js") and n != "helpers.js")
    helpers = read(files["helpers.js"]) if "helpers.js" in files else ""

    if "app.js" not in files: report("FAIL", "app.js is missing")
    if "styles.css" not in files: report("FAIL", "styles.css is missing")
    if "helpers.js" not in files or "base.css" not in files:
        report("WARN", "kit files (helpers.js, base.css) were not copied next to index.html")

    for name, p in files.items():
        text = read(p)
        if "\u2014" in text: report("FAIL", f"{name}: contains an em dash")
        if EMOJI.search(text): report("FAIL", f"{name}: contains an emoji or dingbat glyph")
        if re.search(r"lorem ipsum|TODO|FIXME|placeholder text", text, re.I): report("FAIL", f"{name}: filler or a leftover TODO marker (scaffold.py puts one in app.js and styles.css, replace it)")
    left = sorted({m.group(0).strip("<>") for m in PLACEHOLDERS.finditer(html)})
    if left: report("FAIL", f"index.html still has template placeholders: {', '.join(left)}. Replace every one with real text (or delete the FOOT_TEXT element)")

    for src in re.findall(r'<script[^>]+src="([^"]+)"', html):
        if src.startswith("http"):
            report("WARN", f"external script {src} (prefer none)")
        elif not (folder / src).exists():
            report("FAIL", f"index.html loads missing file {src}")
    for href in re.findall(r'<link[^>]+href="([^"]+)"', html):
        if not href.startswith("http") and not (folder / href).exists():
            report("FAIL", f"index.html links missing file {href}")

    node = shutil.which("node")
    if node:
        for n, p in files.items():
            if n.endswith(".js"):
                r = subprocess.run([node, "--check", str(p)], capture_output=True, text=True)
                if r.returncode: report("FAIL", f"{n}: syntax error " + " ".join(r.stderr.strip().splitlines()[0:4]))

    html_ids = set(re.findall(r'\bid="([^"]+)"', html))
    used = set(re.findall(r"""\$\(\s*['"]#([\w-]+)['"]""", js + helpers)) | set(re.findall(r"getElementById\(\s*['\"]([\w-]+)['\"]", js))
    made = set(re.findall(r"\.id\s*=\s*['\"]([\w-]+)['\"]", js)) | set(re.findall(r"""id=\\?["']([\w-]+)""", js))
    for i in sorted(used - html_ids - made):
        report("FAIL", f"app.js uses #{i} but index.html has no element with that id")
    for c in sorted(set(re.findall(r"""\$\$?\(\s*['"]\.([\w-]+)['"]""", js))):
        in_html = re.search(r'class="[^"]*\b' + re.escape(c) + r'\b', html)
        made_in_js = len(re.findall(r"\b" + re.escape(c) + r"\b", js)) > len(re.findall(r"""\$\$?\(\s*['"]\.""" + re.escape(c), js))
        if not in_html and not made_in_js:
            report("WARN", f"class .{c} is queried in app.js but not found in index.html")

    if re.search(r"font-weight:\s*(100|200|300|900)\b", css):
        report("WARN", "font-weight 100 to 300 or 900 found (fine inside a stage, never in the chrome)")
    if "prefers-reduced-motion" not in css:
        report("WARN", "no prefers-reduced-motion block")
    if "animate_when_visible" not in js and "timeline(" not in js and "requestAnimationFrame" in js:
        report("WARN", "requestAnimationFrame used without animate_when_visible, the loop will run off screen")
    low_res = "pixelated" in css or "image-rendering" in css or "low res" in js.lower()
    if "devicePixelRatio" not in js and "fit_canvas" not in js and "<canvas" in html and not low_res:
        report("WARN", "canvas without DPR handling, it will look blurry (use fit_canvas)")
    if "<h1" not in html: report("WARN", "no h1")
    if not re.search(r'<meta[^>]+viewport', html): report("FAIL", "missing viewport meta")
    return dict(html=html, css=css, js=js)

# ---------- compose brief lint ----------
def parse_brief(text):
    kv, scenes = {}, []
    for line in text.splitlines():
        line = line.strip()
        m = re.match(r"^scene\s*(\d+)\s*:\s*(.+)$", line, re.I)
        if m:
            scenes.append(m.group(2)); continue
        m = re.match(r"^([a-z_]+)\s*:\s*(.+)$", line, re.I)
        if m: kv[m.group(1).lower()] = m.group(2).strip()
    return kv, scenes

def lint_compose(folder, src):
    brief = folder / "brief.md"
    if not brief.exists():
        report("FAIL", "this is a composed ad but brief.md is missing. Write brief.md first (see styles/compose.md)")
        return 0
    kv, scenes = parse_brief(read(brief))
    for k in ("subject", "mood", "palette", "layers", "kicker", "headline", "sub", "cta"):
        if not kv.get(k): report("FAIL", f"brief.md has no '{k}:' line")
    # palette
    hexes = re.findall(r"#[0-9a-fA-F]{6}\b", kv.get("palette", ""))
    if len(hexes) != 5: report("FAIL", f"brief.md palette needs 5 hex colors (c1 to c5), found {len(hexes)}")
    else:
        hay = (src["css"] + src["html"]).lower()
        for i, h in enumerate(hexes, 1):
            if h.lower() not in hay: report("FAIL", f"palette color c{i} {h} is not used in styles.css, set it as --c{i} on .ad")
    # layers
    layers = re.findall(r"([a-z_0-9]+)\s+as\s+([a-z]+)", kv.get("layers", ""), re.I)
    names = [n.lower() for n, _ in layers]
    if not 2 <= len(layers) <= 3: report("FAIL", f"brief.md layers must list 2 or 3 styles, found {len(layers)}")
    if len(set(names)) != len(names): report("FAIL", "brief.md uses the same style twice")
    roles = [r.lower() for _, r in layers]
    for n, r in zip(names, roles):
        if n in WORLDS: report("FAIL", f"{n} is a world style, it cannot be mixed. Build it as a single style page, or pick effect styles")
        elif n not in ROLES: report("FAIL", f"unknown style '{n}' in layers")
        elif r not in ROLES[n]: report("FAIL", f"{n} cannot be the {r}. Allowed roles for {n}: {', '.join(sorted(ROLES[n]))}")
    if roles.count("hero") > 1: report("FAIL", "only one layer can be the hero")
    if roles.count("headline") > 1: report("FAIL", "only one layer can be the headline")
    if layers and not ({"hero", "headline"} & set(roles)): report("FAIL", "the layers need a hero or a headline, the page has no focal thing")
    js_all, css_all = src["js"], src["css"]
    for n in names:
        if n in ROLES and f"layer_{n}" not in js_all and n not in css_all and n not in js_all:
            report("FAIL", f"layer {n} is in the brief but not in the code. JS layers are functions named layer_{n}, CSS only layers need a comment /* {n} */ before their rules")
    # copy
    limits = {"kicker": 3, "headline": 6, "sub": 14, "cta": 3}
    page_text = strip_tags(src["html"])
    for k, lim in limits.items():
        v = kv.get(k, "")
        if v and len(v.split()) > lim: report("FAIL", f"brief.md {k} has {len(v.split())} words, the limit is {lim}")
        if v and v.lower() not in page_text: report("FAIL", f"the {k} text from brief.md is not in index.html: {v!r}")
        if re.search(r"[\u2014]|[!]{2,}|\d+\s*%|\$\s*\d|\b(best|#1|guaranteed|free)\b", v, re.I): report("FAIL", f"{k} contains a claim, price, percentage or banned character: {v!r}")
    # scenes
    durs = []
    for s in scenes:
        m = re.search(r"\((\d+(?:\.\d+)?)\s*s\)", s)
        if m: durs.append(float(m.group(1)))
    if not 2 <= len(scenes) <= 4: report("FAIL", f"brief.md needs 2 to 4 'scene N:' lines, found {len(scenes)}")
    elif len(durs) != len(scenes): report("FAIL", "every scene line needs its length like (4s)")
    else:
        if sum(durs) > 16: report("FAIL", f"the story is {sum(durs):.0f}s long, the limit is 16s")
        if any(d < 2 or d > 7 for d in durs): report("FAIL", "each scene must be 2 to 7 seconds")
    if "timeline(" not in js_all: report("FAIL", "app.js does not use timeline(), a composed ad needs scenes")
    sm = re.search(r'id="scenes".*?</div>', src["html"], re.S)
    nbtn = len(re.findall(r"<button", sm.group(0))) if sm else 0
    if scenes and nbtn != len(scenes): report("FAIL", f"the #scenes control has {nbtn} buttons but the brief has {len(scenes)} scenes, they must match")
    for slot in ("slot_kicker", "slot_headline", "slot_sub", "slot_cta"):
        if slot not in src["html"]: report("FAIL", f"index.html has no {slot} element")
    return len(scenes)

# ---------- pictures ----------
def analyze(png):
    from PIL import Image, ImageFilter, ImageStat
    from collections import Counter
    im = Image.open(png).convert("RGB")
    small = im.resize((240, int(240 * im.height / im.width)))
    px = list(small.getdata())
    q = Counter((r >> 4, g >> 4, b >> 4) for r, g, b in px)
    edges = ImageStat.Stat(small.convert("L").filter(ImageFilter.FIND_EDGES)).mean[0]
    return dict(modal=q.most_common(1)[0][1] / len(px), colors=len(q), edges=edges, im=im)

def motion(a, b):
    from PIL import ImageChops
    d = ImageChops.difference(a, b).convert("L").resize((200, 120))
    px = list(d.getdata())
    return sum(1 for v in px if v > 12) / len(px)

# ---------- real browser ----------
def node_major(node):
    try:
        return int(subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v").split(".")[0])
    except Exception:
        return 0

def live_check(folder, shots, is_ad, n_scenes, js):
    live = pathlib.Path(__file__).with_name("live.mjs")
    node = shutil.which("node")
    nothing = "NOTHING was verified in a browser, so this is not a pass"
    if not node: return report("FAIL", f"node is not installed or not on PATH. {nothing}")
    if node_major(node) < 22: return report("FAIL", f"node 22 or newer is needed for the browser check (found {node_major(node)}). {nothing}")
    if not live.exists(): return report("FAIL", f"tools/live.mjs is missing. {nothing}")
    try:
        import PIL  # noqa
    except ImportError:
        return report("FAIL", f"Pillow is not installed (pip install pillow), so the pictures cannot be measured. {nothing}")
    shots.mkdir(parents=True, exist_ok=True)
    try:
        r = subprocess.run([node, str(live), str(folder / "index.html"), str(shots)], capture_output=True, text=True, timeout=200)
        data = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception as ex:
        return report("FAIL", f"the real browser check could not run ({ex}). {nothing}")
    if data.get("fatal"):
        return report("FAIL", f"{data['fatal']}. Install Edge or Chrome, or set CHECK_BROWSER to a browser path. {nothing}")

    for e in data.get("errors", [])[:6]:
        report("FAIL", "runtime: " + e)
    if data.get("interactions", 0) < 2:
        report("WARN", "fewer than 2 controls or stage interactions were found, are the controls inside .controls?")
    lay = data.get("layout") or {}
    if lay.get("zero_size_canvases"): report("FAIL", f"{lay['zero_size_canvases']} canvas has zero size, the stage will be blank")
    if lay.get("horizontal_overflow"): report("FAIL", "page scrolls sideways at 1440 wide")
    if (data.get("layout_narrow") or {}).get("horizontal_overflow"): report("FAIL", "page scrolls sideways at 800 wide")
    if (data.get("layout_phone") or {}).get("horizontal_overflow"): report("WARN", "page scrolls sideways at 390 wide (phone)")
    st = lay.get("stage")
    if st and not is_ad and (st[1] < 300 or st[0] < 500): report("WARN", f"stage is only {st[0]}x{st[1]}, too small to show anything")   # ads change shape with the Format control

    sh = data.get("shots", {})
    if "wide_a" not in sh:
        return report("FAIL", "the live check produced no screenshots")
    A = analyze(sh["wide_a"])
    print(f"      stats modal={A['modal']:.2f} colors={A['colors']} edges={A['edges']:.1f} interactions={data.get('interactions')} stage after the controls were used={st}")
    if A["modal"] > 0.97: report("FAIL", "screenshot is almost one flat color, the page looks blank")
    if A["colors"] < 14: report("WARN", f"only {A['colors']} distinct colors, looks flat")
    if "wide_still" in sh:
        S = analyze(sh["wide_still"])
        idle = motion(A["im"], S["im"])
        print(f"      idle motion changed_pixels={idle:.3f} (no pointer, 1.5s apart)")
        if idle < 0.0015: report("WARN", "nothing moves on its own when the pointer is away, add idle motion from time")
        if "wide_b" in sh:
            print(f"      pointer reaction changed_pixels={motion(S['im'], analyze(sh['wide_b'])['im']):.3f}")
    if "narrow" in sh and analyze(sh["narrow"])["modal"] > 0.97: report("FAIL", "800px wide screenshot is blank")

    if is_ad:
        fm = data.get("ad_format")
        print(f"      the checker clicked every control in page order, the ad ended in format {fm}")
        if fm != "9:16": report("WARN", f"the last Format button the checker clicked was expected to set 9:16, the ad ended in {fm!r}. Keep the Format buttons in the order 16:9, 1:1, 9:16 and check the data-format handler, otherwise 9:16 was not verified")
    scenes = data.get("scenes") or []
    if scenes or is_ad or "timeline(" in js:
        print(f"      scenes seen over the playback: {scenes}")
        if len(scenes) < 2:
            report("FAIL", "the timeline never left scene 0 during about 20 seconds. Check dur values, the total must be 16 seconds or less, and that timeline() is called")
        elif n_scenes and len(set(scenes)) < n_scenes:
            report("WARN", f"only scenes {sorted(set(scenes))} played in 20 seconds but the brief has {n_scenes}")
        keys = [k for k in sorted(sh) if k.startswith("scene_")]
        pics = [analyze(sh[k])["im"] for k in keys]
        if len(pics) >= 2:
            diffs = [motion(pics[i], pics[i + 1]) for i in range(len(pics) - 1)]
            names = [k.split("_s")[-1] for k in keys]      # the scene number each shot was taken in
            print("      scene to scene change: " + ", ".join(f"scene {names[i]} to {names[i + 1]} = {d:.2f}" for i, d in enumerate(diffs)))
            if max(diffs) < 0.01: report("WARN", "the scenes look identical, each scene should change what is on screen (slots, mood, layers)")
    print(f"      screenshots in {shots}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--shots", default=None)
    ap.add_argument("--lint-only", action="store_true")
    a = ap.parse_args()
    p = pathlib.Path(a.path).resolve()
    folder = p if p.is_dir() else p.parent
    print(f"checking {folder}")
    src = lint(folder)
    is_ad = bool(src and 'class="ad' in src["html"])
    n_scenes = lint_compose(folder, src) if (src and is_ad) else 0
    if a.lint_only:
        fails = [m for l, m in results if l == "FAIL"]
        print(f"\nresult: LINT ONLY, {'FAIL' if fails else 'no lint problems'}. NOT verified in a browser.  ({len(fails)} fail)")
        sys.exit(1 if fails else 0)
    if src:
        live_check(folder, (pathlib.Path(a.shots) if a.shots else folder / "_shots").resolve(), is_ad, n_scenes, src["js"])
    fails = [m for l, m in results if l == "FAIL"]
    print(f"\nresult: {'FAIL' if fails else 'PASS'}  ({len(fails)} fail, {sum(1 for l, _ in results if l == 'WARN')} warn)")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
