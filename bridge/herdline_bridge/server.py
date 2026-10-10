import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, urlsplit

from .api import Api, Binary
from .herdr import HerdrError

# Room for a few phone photos sent as base64.
MAX_BODY = 40 * 1024 * 1024


def make_handler(api: Api):
    class Handler(BaseHTTPRequestHandler):
        def _reply(self, status: int, payload) -> None:
            if isinstance(payload, Binary):
                data, content_type = payload.data, payload.content_type
            else:
                data, content_type = json.dumps(payload, ensure_ascii=False).encode(), 'application/json; charset=utf-8'
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _serve(self, method: str) -> None:
            if not api.authorized(self.headers.get('Authorization')):
                return self._reply(401, {'error': 'unauthorized'})
            url = urlsplit(self.path)
            body = None
            if method == 'POST':
                length = int(self.headers.get('Content-Length') or 0)
                if length > MAX_BODY:
                    return self._reply(413, {'error': 'too_large'})
                try:
                    body = json.loads(self.rfile.read(length) or b'{}')
                except ValueError:
                    return self._reply(400, {'error': 'bad_json'})
            try:
                status, payload = api.handle(method, url.path, dict(parse_qsl(url.query)), body)
            except HerdrError as e:
                status, payload = 502, {'error': e.code, 'message': str(e)}
            self._reply(status, payload)

        def do_GET(self):
            self._serve('GET')

        def do_POST(self):
            self._serve('POST')

        def log_message(self, fmt, *args):
            pass  # keep the pm2 log quiet; messages may contain private text

    return Handler


def serve(api: Api) -> None:
    server = ThreadingHTTPServer((api.config.host, api.config.port), make_handler(api))
    print(f'herdline bridge on http://{api.config.host}:{api.config.port}', flush=True)
    server.serve_forever()
