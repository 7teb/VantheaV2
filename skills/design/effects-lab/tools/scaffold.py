"""
Sets up the output folder for a build. Works on Windows, macOS and Linux.

  python <skill folder>/tools/scaffold.py <style> <OUT>      one style page
  python <skill folder>/tools/scaffold.py compose <OUT>      a composed ad with scenes

It copies the kit, writes index.html from the right template with the number and title filled in,
picks the stage height class from the card, and creates empty styles.css and app.js with a TODO marker.
check.py fails while a TODO marker or a placeholder word is still in the files.
"""
import re, shutil, sys, pathlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
STYLES = ["particles", "liquid_morph", "holographic", "neon_glow", "wireframe_3d", "glassmorphism", "kinetic_type",
          "isometric", "clay_3d", "ascii_art", "gradient_mesh", "comic_book", "split_flap", "retro_vhs", "halftone",
          "bauhaus", "pixel_art", "blueprint", "art_deco", "neo_brutalism"]

def title_of(name):
    return " ".join(w.capitalize() for w in name.replace("_3d", " 3d").split("_")).replace(" 3d", " 3D").strip()

def stage_class(card_text, name):
    if name == "bauhaus":
        return "stage bau"                       # the tile grid sets the height, no h_md or h_lg
    if re.search(r"stage\.h_lg|`h_lg`|\bh_lg\b", card_text) and "h_lg" in card_text:
        return "stage h_lg"
    return "stage h_md"

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(2)
    name, out = sys.argv[1], pathlib.Path(sys.argv[2])
    compose = name == "compose"
    if not compose and name not in STYLES:
        print(f"unknown style '{name}'. Styles: {', '.join(STYLES)} or compose"); sys.exit(2)
    out.mkdir(parents=True, exist_ok=True)
    kit = ROOT / "kit"
    files = ["base.css", "helpers.js"] + (["ad.css"] if compose else [])
    for f in files:
        shutil.copy2(kit / f, out / f)

    if compose:
        html = (kit / "template_ad.html").read_text(encoding="utf-8").replace("STYLE_NAME", "SUBJECT_TITLE")
        note = "Next: read styles/compose.md, write brief.md first, then fill index.html, styles.css and app.js."
    else:
        card = (ROOT / "styles" / f"{name}.md").read_text(encoding="utf-8")
        html = (kit / "template.html").read_text(encoding="utf-8")
        html = html.replace("STYLE_NAME", title_of(name)).replace("NN", f"{STYLES.index(name) + 1:02d}").replace("LABEL", title_of(name))
        cls = stage_class(card, name)
        html = html.replace('class="stage h_md reveal"', f'class="{cls} reveal"')
        note = f"Next: read styles/{name}.md fully, then fill in the stage markup, styles.css and app.js. Stage class chosen: {cls}."
    (out / "index.html").write_text(html, encoding="utf-8")
    (out / "styles.css").write_text("/* TODO stage styles */\n", encoding="utf-8")
    (out / "app.js").write_text("'use strict';\n\nfunction init() {\n  // TODO build the stage\n}\ninit();\n", encoding="utf-8")
    print(f"created {out}: index.html, styles.css, app.js, " + ", ".join(files))
    print(note)

if __name__ == "__main__":
    main()
