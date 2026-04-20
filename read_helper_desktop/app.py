import socket
import sys
import threading
from pathlib import Path
from wsgiref.simple_server import make_server

from flask import Flask, send_from_directory
import webview


def get_project_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        return sock.getsockname()[1]


def create_flask_app(frontend_dir: Path) -> Flask:
    app = Flask(__name__, static_folder=str(frontend_dir), static_url_path="")

    @app.route("/")
    def serve_root():
        return send_from_directory(frontend_dir, "index.html")

    @app.route("/<path:resource>")
    def serve_resource(resource: str):
        target = frontend_dir / resource
        if target.exists() and target.is_file():
            return send_from_directory(frontend_dir, resource)
        return send_from_directory(frontend_dir, "index.html")

    return app


def main() -> None:
    root = get_project_root()
    frontend_dir = root / "frontend"
    index_file = frontend_dir / "index.html"

    if not index_file.exists():
        raise FileNotFoundError(
            "frontend/index.html was not found. Run build_tools/sync_frontend.ps1 first."
        )

    app = create_flask_app(frontend_dir)
    port = find_free_port()

    server = make_server("127.0.0.1", port, app)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    webview.create_window(
        title="Relper Desktop",
        url=f"http://127.0.0.1:{port}/?desktop=1",
        min_size=(1000, 700),
    )

    try:
        webview.start(gui="edgechromium", debug=False)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
