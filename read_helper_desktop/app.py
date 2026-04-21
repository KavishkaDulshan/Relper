import json
import socket
import sys
import threading
from pathlib import Path
from wsgiref.simple_server import make_server
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from flask import Flask, jsonify, request, send_from_directory
import webview


DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile"
GROQ_FALLBACK_MODEL = "llama-3.1-8b-instant"
GROQ_CONFIG_FILENAMES = ("groq.config.json", "groq_config.json")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_REQUEST_USER_AGENT = "RelperDesktop/1.0"


def get_project_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


def get_runtime_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def get_groq_config_path(runtime_dir: Path) -> Path:
    for filename in GROQ_CONFIG_FILENAMES:
        candidate = runtime_dir / filename
        if candidate.exists():
            return candidate

    return runtime_dir / GROQ_CONFIG_FILENAMES[0]


def build_api_key_preview(api_key: str) -> str:
    normalized = api_key.strip()

    if not normalized:
        return ""

    if len(normalized) <= 11:
        return f"{normalized[:3]}..."

    return f"{normalized[:7]}...{normalized[-4:]}"


def save_groq_settings(runtime_dir: Path, api_key: str, model: str) -> None:
    target_path = get_groq_config_path(runtime_dir)
    payload = {
        "apiKey": api_key,
        "model": model,
    }

    target_path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


def load_groq_file_config(runtime_dir: Path):
    for filename in GROQ_CONFIG_FILENAMES:
        config_path = runtime_dir / filename

        if not config_path.exists():
            continue

        try:
            parsed = json.loads(config_path.read_text(encoding="utf-8"))
        except OSError:
            return {}, f"Unable to read {filename}."
        except json.JSONDecodeError:
            return {}, f"{filename} is not valid JSON."

        if not isinstance(parsed, dict):
            return {}, f"{filename} must contain a JSON object."

        return parsed, ""

    return {}, ""


def get_groq_settings():
    runtime_dir = get_runtime_dir()
    file_config, config_error = load_groq_file_config(runtime_dir)

    if config_error:
        return "", "", config_error

    model = str(
        file_config.get("model")
        or DEFAULT_GROQ_MODEL
    ).strip()

    api_key = str(file_config.get("apiKey") or "").strip()

    if not model:
        model = DEFAULT_GROQ_MODEL

    return model, api_key, ""


def build_groq_model_candidates(preferred_model: str):
    models = []

    for item in (preferred_model, DEFAULT_GROQ_MODEL, GROQ_FALLBACK_MODEL):
        normalized = str(item or "").strip()
        if normalized and normalized not in models:
            models.append(normalized)

    return models


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

    @app.route("/api/ai/config", methods=["GET", "POST", "DELETE"])
    def manage_ai_config():
        runtime_dir = get_runtime_dir()

        if request.method == "GET":
            model, api_key, config_error = get_groq_settings()

            if config_error:
                return jsonify(error=config_error), 500

            return jsonify(
                hasApiKey=bool(api_key),
                apiKeyPreview=build_api_key_preview(api_key),
                model=model or DEFAULT_GROQ_MODEL,
            )

        if request.method == "DELETE":
            for filename in GROQ_CONFIG_FILENAMES:
                config_path = runtime_dir / filename

                if config_path.exists():
                    try:
                        config_path.unlink()
                    except OSError:
                        return jsonify(error=f"Unable to remove {filename}."), 500

            return jsonify(
                hasApiKey=False,
                apiKeyPreview="",
                model=DEFAULT_GROQ_MODEL,
            )

        payload = request.get_json(silent=True) or {}
        api_key = str(payload.get("apiKey", "")).strip()
        model = str(payload.get("model", "")).strip() or DEFAULT_GROQ_MODEL

        if not api_key:
            return jsonify(error="Groq API key is required."), 400

        if not api_key.startswith("gsk_"):
            return jsonify(error="Groq API key must start with gsk_."), 400

        try:
            save_groq_settings(runtime_dir, api_key, model)
        except OSError:
            return jsonify(error="Unable to save groq.config.json in desktop runtime folder."), 500

        return jsonify(
            hasApiKey=True,
            apiKeyPreview=build_api_key_preview(api_key),
            model=model,
        )

    @app.route("/api/ai/explain", methods=["POST"])
    def explain_phrase():
        payload = request.get_json(silent=True) or {}
        phrase = str(payload.get("phrase", "")).strip()

        if not phrase:
            return jsonify(error="No phrase was selected for AI explanation."), 400

        preferred_model, api_key, config_error = get_groq_settings()

        if config_error:
            return jsonify(error=config_error), 500

        if not api_key:
            return (
                jsonify(
                    error=(
                        "Groq API key is missing. Set up your key in AI settings "
                        "to enable phrase explanations."
                    )
                ),
                500,
            )

        system_prompt = (
            "You are a reading assistant for beginner English readers. "
            "Explain the selected phrase in accurate, plain English. "
            "Keep the answer short, practical, and friendly. "
            "Return exactly two plain-text parts labeled Meaning and Example. "
            "Do not use markdown formatting, policy notices, or model details."
        )
        user_prompt = (
            f'Phrase: "{phrase}"\n'
            "Give the most likely meaning in simple words. "
            "If the phrase is idiomatic or context dependent, explain the common meaning. "
            "Then add one short real-world example the reader can picture. "
            "Use direct, beginner-friendly language."
        )
        last_error = ""

        for model in build_groq_model_candidates(preferred_model):
            request_body = {
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": system_prompt,
                    },
                    {
                        "role": "user",
                        "content": user_prompt,
                    },
                ],
                "temperature": 0.2,
                "max_tokens": 280,
            }

            api_request = Request(
                GROQ_API_URL,
                data=json.dumps(request_body).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": GROQ_REQUEST_USER_AGENT,
                    "Authorization": f"Bearer {api_key}",
                },
                method="POST",
            )

            try:
                with urlopen(api_request, timeout=20) as response:
                    raw_response = response.read().decode("utf-8")
            except HTTPError as error:
                error_body = ""
                if error.fp is not None:
                    error_body = error.fp.read().decode("utf-8", errors="replace")

                last_error = f"HTTP {error.code}. {error_body[:280]}"
                continue
            except URLError as error:
                last_error = f"Network error: {error.reason}"
                continue

            try:
                data = json.loads(raw_response)
            except json.JSONDecodeError:
                last_error = "Groq returned invalid JSON."
                continue

            explanation = str(
                ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            ).strip()

            if explanation:
                return jsonify(explanation=explanation, source=f"Groq ({model})")

            last_error = "Groq returned no explanation text."

        return jsonify(error=f"Groq request failed. {last_error}"), 502

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
