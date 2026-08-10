#!/usr/bin/env python3
"""Extract the China mirror links from jmcomicmi.net and probe them."""
import json, re, time, urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

SOURCE = "https://jmcomicmi.net/"
OUT = Path(__file__).resolve().parents[1] / "data" / "mirror.json"
UA = "jmhub-mirror-monitor/1.0 (+https://github.com/Carolove7/jmhub)"

class Page(HTMLParser):
    def __init__(self): super().__init__(); self.section = None; self.values = {"global": [], "southeast_asia": [], "china": [], "flow1": [], "flow2": []}
    def handle_starttag(self, tag, attrs):
        cls = dict(attrs).get("class", "")
        for key, name in (("global", "international"), ("southeast_asia", "southeast_asia"), ("china", "china"), ("flow1", "first_line"), ("flow2", "second_line")):
            if name in cls: self.section = key
    def handle_endtag(self, tag):
        if tag in ("div", "section"): self.section = None
    def handle_data(self, data):
        if self.section:
            for value in re.findall(r"(?:https?://)?(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:/[^\s<>\"']*)?", data):
                if not value.startswith(("http://", "https://")): value = "https://" + value
                value = value.rstrip(".,，。)")
                if value not in self.values[self.section]: self.values[self.section].append(value)

def fetch(url):
    last_error = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r: return r.read()
        except Exception as error:
            last_error = error
            time.sleep(attempt + 1)
    raise last_error

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None

def probe(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA}, method="HEAD")
        start = __import__("time").monotonic()
        opener = urllib.request.build_opener(NoRedirect)
        with opener.open(req, timeout=15) as r: status = r.status; location = r.headers.get("Location")
        result = {"ok": 200 <= status < 400, "status": status, "latency_ms": round((__import__("time").monotonic()-start)*1000)}
        if location: result["redirect_to"] = location
        return result
    except urllib.error.HTTPError as e:
        if 300 <= e.code < 400:
            return {"ok": False, "status": e.code, "redirect_to": e.headers.get("Location")}
        return {"ok": False, "status": e.code, "error": str(e)[:160]}
    except Exception as e: return {"ok": False, "error": str(e)[:160]}

def main():
    parser = Page(); parser.feed(fetch(SOURCE).decode("utf-8", "replace"))
    previous = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    checked = {u: probe(u) for key in ("china", "flow1", "flow2") for u in parser.values[key]}
    for url, result in checked.items():
        old_redirect = previous.get("checked", {}).get(url, {}).get("redirect_to")
        if old_redirect and not result.get("redirect_to"): result["redirect_to"] = old_redirect
    data = {"source": SOURCE, **parser.values, "checked": checked}
    data["updated_at"] = previous.get("updated_at") if all(previous.get(k) == data.get(k) for k in data) else datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not any(parser.values.values()): raise RuntimeError("No mirror URLs found on source page")

if __name__ == "__main__": main()
