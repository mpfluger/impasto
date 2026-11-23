"""Serve the painting locally with caching disabled: python serve.py  ->  http://localhost:5174"""
import http.server
import os
import socketserver

PORT = 5174
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), NoCache) as httpd:
    print(f"Saint-Rémy is hanging at http://localhost:{PORT}")
    httpd.serve_forever()
