"""Build post-check.html and extension/network-code.js from network-code.json.

Refresh the rules first with:  python3 build.py --fetch
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
API = "https://farcaster.xyz/~api/v2/network-code/content?keys=network-school.code"


def fetch():
    req = urllib.request.Request(API, headers={"User-Agent": "curl/8.7.1", "Accept": "application/json"})
    with urllib.request.urlopen(req) as r:
        data = json.load(r)
    entry = next(x for x in data["result"]["content"] if x["key"] == "network-school.code")
    nc = entry["value"]["networkCode"]
    out = {
        "version": entry["version"],
        "source": "https://farcaster.xyz/~/code",
        "replyContextNote": nc["replyContextNote"],
        "rules": [
            {
                "id": r["section"],
                "anchor": r.get("anchor"),
                "kind": r["kind"],
                "severity": r.get("severity"),
                "title": r["title"],
                "definition": r["definition"],
                "doesntCount": r["doesntCount"],
                "question": r["question"],
                "perPost": g["posts"],
            }
            for g in nc["groups"]
            for r in g["rules"]
        ],
    }
    (ROOT / "network-code.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"network-code.json updated to v{out['version']} ({len(out['rules'])} rules)")


def build():
    code = json.loads((ROOT / "network-code.json").read_text())
    code_js = "globalThis.NETWORK_CODE = " + json.dumps(code, ensure_ascii=False) + ";\n"
    (ROOT / "extension" / "network-code.js").write_text(code_js)
    engine_js = (ROOT / "extension" / "engine.js").read_text()
    html = (ROOT / "src" / "template.html").read_text()
    html = html.replace("/*__NETWORK_CODE__*/", code_js.replace("</", "<\\/"))
    html = html.replace("/*__ENGINE__*/", engine_js.replace("</", "<\\/"))
    (ROOT / "post-check.html").write_text(html)
    print(f"post-check.html and extension/network-code.js built with Network Code v{code['version']}")


if __name__ == "__main__":
    if "--fetch" in sys.argv:
        fetch()
    build()
