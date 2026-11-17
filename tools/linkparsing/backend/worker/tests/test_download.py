import importlib.util
import json
from pathlib import Path
import socket
import sys
import os
import threading
import tempfile
from types import SimpleNamespace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location("worker", Path(__file__).resolve().parents[1] / "download.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WindowsCompatibilityTests(unittest.TestCase):
    def test_worker_imports_and_doctor_runs_without_unix_resource(self):
        with patch.dict(sys.modules, {"resource": None}):
            portable = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(portable)
        self.assertIsNone(portable.resource)
        self.assertTrue(portable.execute({"action": "doctor"})["ok"])


class NetworkTests(unittest.TestCase):
    def test_windows_proxy_reads_registry_without_environment_inheritance(self):
        configured = {"http": "http://127.0.0.1:17897", "https": "http://127.0.0.1:17897", "ftp": "http://ignored:21"}
        with patch.object(sys, "platform", "win32"), patch.object(urllib.request, "getproxies_registry", return_value=configured, create=True), patch.dict(os.environ, {"HTTPS_PROXY": "http://untrusted.example:9999"}):
            self.assertEqual(worker.windows_system_proxies(), {k: configured[k] for k in ("http", "https")})
            for proxy in ("socks5://127.0.0.1:1080", "http://proxy:0", "http://proxy:70000", "http://proxy/path", "http://proxy/?token=x"):
                with patch.object(urllib.request, "getproxies_registry", return_value={"https": proxy}):
                    with self.assertRaises(worker.Failure):
                        worker.windows_system_proxies()
            with patch.object(urllib.request, "getproxies_registry", return_value={}):
                self.assertEqual(worker.windows_system_proxies(), {})
        with patch.object(sys, "platform", "darwin"):
            self.assertEqual(worker.windows_system_proxies(), {})

    def test_proxy_endpoint_exception_does_not_allow_private_destinations(self):
        original_resolve, original_socket = socket.getaddrinfo, socket.socket
        proxy = {"https": "http://127.0.0.1:17897"}
        def resolve(host, port, *args, **kwargs):
            address = {"public.example": "198.18.0.1", "private.example": "10.0.0.1", "proxy.example": "127.0.0.1"}.get(host, host)
            if host == "unresolved.example":
                raise socket.gaierror()
            return original_resolve(address, port, *args, **kwargs)
        with patch.object(sys, "platform", "darwin"), patch.object(socket, "getaddrinfo", side_effect=resolve):
            try:
                validate = worker.install_network_guard(proxies=proxy)
                validate("https://public.example/video")
                validate("https://unresolved.example/video")
                for url in ("https://127.0.0.1/", "https://[::1]/", "https://10.0.0.1/", "https://localhost/", "https://name.local/", "https://name.internal/", "https://public.example:8082/video", "https://198.18.0.1/"):
                    with self.assertRaises(worker.Failure, msg=url):
                        validate(url)
                self.assertEqual(socket.getaddrinfo("127.0.0.1", 17897)[0][4], ("127.0.0.1", 17897))
                with self.assertRaises(worker.Failure):
                    socket.getaddrinfo("127.0.0.1", 17898)
                with self.assertRaises(worker.Failure):
                    socket.getaddrinfo("private.example", 443)
                with socket.socket() as connection:
                    with self.assertRaises(worker.Failure):
                        connection.connect(("127.0.0.1", 17898))
                    with self.assertRaises(worker.Failure):
                        connection.connect_ex(("198.18.0.1", 443))
            finally:
                socket.socket = original_socket

    def test_proxied_hostname_does_not_depend_on_local_fake_ipv6_dns(self):
        original_resolve, original_socket = socket.getaddrinfo, socket.socket
        def resolve(host, port, *args, **kwargs):
            if host == "public.example":
                raise AssertionError("Proxied destination must be resolved by the proxy")
            return original_resolve(host, port, *args, **kwargs)
        with patch.object(socket, "getaddrinfo", side_effect=resolve):
            try:
                validate = worker.install_network_guard(proxies={"https": "http://127.0.0.1:17897"})
                validate("https://public.example/video")
                with self.assertRaises(worker.Failure):
                    validate("https://[2001::1]/video")
                with socket.socket(socket.AF_INET6) as connection:
                    with self.assertRaises(worker.Failure):
                        connection.connect(("2001::1", 443))
            finally:
                socket.socket = original_socket

    def test_real_proxy_transport_and_private_redirect_rejection(self):
        from yt_dlp.networking import Request
        requests = []
        class Proxy(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                if self.path.endswith("/redirect"):
                    self.send_response(302)
                    self.send_header("Location", "http://127.0.0.1/private")
                    self.end_headers()
                else:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"proxied fixture")
            def log_message(self, *_):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Proxy)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        original_resolve, original_socket = socket.getaddrinfo, socket.socket
        proxies = {"http": f"http://127.0.0.1:{server.server_port}"}
        def resolve(host, port, *args, **kwargs):
            return original_resolve("198.18.0.1" if host == "public.example" else host, port, *args, **kwargs)
        try:
            with patch.object(sys, "platform", "darwin"), patch.dict(os.environ, {}, clear=True), patch.object(socket, "getaddrinfo", side_effect=resolve):
                try:
                    validate = worker.install_network_guard(proxies=proxies)
                    handler = worker.guarded_urllib_handler(validate)(logger=MagicMock(), proxies=proxies, timeout=2)
                    with handler:
                        with handler.send(Request("http://public.example/video")) as response:
                            self.assertEqual(response.read(), b"proxied fixture")
                        with self.assertRaises(Exception) as error:
                            handler.send(Request("http://public.example/redirect"))
                        self.assertEqual(worker.classify(error.exception), "network_policy")
                    self.assertEqual(requests, ["http://public.example/video", "http://public.example/redirect"])
                finally:
                    socket.socket = original_socket
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_fake_dns_has_actionable_code_without_allowing_private_connections(self):
        original_socket = socket.socket
        answer = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.18.0.1", 443))]
        with patch.object(socket, "getaddrinfo", return_value=answer):
            try:
                worker.install_network_guard()
                with self.assertRaises(worker.Failure) as error:
                    socket.getaddrinfo("www.bilibili.com", 443)
                self.assertEqual(error.exception.code, "dns_not_public")
                with self.assertRaises(worker.Failure) as error:
                    socket.getaddrinfo("127.0.0.1", 443)
                self.assertEqual(error.exception.code, "network_policy")
                with socket.socket() as connection:
                    with self.assertRaises(worker.Failure) as error:
                        connection.connect(("198.18.0.1", 443))
                    self.assertEqual(error.exception.code, "network_policy")
            finally:
                socket.socket = original_socket

    def test_opt_in_public_dns_is_pinned_and_rejects_private_literals(self):
        original_socket = socket.socket
        public_answer = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
        fake_answer = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.18.0.1", 443))]
        connection = MagicMock()
        response = connection.getresponse.return_value
        response.status = 200
        response.read.return_value = json.dumps({"Status": 0, "Answer": [{"type": 1, "data": "8.8.8.8"}]}).encode()
        def resolver(host, *args, **kwargs):
            return public_answer if host == "8.8.8.8" else fake_answer
        with patch.object(socket, "getaddrinfo", side_effect=resolver), patch.object(worker.http.client, "HTTPSConnection", return_value=connection) as https:
            try:
                worker.install_network_guard(doh_fallback=True)
                self.assertEqual(socket.getaddrinfo("example.com", 443), public_answer)
                self.assertEqual(socket.getaddrinfo("example.com", 443), public_answer)
                self.assertEqual(https.call_count, 1, "reuse bounded DNS cache")
                self.assertEqual(https.call_args.args[0], "1.1.1.1")
                with self.assertRaises(worker.Failure):
                    socket.getaddrinfo("127.0.0.1", 443)
                response.read.return_value = json.dumps({"Status": 0, "Answer": [{"type": 1, "data": "169.254.169.254"}]}).encode()
                with self.assertRaises(worker.Failure):
                    socket.getaddrinfo("evil.example", 443)
            finally:
                socket.socket = original_socket

    def test_private_and_transition_addresses_are_blocked(self):
        for ip in ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "198.18.0.1", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:8.8.8.8", "64:ff9b::7f00:1", "2002:7f00:1::"]:
            self.assertFalse(worker.public_ip(ip), ip)
        self.assertTrue(worker.public_ip("8.8.8.8"))
        self.assertTrue(worker.public_ip("2606:4700:4700::1111"))

    def test_unsupported_schemes_credentials_and_ports(self):
        for url in ["file:///etc/passwd", "ftp://example.com/file", "https://name:secret@example.com", "https://example.com:8080/a", "https://example.com/\x00"]:
            with self.assertRaises(worker.Failure):
                worker.validate_http_url(url)

    def test_dns_mixed_answers_and_actual_connect_address(self):
        answer = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443)), (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        original_socket = socket.socket
        with patch.object(socket, "getaddrinfo", return_value=answer):
            try:
                worker.install_network_guard()
                with self.assertRaises(worker.Failure):
                    socket.getaddrinfo("example.com", 443)
                with socket.socket() as connection:
                    with self.assertRaises(worker.Failure):
                        connection.connect(("127.0.0.1", 443))
                    with self.assertRaises(worker.Failure):
                        connection.connect_ex(("10.0.0.1", 80))
            finally:
                socket.socket = original_socket


class PlatformTests(unittest.TestCase):
    def test_three_platform_video_urls(self):
        self.assertEqual(worker.canonical_video("https://youtu.be/BaW_jenozKc?si=secret", "youtube"), "https://www.youtube.com/watch?v=BaW_jenozKc")
        self.assertEqual(worker.canonical_video("https://www.bilibili.com/video/BV1g2sQ6FET3?vd_source=secret&p=2", "bilibili"), "https://www.bilibili.com/video/BV1g2sQ6FET3?p=2")
        self.assertEqual(worker.canonical_video("https://www.iesdouyin.com/share/video/12345/", "douyin"), "https://www.douyin.com/video/12345")
        self.assertEqual(worker.canonical_video("https://www.douyin.com/?modal_id=12345", "douyin"), "https://www.douyin.com/video/12345")

    def test_no_channel_playlist_or_cross_platform_redirect(self):
        for url, platform in [("https://www.youtube.com/playlist?list=123", "youtube"), ("https://evil.test/video/123", "douyin"), ("https://www.bilibili.com/video/BV123?p=0", "bilibili"), ("https://www.youtube.com/watch?v=BaW_jenozKc", "bilibili")]:
            with self.assertRaises(worker.Failure):
                worker.canonical_video(url, platform)

    def test_successful_metadata_never_claims_watermark_free(self):
        data = worker.metadata({"id": "1", "title": "hello\nworld", "duration": 2, "has_drm": False}, "bilibili", "https://www.bilibili.com/video/BV123")
        self.assertEqual(data["watermark"], "unknown")
        self.assertEqual(data["title"], "hello world")

    def test_unknown_live_drm_and_oversized_duration_rejected(self):
        for info in [{"duration": None}, {"duration": float("nan")}, {"duration": 50000}, {"duration": 10, "is_live": True}, {"duration": 10, "has_drm": True}, {"_type": "playlist", "duration": 10}]:
            with self.assertRaises(worker.Failure):
                worker.metadata(info, "youtube", "url")

    def test_selected_formats_cannot_use_external_downloader(self):
        for protocol in ["m3u8", "rtmp", "file", "http_dash_segments_generator"]:
            with self.assertRaises(worker.Failure):
                worker.check_download_info({"protocol": protocol, "url": "https://example.com/video"})
        worker.check_download_info({"requested_formats": [{"protocol": "https", "url": "https://example.com/video"}, {"protocol": "https", "url": "https://example.com/audio"}]})

    def test_bilibili_cdn_range_is_scoped_to_media_and_preserves_explicit_ranges(self):
        info = {"http_headers": {"Referer": "https://www.bilibili.com/video/BV123"}, "formats": [{"url": "https://example.com/video"}, {"url": "https://example.com/audio", "http_headers": {"Range": "bytes=10-20", "Referer": "https://www.bilibili.com/"}}]}
        worker.prepare_formats(info, "youtube")
        self.assertNotIn("http_headers", info["formats"][0])
        worker.prepare_formats(info, "bilibili")
        self.assertEqual(info["formats"][0]["http_headers"]["Range"], "bytes=0-")
        self.assertEqual(info["formats"][1]["http_headers"]["Range"], "bytes=10-20")
        self.assertEqual(info["formats"][0]["http_headers"]["Referer"], info["http_headers"]["Referer"])
        self.assertEqual(info["formats"][1]["http_headers"]["Referer"], "https://www.bilibili.com/")

    def test_bilibili_uses_supplied_web_backup_without_changing_port_policy(self):
        blocked = "https://cdn.example:8082/media?signature=example"
        backup = "https://cdn.example/media?signature=example"
        item = {"baseUrl": blocked, "backupUrl": ["https://cdn.example:4483/media", backup]}
        original = {"dash": {"video": [item], "audio": [{"base_url": backup, "backup_url": [blocked]}]}}
        selected = worker.bilibili_web_cdn(original)
        self.assertEqual(selected["dash"]["video"][0]["baseUrl"], backup)
        self.assertEqual(selected["dash"]["audio"][0]["base_url"], backup)
        self.assertEqual(original["dash"]["video"][0]["baseUrl"], blocked)
        with self.assertRaises(worker.Failure):
            worker.validate_http_url(blocked)
        self.assertFalse(worker.public_ip("127.0.0.1"))

    def test_bilibili_without_allowed_backup_still_rejects_primary(self):
        item = {"url": "https://cdn.example:8082/media", "backup_url": ["file:///tmp/media", "https://user:secret@cdn.example/media", None]}
        selected = worker.bilibili_web_cdn({"durl": [item]})
        self.assertEqual(selected["durl"][0], item)
        with self.assertRaises(worker.Failure):
            worker.validate_http_url(selected["durl"][0]["url"])

    def test_redacted_failure_categories(self):
        cases = [("Fresh cookies are needed", "authentication_required"), ("HTTP Error 412", "rate_limited"), ("Connection timed out", "network_unavailable"), ("video removed", "video_unavailable"), ("network_policy", "network_policy")]
        for text, expected in cases:
            self.assertEqual(worker.classify(text), expected)

    def test_douyin_detail_query_uses_supplied_session(self):
        query = worker.douyin_detail_query("123456789", "test-session-token", 1700000000)
        self.assertEqual(query["aid"], 6383)
        self.assertEqual(query["uifid"], "test-session-token")
        self.assertEqual(query["timestamp"], "1700000000")
        self.assertEqual(query["x-secsdk-web-signature"], "f7dd579f3b6f953656179e6d3e3e6366")
        self.assertNotEqual(query["x-secsdk-web-signature"], worker.douyin_detail_query("123456790", "test-session-token", 1700000000)["x-secsdk-web-signature"])

    def test_douyin_missing_session_requests_official_login(self):
        for token in (None, "", 123):
            with self.assertRaises(worker.Failure) as error:
                worker.douyin_detail_query("123456789", token)
            self.assertEqual(error.exception.code, "authentication_required")

    def test_douyin_adapter_preserves_transport_failure_and_media_referer(self):
        from yt_dlp import YoutubeDL
        from yt_dlp.extractor.tiktok import DouyinIE
        from yt_dlp.networking.exceptions import TransportError
        from yt_dlp.utils import ExtractorError
        def extract(ydl, url, download=True):
            return ydl.get_info_extractor("Douyin")._real_extract(url)
        parsed = {"id": "123456789", "title": "Fixture", "duration": 2}
        with tempfile.TemporaryDirectory() as directory:
            ffmpeg = Path(directory) / "ffmpeg.exe"
            ffmpeg.touch()
            request = {"action": "resolve", "platform": "douyin", "url": "https://www.douyin.com/video/123456789", "ffmpeg": str(ffmpeg)}
            with patch.object(YoutubeDL, "extract_info", extract), patch.object(DouyinIE, "_get_cookies", return_value={"UIFID": SimpleNamespace(value="test-session-token")}), patch.object(DouyinIE, "_parse_aweme_video_app", return_value=parsed) as parse:
                with patch.object(DouyinIE, "_download_json", return_value={"aweme_detail": {"id": "fixture"}}) as fetch:
                    self.assertTrue(worker.execute(request)["ok"])
                    self.assertEqual(fetch.call_args.kwargs["headers"]["Referer"], "https://www.douyin.com/")
                    self.assertIn("x-secsdk-web-signature", fetch.call_args.kwargs["query"])
                    parse.assert_called_once_with({"id": "fixture"})
                failure = ExtractorError("request failed", cause=TransportError(cause=ConnectionRefusedError("连接被拒绝")))
                with patch.object(DouyinIE, "_download_json", side_effect=failure):
                    with self.assertRaises(ExtractorError) as error:
                        worker.execute(request)
                    self.assertEqual(worker.classify(error.exception), "network_unavailable")

    def test_nested_transport_policy_failure_is_preserved(self):
        wrapper = Exception("No handler available; raw private detail")
        wrapper.unexpected_errors = [worker.Failure("network_policy")]
        outer = Exception("platform parsing failed")
        outer.exc_info = (type(wrapper), wrapper, None)
        self.assertEqual(worker.classify(outer), "network_policy")

    def test_localized_windows_socket_failure_is_network_error(self):
        from yt_dlp.networking.exceptions import TransportError
        cause = OSError(10061, "由于目标计算机积极拒绝，无法连接。")
        error = TransportError(cause=cause)
        self.assertEqual(worker.classify(error), "network_unavailable")
        outer = Exception("platform parsing failed")
        outer.exc_info = (type(error), error, None)
        self.assertEqual(worker.classify(outer), "network_unavailable")
        outer.unexpected_errors = [worker.Failure("network_policy")]
        self.assertEqual(worker.classify(outer), "network_policy")


if __name__ == "__main__":
    unittest.main()
