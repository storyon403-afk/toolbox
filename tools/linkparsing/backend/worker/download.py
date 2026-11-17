"""Restricted yt-dlp sidecar. One private request file in, one redacted JSON result out.

No browser cookies, yt-dlp user config, plugins, shell, or remote JS components.
Windows uses the current user's explicitly enabled manual HTTP system proxies.
Python network checks are defense in depth, not an OS sandbox for native subprocesses.
"""
import functools
import errno
import hashlib
from copy import deepcopy
import http.client
import ipaddress
import json
import math
import os
from pathlib import Path
import re
try:
    import resource
except ImportError:  # Windows: the Rust parent monitors scratch and kills the process job.
    resource = None
import socket
import ssl
import sys
import time
import urllib.request
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

MAX_FILE = 4 * 1024**3
MAX_DIRECTORY = 8 * 1024**3
HOSTS = {
    "youtube": {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"},
    "douyin": {"douyin.com", "www.douyin.com", "v.douyin.com", "iesdouyin.com", "www.iesdouyin.com"},
    "bilibili": {"bilibili.com", "www.bilibili.com", "m.bilibili.com", "b23.tv"},
}
SHORT_HOSTS = {"v.douyin.com", "b23.tv"}


class Failure(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def public_ip(value):
    try:
        address = ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped or address.sixtofour or address.teredo:
            return False
        if address in ipaddress.ip_network("64:ff9b::/96") or address in ipaddress.ip_network("64:ff9b:1::/48"):
            return False
    return address.is_global and not address.is_multicast


def validate_http_url(url):
    try:
        p = urlsplit(url)
        if p.scheme not in ("http", "https") or not p.hostname or p.username is not None or p.password is not None or p.port not in (None, 80, 443):
            raise Failure("network_policy")
        if any(ord(c) < 32 for c in url):
            raise Failure("network_policy")
        return p
    except ValueError:
        raise Failure("network_policy") from None


def windows_system_proxies():
    """Read registry settings only, never *_PROXY environment variables or PAC code."""
    if sys.platform != "win32":
        return {}
    proxies = urllib.request.getproxies_registry()
    result = {}
    for scheme in ("http", "https"):
        value = proxies.get(scheme)
        if not value:
            continue
        try:
            parsed = urlsplit(value)
            if (parsed.scheme != "http" or not parsed.hostname
                    or not 1 <= (80 if parsed.port is None else parsed.port) <= 65535
                    or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                    or any(ord(c) < 32 for c in value)):
                raise Failure("network_policy")
        except ValueError:
            raise Failure("network_policy") from None
        result[scheme] = value
    return result


def guarded_urllib_handler(validate_request):
    """Check every request, including redirects handled inside urllib's opener."""
    from yt_dlp.networking._urllib import UrllibRH

    class DestinationGuard(urllib.request.BaseHandler):
        handler_order = 90

        def http_request(self, request):
            validate_request(request.full_url)
            return request

        https_request = http_request

    class GuardedUrllibRH(UrllibRH):
        def _create_instance(self, *args, **kwargs):
            opener = super()._create_instance(*args, **kwargs)
            opener.add_handler(DestinationGuard())
            return opener

    return GuardedUrllibRH


def install_network_guard(doh_fallback=False, proxies=None):
    """Pin proxy peers; validate destinations separately from transport connections."""
    proxies = proxies or {}
    original_resolve = socket.getaddrinfo
    original_socket = socket.socket
    cache = {}
    proxy_answers = {}
    proxy_peers = set()
    for value in set(proxies.values()):
        parsed = urlsplit(value)
        key = (parsed.hostname, str(parsed.port or 80))
        answers = original_resolve(key[0], int(key[1]), type=socket.SOCK_STREAM)
        if not answers:
            raise Failure("network_unavailable")
        proxy_answers[key] = answers
        for answer in answers:
            address = ipaddress.ip_address(answer[4][0])
            if address.is_unspecified or address.is_multicast:
                raise Failure("network_policy")
            proxy_peers.add((answer[4][0], int(key[1])))

    def validate_request(url):
        parsed = validate_http_url(url)
        host = parsed.hostname.rstrip(".").lower()
        try:
            ipaddress.ip_address(host)
        except ValueError:
            if "." not in host or host.endswith((".localhost", ".local", ".internal")):
                raise Failure("network_policy")
        else:
            if not public_ip(host):
                raise Failure("network_policy")
        # urllib forwards proxied hostnames without local DNS. The explicitly
        # configured proxy is trusted to resolve and route upstream destinations;
        # local FakeIP/poisoned DNS is neither authoritative nor used for transport.
        # We cannot enforce upstream private-address rejection behind that proxy.
        # Direct/bypassed requests still undergo DNS and actual socket checks below.

    def public_dns(host, port, args, kwargs):
        import certifi
        host = host.decode("ascii") if isinstance(host, bytes) else host
        # Only hostnames may use the fallback; literal private addresses always fail closed.
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise Failure("network_policy")
        family = args[0] if args else kwargs.get("family", socket.AF_UNSPEC)
        record_type = 28 if family == socket.AF_INET6 else 1
        key = (host, record_type)
        if key not in cache or cache[key][0] < time.monotonic():
            connection = http.client.HTTPSConnection("1.1.1.1", timeout=10, context=ssl.create_default_context(cafile=certifi.where()))
            try:
                connection.request("GET", "/dns-query?" + urlencode({"name": host, "type": record_type}), headers={"Accept": "application/dns-json"})
                response = connection.getresponse()
                body = response.read(65537)
                if response.status != 200 or len(body) > 65536:
                    raise Failure("network_unavailable")
                data = json.loads(body)
                addresses = [a["data"] for a in data.get("Answer", []) if a.get("type") == record_type]
                if data.get("Status") != 0 or not addresses or any(not public_ip(ip) for ip in addresses):
                    raise Failure("network_policy")
                if len(cache) >= 256:
                    cache.clear()
                cache[key] = (time.monotonic() + 60, addresses)
            finally:
                connection.close()
        return [answer for ip in cache[key][1] for answer in original_resolve(ip, port, *args, **kwargs)]

    def resolve(host, port, *args, **kwargs):
        name = host.decode("ascii") if isinstance(host, bytes) else host
        if (name, str(port)) in proxy_answers:
            # Pin the configured endpoint instead of resolving it again.
            family = args[0] if args else kwargs.get("family", socket.AF_UNSPEC)
            return [a for a in proxy_answers[(name, str(port))] if family in (socket.AF_UNSPEC, a[0])]
        if any(name == ip and str(port) == str(proxy_port) for ip, proxy_port in proxy_peers):
            return original_resolve(host, port, *args, **kwargs)
        if str(port) not in ("80", "443"):
            raise Failure("network_policy")
        try:
            answers = original_resolve(host, port, *args, **kwargs)
        except socket.gaierror:
            if doh_fallback:
                return public_dns(host, port, args, kwargs)
            raise
        if not answers or any(not public_ip(item[4][0]) for item in answers):
            if doh_fallback:
                return public_dns(host, port, args, kwargs)
            # Distinguish a hostname resolved by proxy/FakeIP DNS from an actual
            # private destination. The former has an explicit safe recovery path.
            try:
                ipaddress.ip_address(host)
            except ValueError:
                raise Failure("dns_not_public") from None
            raise Failure("network_policy")
        return answers

    class PublicSocket(original_socket):
        def connect(self, address):
            if self.family in (socket.AF_INET, socket.AF_INET6):
                if not isinstance(address, tuple) or (address[:2] not in proxy_peers and (address[1] not in (80, 443) or not public_ip(address[0]))):
                    raise Failure("network_policy")
            return super().connect(address)

        def connect_ex(self, address):
            if self.family in (socket.AF_INET, socket.AF_INET6):
                if not isinstance(address, tuple) or (address[:2] not in proxy_peers and (address[1] not in (80, 443) or not public_ip(address[0]))):
                    raise Failure("network_policy")
            return super().connect_ex(address)

    socket.getaddrinfo = resolve
    socket.socket = PublicSocket
    return validate_request


def canonical_video(url, platform):
    p = validate_http_url(url)
    if p.hostname not in HOSTS.get(platform, set()):
        raise Failure("unsupported_url")
    query = parse_qs(p.query)
    if platform == "douyin":
        match = re.fullmatch(r"/(?:video|share/video)/(\d+)/?", p.path)
        if match:
            return "https://www.douyin.com/video/" + match[1]
        # The redirect page can use the modal_id form; never accept arbitrary webpage embeds.
        if p.path in ("/", "/discover") and re.fullmatch(r"\d+", query.get("modal_id", [""])[0]):
            return "https://www.douyin.com/video/" + query["modal_id"][0]
    elif platform == "bilibili":
        match = re.fullmatch(r"/video/(BV[A-Za-z0-9]+|av\d+)/?", p.path)
        if match:
            part = query.get("p", ["1"])[0]
            if not part.isdigit() or not 1 <= int(part) <= 1000:
                raise Failure("unsupported_url")
            return "https://www.bilibili.com/video/" + match[1] + ("?p=" + part if part != "1" else "")
    elif platform == "youtube":
        video = query.get("v", [""])[0] if p.path == "/watch" else ""
        if p.hostname == "youtu.be":
            video = p.path.strip("/")
        else:
            match = re.fullmatch(r"/(?:shorts|embed|live)/([A-Za-z0-9_-]{11})/?", p.path)
            if match:
                video = match[1]
        if re.fullmatch(r"[A-Za-z0-9_-]{11}", video):
            return "https://www.youtube.com/watch?" + urlencode({"v": video})
    raise Failure("unsupported_url")


def classify(message):
    # yt-dlp can wrap transport errors without including their messages in the outer error.
    pending = [message]
    seen = set()
    network_error = False
    network_codes = {errno.ECONNREFUSED, errno.ECONNRESET, errno.ECONNABORTED,
                     errno.ENETUNREACH, errno.EHOSTUNREACH, errno.ETIMEDOUT,
                     10051, 10053, 10054, 10060, 10061, 10065, 11001}
    while pending and len(seen) < 30:
        item = pending.pop()
        if id(item) in seen:
            continue
        seen.add(id(item))
        if isinstance(item, Failure):
            return item.code
        # Windows socket messages are localized; classify by type/code instead.
        if isinstance(item, (ConnectionError, TimeoutError, socket.gaierror, ssl.SSLError)) or (
                isinstance(item, OSError) and
                (item.errno in network_codes or getattr(item, "winerror", None) in network_codes)):
            network_error = True
        for key in ("cause", "__cause__"):
            if getattr(item, key, None) is not None:
                pending.append(getattr(item, key))
        pending.extend(getattr(item, "unexpected_errors", []) or [])
        if getattr(item, "exc_info", None):
            pending.extend(x for x in item.exc_info if isinstance(x, Exception))
    s = str(message).lower()
    if "dns_not_public" in s:
        return "dns_not_public"
    if "network_policy" in s:
        return "network_policy"
    if network_error:
        return "network_unavailable"
    if any(x in s for x in ("429", "too many requests", "rate limit", "412", "risk control")):
        return "rate_limited"
    if any(x in s for x in ("cookies", "sign in", "login", "log in", "confirm you're not a bot", "403")):
        return "authentication_required"
    if any(x in s for x in ("timed out", "connection", "resolve", "network", "certificate", "ssl", "502", "503")):
        return "network_unavailable"
    if any(x in s for x in ("private video", "removed", "unavailable", "not available", "404", "deleted")):
        return "video_unavailable"
    if "unsupported" in s:
        return "unsupported_url"
    return "extractor_failed"


def metadata(info, platform, canonical):
    if not info or info.get("_type", "video") != "video" or info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming", "post_live"):
        raise Failure("unsupported_media")
    duration = info.get("duration")
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 0 < duration <= 43200:
        raise Failure("unsupported_duration")
    if info.get("has_drm"):
        raise Failure("unsupported_media")
    return {"platform": platform, "id": str(info.get("id", ""))[:200],
            "title": re.sub(r"[\x00-\x1f\x7f]", " ", str(info.get("title", "")))[:500],
            "duration_ms": round(duration * 1000), "canonical_url": canonical,
            "width": info.get("width"), "height": info.get("height"), "watermark": "unknown"}


def check_download_info(info):
    for item in info.get("requested_formats") or [info]:
        if item.get("protocol") not in ("http", "https", "m3u8_native", "http_dash_segments") or item.get("has_drm"):
            raise Failure("unsupported_media")
        validate_http_url(item["url"])
        for fragment in item.get("fragments") or []:
            if fragment.get("url"):
                validate_http_url(fragment["url"])


def prepare_formats(info, platform):
    # Bilibili CDN may return HTTP 567 without a byte range (yt-dlp issue #17847).
    # Keep this on media requests; API/webpage requests and other platforms are unchanged.
    if platform == "bilibili":
        for item in info.get("formats") or [info]:
            if item.get("url") and item.get("protocol", "https") in ("http", "https"):
                # A format-level header dict replaces the extractor's headers in
                # yt-dlp. Keep its Referer when adding the CDN range requirement.
                item["http_headers"] = {**info.get("http_headers", {}), **item.get("http_headers", {})}
                item["http_headers"].setdefault("Range", "bytes=0-")


def bilibili_web_cdn(play_info):
    """Use a platform-provided web backup when its primary CDN violates policy."""
    result = deepcopy(play_info)
    dash = result.get("dash") or {}
    media = [*(dash.get("audio") or []), *(dash.get("video") or []), *(result.get("durl") or [])]
    media.extend((dash.get("dolby") or {}).get("audio") or [])
    flac = (dash.get("flac") or {}).get("audio")
    if flac:
        media.append(flac)
    for item in media:
        key = next((key for key in ("baseUrl", "base_url", "url") if item.get(key)), None)
        if not key:
            continue
        try:
            validate_http_url(item[key])
            continue
        except Failure:
            pass
        for url in item.get("backupUrl") or item.get("backup_url") or []:
            if not isinstance(url, str):
                continue
            try:
                validate_http_url(url)
            except Failure:
                continue
            item[key] = url
            break
    return result


def douyin_detail_query(video_id, token, timestamp=None):
    # Douyin web-detail protocol; see yt-dlp PR #17826 (Unlicense).
    # Use only the session explicitly supplied to this worker; never fabricate login cookies.
    if not isinstance(token, str) or not token:
        raise Failure("authentication_required")
    stamp = str(int(time.time() if timestamp is None else timestamp))
    query = {"aweme_id": video_id, "aid": 6383, "uifid": token, "timestamp": stamp}
    material = f"{token}_{stamp}_A96D855A08C0A9707F8BEF0D9A527E4E_{urlencode(query)}"
    query["x-secsdk-web-signature"] = hashlib.md5(material.encode()).hexdigest()
    return query


def execute(request, proxies=None, validate_request=None):
    from yt_dlp import YoutubeDL
    from yt_dlp.globals import plugin_dirs
    from yt_dlp.networking import Request
    from yt_dlp.networking._urllib import UrllibRH
    from yt_dlp.version import __version__
    from yt_dlp.extractor.bilibili import BiliBiliIE as UpstreamBiliBiliIE
    from yt_dlp.extractor.tiktok import DouyinIE as UpstreamDouyinIE
    from yt_dlp.utils import ExtractorError

    plugin_dirs.value = []
    if request.get("action") == "doctor":
        return {"ok": True, "version": __version__}
    if request.get("action") not in ("resolve", "download"):
        raise Failure("invalid_request")
    platform = request["platform"]
    p = validate_http_url(request["url"])
    if p.hostname not in HOSTS.get(platform, set()):
        raise Failure("unsupported_url")
    if not Path(request["ffmpeg"]).is_absolute() or not Path(request["ffmpeg"]).is_file():
        raise Failure("missing_dependency")
    root = Path.cwd().resolve()
    last_budget_check = 0.0

    def budget(_=None):
        nonlocal last_budget_check
        now = time.monotonic()
        if now - last_budget_check < .25:
            return
        last_budget_check = now
        total = 0
        for path in root.iterdir():
            if path.is_symlink():
                raise Failure("invalid_output")
            if path.is_file():
                size = path.stat().st_size
                if size > MAX_FILE:
                    raise Failure("size_limit")
                total += size
        if total > MAX_DIRECTORY:
            raise Failure("size_limit")

    class Quiet:
        def debug(self, _): pass
        def info(self, _): pass
        def warning(self, _): pass
        def error(self, _): pass

    class BiliBiliIE(UpstreamBiliBiliIE):
        def extract_formats(self, play_info):
            return super().extract_formats(bilibili_web_cdn(play_info))

    class DouyinIE(UpstreamDouyinIE):
        def _real_extract(self, url):
            video_id = self._match_id(url)
            cookies = self._get_cookies(self._WEBPAGE_HOST)
            names = ("uifid", "uifid_temp", "uifidtemp", "UIFID", "UIFID_TEMP", "UIFIDTEMP")
            token = next((cookies[name].value for name in names if name in cookies), None)
            try:
                response = self._download_json(
                    "https://www.douyin.com/aweme/v1/web/aweme/detail/", video_id,
                    query=douyin_detail_query(video_id, token),
                    headers={"Referer": self._WEBPAGE_HOST})
            except ExtractorError as error:
                # An empty/non-JSON challenge differs from a failed transport.
                if isinstance(error.cause, json.JSONDecodeError):
                    raise Failure("authentication_required") from None
                raise
            detail = response.get("aweme_detail") if isinstance(response, dict) else None
            if not isinstance(detail, dict) or not detail:
                raise Failure("authentication_required")
            return {**self._parse_aweme_video_app(detail), "http_headers": {"Referer": self._WEBPAGE_HOST}}

    class RestrictedYDL(YoutubeDL):
        @functools.cached_property
        def proxies(self):
            # No implicit environment proxy discovery; registry snapshot only.
            return proxies or {"all": "__noproxy__"}

        @functools.cached_property
        def _request_director(self):
            # Keep connections in Python, where address checks apply; don't enable curl_cffi.
            handler = guarded_urllib_handler(validate_request) if validate_request else UrllibRH
            return self.build_request_director([handler])

        def urlopen(self, request):
            validate_http_url(request if isinstance(request, str) else request.url)
            return super().urlopen(request)

        def process_ie_result(self, result, download=True, extra_info=None):
            if result.get("_type") in ("playlist", "multi_video", "compat_list"):
                raise Failure("unsupported_media")
            prepare_formats(result, platform)
            return super().process_ie_result(result, download, extra_info)

        def process_info(self, info):
            metadata(info, platform, canonical)
            check_download_info(info)
            return super().process_info(info)

    params = {
        "logger": Quiet(), "quiet": True, "no_warnings": True, "noprogress": True,
        "noplaylist": True, "allowed_extractors": ["youtube$", "bilibili$", "douyin$"],
        "cachedir": False, "proxy": "", "enable_file_urls": False, "nocheckcertificate": False,
        "socket_timeout": 15, "retries": 2, "fragment_retries": 2, "extractor_retries": 1,
        "concurrent_fragment_downloads": 1, "skip_unavailable_fragments": False,
        "format": "bv*+ba/b", "hls_prefer_native": True, "merge_output_format": "mkv",
        "max_filesize": MAX_FILE, "overwrites": False, "continuedl": False,
        "outtmpl": str(root / "media.%(ext)s"), "ffmpeg_location": request["ffmpeg"],
        "writethumbnail": False, "writeinfojson": False, "writesubtitles": False,
        "remote_components": [], "js_runtimes": {}, "progress_hooks": [budget],
        "postprocessor_hooks": [budget], "check_formats": "selected",
    }
    if request.get("node"):
        if not Path(request["node"]).is_absolute() or not Path(request["node"]).is_file():
            raise Failure("missing_dependency")
        params["js_runtimes"] = {"node": {"path": request["node"]}}
    if request.get("cookie_file"):
        # Rust has copied the explicitly supplied cookie file into this private scratch directory.
        cookie = (root / "cookies.txt")
        if cookie.is_symlink() or not cookie.is_file() or not Path(request["cookie_file"]).samefile(cookie):
            raise Failure("invalid_request")
        params["cookiefile"] = str(cookie)
    if resource is not None:
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE, MAX_FILE))
    with RestrictedYDL(params) as ydl:
        if platform == "bilibili":
            ydl.add_info_extractor(BiliBiliIE())
        elif platform == "douyin":
            ydl.add_info_extractor(DouyinIE())
        url = request["url"]
        if p.hostname in SHORT_HOSTS:
            # Discard the body: redirects pass destination checks; transport uses the IP guard.
            with ydl.urlopen(Request(url, method="GET")) as response:
                url = response.url
        canonical = canonical_video(url, platform)
        info = ydl.extract_info(canonical, download=request["action"] == "download")
        result = metadata(info, platform, canonical)
    if request["action"] == "download":
        files = [p for p in root.glob("media.*") if p.suffix in (".mp4", ".mkv", ".webm", ".mov", ".m4a", ".mp3", ".ogg") and p.is_file() and not p.is_symlink()]
        if len(files) != 1 or not 0 < files[0].stat().st_size <= MAX_FILE:
            raise Failure("invalid_output")
        result["media_file"] = files[0].name
    return {"ok": True, "video": result}


def main():
    try:
        request_path = Path(sys.argv[1])
        if request_path.stat().st_size > 32768:
            raise Failure("invalid_request")
        request = json.loads(request_path.read_text(encoding="utf-8"))
        dns = request.get("dns", "system")
        if dns not in ("system", "auto"):
            raise Failure("invalid_request")
        proxies = windows_system_proxies() if request.get("action") != "doctor" else {}
        validate_request = install_network_guard(doh_fallback=dns == "auto", proxies=proxies)
        result = execute(request, proxies, validate_request)
    except Failure as error:
        result = {"ok": False, "error": error.code}
    except ImportError:
        result = {"ok": False, "error": "missing_dependency"}
    except Exception as error:
        result = {"ok": False, "error": classify(error)}
    # Never include raw exception strings, signed media URLs or cookie values in the response.
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
