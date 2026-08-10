#!/usr/bin/env python3
"""抓取 JM 发布页，并记录中国区镜像及其真实重定向状态。"""

import json
import re
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

SOURCE = "https://jmcomicmi.net/"
OUT = Path(__file__).resolve().parents[1] / "data" / "mirror.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36 JMHubMonitor/2.0"
BLOCKED_HOSTS = {"18comic.vip", "18comic.ink", "jmcomic-zzz.one", "jmcomic-zzz.org"}


class MirrorPageParser(HTMLParser):
    CLASS_TO_GROUP = {
        "international": "global",
        "southeast_asia": "southeast_asia",
        "china": "china",
        "first_line": "flow1",
        "second_line": "flow2",
    }

    def __init__(self):
        super().__init__()
        self.group = None
        self.values = {name: [] for name in ("global", "southeast_asia", "china", "flow1", "flow2")}

    def handle_starttag(self, tag, attrs):
        classes = set(dict(attrs).get("class", "").split())
        for class_name, group in self.CLASS_TO_GROUP.items():
            if class_name in classes:
                self.group = group
                break

    def handle_endtag(self, tag):
        if tag in ("div", "section"):
            self.group = None

    def handle_data(self, text):
        if not self.group:
            return
        pattern = r"(?:https?://)?(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:/[^\s<>\"']*)?"
        for value in re.findall(pattern, text):
            if not value.startswith(("http://", "https://")):
                value = "https://" + value
            value = value.rstrip(".,，。)")
            if value not in self.values[self.group]:
                self.values[self.group].append(value)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch(url):
    last_error = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=20) as response:
                return response.read()
        except Exception as error:
            last_error = error
            time.sleep(attempt + 1)
    completed = subprocess.run(
        ["curl", "--fail", "--silent", "--show-error", "--location", "--retry", "3", "--user-agent", UA, url],
        check=False,
        capture_output=True,
    )
    if completed.returncode == 0 and completed.stdout:
        return completed.stdout
    raise last_error


def probe(url):
    opener = urllib.request.build_opener(NoRedirect)
    last_error = None
    status = None
    location = None
    for method in ("HEAD", "GET"):
        headers = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"}
        if method == "GET": headers["Range"] = "bytes=0-0"
        request = urllib.request.Request(url, headers=headers, method=method)
        try:
            with opener.open(request, timeout=15) as response:
                status = response.status
                location = response.headers.get("Location")
            break
        except urllib.error.HTTPError as error:
            status = error.code
            location = error.headers.get("Location")
            if 300 <= status < 400: break
            last_error = error
        except Exception as error:
            last_error = error
    if status is None:
        return {"safe": False, "ok": False, "error": str(last_error)[:160]}

    result = {
        "safe": 200 <= status < 300 and not location,
        "ok": 200 <= status < 300,
        "status": status,
    }
    if location:
        redirect_to = urljoin(url, location)
        result["redirect_to"] = redirect_to
        result["safe"] = urlparse(redirect_to).hostname not in BLOCKED_HOSTS and urlparse(redirect_to).hostname == urlparse(url).hostname
    return result


def main():
    parser = MirrorPageParser()
    parser.feed(fetch(SOURCE).decode("utf-8", "replace"))
    if not any(parser.values.values()):
        raise RuntimeError("发布页没有解析到任何镜像地址")

    previous = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    checked = {}
    for group in ("china", "flow1", "flow2"):
        for url in parser.values[group]:
            result = probe(url)
            old = previous.get("checked", {}).get(url, {})
            if not result.get("redirect_to") and old.get("redirect_to") and not result.get("safe"):
                result["redirect_to"] = old["redirect_to"]
            checked[url] = result

    data = {"source": SOURCE, **parser.values, "checked": checked}
    unchanged = all(previous.get(key) == value for key, value in data.items())
    data["updated_at"] = previous.get("updated_at") if unchanged else datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
