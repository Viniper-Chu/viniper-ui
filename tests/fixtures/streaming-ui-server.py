"""Serve the real conversation UI with a deterministic interaction fixture, offline."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import json

p = argparse.ArgumentParser()
p.add_argument('--port', type=int, required=True)
p.add_argument('--revision')
args = p.parse_args()
repo = Path(__file__).resolve().parents[2]


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/api/sessions/interaction-fixture/terminal/fixture-command':
            data = json.dumps({'text': 'FULL_OUTPUT\n' + '已读取完整终端输出。\n' * 200, 'nextOffset': None}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(data)
            return
        if path == '/':
            relative = 'resources/viniper-ui/static/index.html'
        elif path == '/fixture.js':
            relative = 'tests/fixtures/streaming-ui-check.js'
        elif path.startswith('/static/'):
            relative = 'resources/viniper-ui' + path
        else:
            self.send_error(404)
            return
        target = (repo / relative).resolve()
        if not target.is_relative_to(repo):
            self.send_error(404)
            return
        data = (subprocess.check_output(['git', 'show', args.revision + ':' + relative], cwd=repo)
                if args.revision and path != '/fixture.js' else target.read_bytes())
        if path == '/':
            data = data.replace(b'/static/v2/app.js?v=__APP_VERSION__', b'/fixture.js')
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(str(target)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)


ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
