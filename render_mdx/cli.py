from __future__ import annotations

import argparse
import errno
import html
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse


PACKAGE_ROOT = Path(__file__).resolve().parent
APP_TEMPLATE = PACKAGE_ROOT / "app_template"
BUNDLED_SKILLS = PACKAGE_ROOT / "skills"
DEFAULT_SKILL_NAME = "render-mdx-components"
STATE_DIR = Path(
    os.environ.get("RENDER_MDX_HOME", str(Path.home() / ".render-mdx"))
).expanduser()
CONFIG_PATH = STATE_DIR / "config.json"
APP_DIR = STATE_DIR / "app"
CONTENT_DIR = APP_DIR / "src" / "content" / "docs" / "rendered"
ALLOWED_SUFFIXES = {".md", ".mdx"}
IGNORED_DIRECTORY_NAMES = {"node_modules"}
DEFAULT_API_HOST = "127.0.0.1"
DEFAULT_API_PORT = 8765
DEFAULT_ASTRO_HOST = "127.0.0.1"
DEFAULT_ASTRO_PORT = 4321


@dataclass
class Source:
    path: Path

    @property
    def id(self) -> str:
        return hashlib.sha1(str(self.path).encode("utf-8")).hexdigest()[:12]


class ConfigStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = threading.Lock()

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"sources": []}
        try:
            with self.path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, json.JSONDecodeError):
            return {"sources": []}
        if not isinstance(data, dict):
            return {"sources": []}
        sources = data.get("sources")
        if not isinstance(sources, list):
            data["sources"] = []
        return data

    def save(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
            handle.write("\n")
        tmp.replace(self.path)

    def sources(self) -> list[Source]:
        with self.lock:
            data = self.load()
            result: list[Source] = []
            for entry in data.get("sources", []):
                if not isinstance(entry, dict):
                    continue
                raw_path = entry.get("path")
                if not isinstance(raw_path, str):
                    continue
                result.append(Source(Path(raw_path).expanduser().resolve()))
            return result

    def add(self, raw_path: str) -> Source:
        if not raw_path.strip():
            raise ValueError("Choose a .md/.mdx file or a directory.")
        path = Path(raw_path).expanduser().resolve()
        if not path.exists():
            raise ValueError(f"Path does not exist: {path}")
        if not path.is_file() and not path.is_dir():
            raise ValueError("Choose a .md/.mdx file or a directory.")
        if path.is_file() and path.suffix.lower() not in ALLOWED_SUFFIXES:
            raise ValueError("Choose a .md or .mdx file.")
        source = Source(path)
        with self.lock:
            data = self.load()
            sources = [
                entry
                for entry in data.get("sources", [])
                if isinstance(entry, dict) and entry.get("path") != str(source.path)
            ]
            sources.append({"path": str(source.path)})
            data["sources"] = sources
            self.save(data)
        return source

    def remove(self, raw_path: str) -> None:
        path = str(Path(raw_path).expanduser().resolve())
        with self.lock:
            data = self.load()
            data["sources"] = [
                entry
                for entry in data.get("sources", [])
                if not isinstance(entry, dict) or entry.get("path") != path
            ]
            self.save(data)

    def add_note(self, raw_path: str, context: str, note: str) -> tuple[Path, str]:
        """Append a note only when the source is registered and still writable."""
        path = Path(raw_path).expanduser().resolve()
        with self.lock:
            data = self.load()
            self.validate_note_source(data, path)
            note_id = append_revision_note(path, context, note)
        return path, note_id

    def delete_note(self, raw_path: str, note_id: str) -> Path:
        """Delete one identified revision note from a registered source."""
        path = Path(raw_path).expanduser().resolve()
        with self.lock:
            data = self.load()
            self.validate_note_source(data, path)
            delete_revision_note(path, note_id)
        return path

    @staticmethod
    def validate_note_source(data: dict[str, Any], path: Path) -> None:
        """Validate that a note mutation targets an active MDX source."""
        registered_paths = {
            Path(entry["path"]).expanduser().resolve()
            for entry in data.get("sources", [])
            if isinstance(entry, dict) and isinstance(entry.get("path"), str)
        }
        is_registered = any(
            path == registered
            or (registered.is_dir() and path.is_relative_to(registered))
            for registered in registered_paths
        )
        if not is_registered:
            raise ValueError("The document is not registered with render-mdx.")
        if (
            not path.exists()
            or not path.is_file()
            or path.suffix.lower() not in ALLOWED_SUFFIXES
        ):
            raise ValueError("The source document is no longer available.")


FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.DOTALL)


def copy_app_template(force: bool = False) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if force and APP_DIR.exists():
        shutil.rmtree(APP_DIR)
    if not APP_DIR.exists():
        ignore = shutil.ignore_patterns("node_modules", "dist", ".astro")
        shutil.copytree(APP_TEMPLATE, APP_DIR, ignore=ignore)
        return
    # Keep the cached app in sync with the bundled template, preserving
    # node_modules / dist / .astro / user-rendered content.
    keep = {"node_modules", "dist", ".astro", "package-lock.json"}
    for entry in APP_TEMPLATE.iterdir():
        if entry.name in keep:
            continue
        target = APP_DIR / entry.name
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists() or target.is_symlink():
            target.unlink()
        if entry.is_dir():
            shutil.copytree(
                entry,
                target,
                ignore=shutil.ignore_patterns("node_modules", "dist", ".astro"),
            )
        else:
            shutil.copy2(entry, target)
    # Remove legacy content layout that is no longer used by this version.
    legacy = APP_DIR / "src" / "content" / "docs" / "guides"
    if legacy.exists():
        shutil.rmtree(legacy, ignore_errors=True)


def ensure_node_dependencies(skip_install: bool = False) -> None:
    if (APP_DIR / "node_modules" / "astro").exists():
        return
    if skip_install:
        raise RuntimeError(
            f"Node dependencies are missing in {APP_DIR}. Run without --skip-install once."
        )
    if shutil.which("npm") is None:
        raise RuntimeError(
            "npm was not found. Install Node.js/npm before running render-mdx."
        )
    print("Installing Astro dependencies in ~/.render-mdx/app ...", flush=True)
    subprocess.run(["npm", "install"], cwd=APP_DIR, check=True)


def discover_files(source: Source) -> list[Path]:
    if source.path.is_file():
        return [source.path] if source.path.suffix.lower() in ALLOWED_SUFFIXES else []
    if not source.path.is_dir():
        return []

    documents: list[Path] = []
    for root, directory_names, file_names in os.walk(source.path):
        root_path = Path(root)
        directory_names[:] = sorted(
            name
            for name in directory_names
            if not name.startswith(".")
            and name not in IGNORED_DIRECTORY_NAMES
            and not (root_path / name).is_symlink()
        )
        for name in sorted(file_names):
            path = root_path / name
            if (
                not name.startswith(".")
                and path.suffix.lower() in ALLOWED_SUFFIXES
                and path.is_file()
                and not path.is_symlink()
            ):
                documents.append(path)
    return documents


def title_from_path(path: Path) -> str:
    words = path.stem.replace("_", " ").replace("-", " ").split()
    return " ".join(word[:1].upper() + word[1:] for word in words) or path.name


def has_frontmatter(text: str) -> bool:
    return text.startswith("---\n") or text.startswith("---\r\n")


def rendered_name(path: Path) -> str:
    digest = hashlib.sha1(str(path).encode("utf-8")).hexdigest()[:10]
    stem = "".join(ch if ch.isalnum() else "-" for ch in path.stem.lower()).strip("-")
    return f"{stem or 'document'}-{digest}.mdx"


TITLE_RE = re.compile(r"^[ \t]*title[ \t]*:[ \t]*\S.*$", re.MULTILINE)
EMPTY_TITLE_RE = re.compile(r"^[ \t]*title[ \t]*:[ \t]*$", re.MULTILINE)
REVISION_NOTES_HEADING_RE = re.compile(r"^## Revision notes\s*$", re.MULTILINE)
MAX_NOTE_LENGTH = 10_000
MAX_NOTE_CONTEXT_LENGTH = 500
NOTE_ID_RE = re.compile(r"^[0-9a-f-]{36}$")


def ensure_frontmatter_title(text: str, path: Path) -> str:
    """Guarantee a Starlight-compatible title frontmatter field exists."""
    title = title_from_path(path)
    if not has_frontmatter(text):
        return f"---\ntitle: {json.dumps(title)}\n---\n\n{text}"
    match = FRONTMATTER_RE.search(text)
    if not match:
        return text
    block = match.group(1)
    if TITLE_RE.search(block):
        return text
    if EMPTY_TITLE_RE.search(block):
        block = EMPTY_TITLE_RE.sub(f"title: {json.dumps(title)}", block, count=1)
    else:
        block = f"title: {json.dumps(title)}\n{block}"
    return text[: match.start(1)] + block + text[match.end(1) :]


def escape_mdx_text(value: str) -> str:
    """Escape user-entered text so it remains plain text inside MDX."""
    return html.escape(value, quote=False).replace("{", "&#123;").replace("}", "&#125;")


def replace_source_text(path: Path, text: str) -> None:
    """Atomically replace source text while retaining its file permissions."""
    temporary = path.with_name(f".{path.name}.render-mdx.tmp")
    try:
        temporary.write_text(text, encoding="utf-8")
        temporary.chmod(path.stat().st_mode)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def append_revision_note(path: Path, context: str, note: str) -> str:
    """Atomically append a contextual revision note to an MDX source file."""
    clean_context = context.strip()
    clean_note = note.strip()
    if not clean_note:
        raise ValueError("Write a note before saving.")
    if len(clean_note) > MAX_NOTE_LENGTH:
        raise ValueError(f"Note is too long (maximum {MAX_NOTE_LENGTH:,} characters).")
    if len(clean_context) > MAX_NOTE_CONTEXT_LENGTH:
        clean_context = clean_context[:MAX_NOTE_CONTEXT_LENGTH].rstrip() + "…"

    text = path.read_text(encoding="utf-8")
    escaped_context = escape_mdx_text(clean_context or "Document")
    escaped_note = escape_mdx_text(clean_note)
    note_id = str(uuid.uuid4())
    quoted_note = "\n".join(
        f"> {line}" if line else ">" for line in escaped_note.splitlines()
    )
    heading = "" if REVISION_NOTES_HEADING_RE.search(text) else "\n\n## Revision notes"
    addition = (
        f"{heading}\n\n"
        f"> **Revision note**\n"
        f">\n"
        f'> <span data-rmx-note-id="{note_id}"></span>\n'
        f">\n"
        f"> **Target:** {escaped_context}\n"
        f">\n"
        f"{quoted_note}\n"
    )

    updated = text.rstrip() + addition
    replace_source_text(path, updated)
    return note_id


def delete_revision_note(path: Path, note_id: str) -> None:
    """Atomically remove the revision-note block carrying the given ID."""
    clean_note_id = note_id.strip().lower()
    if not NOTE_ID_RE.fullmatch(clean_note_id):
        raise ValueError("Invalid revision note ID.")

    text = path.read_text(encoding="utf-8")
    marker = f'data-rmx-note-id="{clean_note_id}"'
    marker_position = text.find(marker)
    if marker_position < 0:
        raise ValueError("Revision note was not found.")
    block_start = text.rfind("> **Revision note**", 0, marker_position)
    if block_start < 0:
        raise ValueError("Revision note block is malformed.")
    block_start = text.rfind("\n", 0, block_start) + 1
    next_block = text.find("\n\n> **Revision note**", marker_position)
    if next_block >= 0:
        updated = text[:block_start].rstrip() + text[next_block:]
    else:
        updated = text[:block_start].rstrip() + "\n"
    if "> **Revision note**" not in updated:
        updated = re.sub(r"\n*## Revision notes\s*\n*$", "\n", updated)
    replace_source_text(path, updated)


def mirror_file(path: Path) -> Path:
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    target = CONTENT_DIR / rendered_name(path)
    text = path.read_text(encoding="utf-8")
    text = ensure_frontmatter_title(text, path)
    if target.exists() and target.read_text(encoding="utf-8") == text:
        return target
    target.write_text(text, encoding="utf-8")
    return target


def list_documents(store: ConfigStore) -> list[dict[str, Any]]:
    """Read-only listing of the documents currently mirrored on disk."""
    documents: dict[Path, dict[str, Any]] = {}
    for source in store.sources():
        for path in discover_files(source):
            if path in documents:
                documents[path]["sources"].append(str(source.path))
                continue
            target = CONTENT_DIR / rendered_name(path)
            if target.exists():
                documents[path] = {
                    "path": str(path),
                    "source": str(source.path),
                    "sources": [str(source.path)],
                    "title": title_from_path(path),
                    "url": f"/rendered/{target.stem}/",
                }
    return sorted(documents.values(), key=lambda item: item["title"].lower())


def sync_once(store: ConfigStore) -> dict[str, Any]:
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    expected: set[Path] = set()
    documents: dict[Path, dict[str, Any]] = {}
    errors: list[str] = []
    for source in store.sources():
        for path in discover_files(source):
            if path in documents:
                documents[path]["sources"].append(str(source.path))
                continue
            try:
                target = mirror_file(path)
                expected.add(target)
                documents[path] = {
                    "path": str(path),
                    "source": str(source.path),
                    "sources": [str(source.path)],
                    "title": title_from_path(path),
                    "url": f"/rendered/{target.stem}/",
                }
            except (OSError, UnicodeDecodeError) as exc:
                errors.append(f"{path}: {exc}")
    for stale in CONTENT_DIR.glob("*.mdx"):
        if stale not in expected:
            stale.unlink(missing_ok=True)
    return {
        "documents": sorted(
            documents.values(), key=lambda item: item["title"].lower()
        ),
        "errors": errors,
    }


class SyncWorker:
    def __init__(self, store: ConfigStore, interval: float) -> None:
        self.store = store
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.last_signature: dict[str, float] = {}

    def start(self) -> None:
        self.last_signature = self.signature()
        sync_once(self.store)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self.thread.join(timeout=2)

    def signature(self) -> dict[str, float]:
        result: dict[str, float] = {}
        for source in self.store.sources():
            for path in discover_files(source):
                try:
                    result[str(path)] = path.stat().st_mtime
                except OSError:
                    continue
        return result

    def run(self) -> None:
        while not self.stop_event.wait(self.interval):
            signature = self.signature()
            if signature != self.last_signature:
                sync_once(self.store)
                self.last_signature = signature


def json_response(
    handler: BaseHTTPRequestHandler, payload: Any, status: int = 200
) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    try:
        handler.wfile.write(body)
    except BrokenPipeError:
        pass


def make_handler(store: ConfigStore, start_dir: Path):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:
            return

        def do_OPTIONS(self) -> None:
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/api/state":
                json_response(
                    self,
                    {
                        "sources": [
                            {
                                "path": str(source.path),
                                "id": source.id,
                                "kind": (
                                    "directory"
                                    if source.path.is_dir()
                                    else "file"
                                ),
                            }
                            for source in store.sources()
                        ],
                        "documents": list_documents(store),
                        "errors": [],
                        "configPath": str(CONFIG_PATH),
                    },
                )
                return
            if parsed.path == "/api/browse":
                query = parse_qs(parsed.query)
                raw = query.get("path", [""])[0]
                path = Path(unquote(raw)).expanduser().resolve() if raw else start_dir
                self.handle_browse(path)
                return
            json_response(self, {"error": "Not found"}, HTTPStatus.NOT_FOUND)

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            length = int(self.headers.get("Content-Length", "0"))
            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                json_response(self, {"error": "Invalid JSON"}, HTTPStatus.BAD_REQUEST)
                return
            try:
                if parsed.path == "/api/add":
                    source = store.add(str(payload.get("path", "")))
                    sync_once(store)
                    json_response(self, {"source": {"path": str(source.path)}})
                    return
                if parsed.path == "/api/remove":
                    store.remove(str(payload.get("path", "")))
                    sync_once(store)
                    json_response(self, {"ok": True})
                    return
                if parsed.path == "/api/notes":
                    path, note_id = store.add_note(
                        str(payload.get("path", "")),
                        str(payload.get("context", "")),
                        str(payload.get("note", "")),
                    )
                    sync_once(store)
                    json_response(
                        self, {"ok": True, "path": str(path), "noteId": note_id}
                    )
                    return
                if parsed.path == "/api/notes/delete":
                    path = store.delete_note(
                        str(payload.get("path", "")),
                        str(payload.get("noteId", "")),
                    )
                    sync_once(store)
                    json_response(self, {"ok": True, "path": str(path)})
                    return
            except (OSError, ValueError) as exc:
                json_response(self, {"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            json_response(self, {"error": "Not found"}, HTTPStatus.NOT_FOUND)

        def handle_browse(self, path: Path) -> None:
            if not path.exists():
                json_response(
                    self,
                    {"error": f"Path does not exist: {path}"},
                    HTTPStatus.BAD_REQUEST,
                )
                return
            if path.is_file():
                path = path.parent
            entries = []
            try:
                children = sorted(
                    path.iterdir(),
                    key=lambda item: (not item.is_dir(), item.name.lower()),
                )
            except OSError as exc:
                json_response(self, {"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            if path.parent != path:
                entries.append(
                    {
                        "name": "..",
                        "path": str(path.parent),
                        "kind": "directory",
                        "up": True,
                    }
                )
            for child in children:
                if child.name.startswith("."):
                    continue
                if child.is_dir():
                    entries.append(
                        {"name": child.name, "path": str(child), "kind": "directory"}
                    )
                elif child.suffix.lower() in ALLOWED_SUFFIXES:
                    entries.append(
                        {"name": child.name, "path": str(child), "kind": "file"}
                    )
            json_response(self, {"path": str(path), "entries": entries})

    return Handler


def start_api_server(
    store: ConfigStore, start_dir: Path, host: str, port: int
) -> ThreadingHTTPServer:
    try:
        server = ThreadingHTTPServer((host, port), make_handler(store, start_dir))
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE and port != 0:
            server = ThreadingHTTPServer((host, 0), make_handler(store, start_dir))
            actual_port = server.server_address[1]
            print(
                f"render-mdx: local picker API port {port} is busy; using {actual_port} instead.",
                file=sys.stderr,
                flush=True,
            )
        else:
            raise RuntimeError(
                f"Could not start the local picker API on http://{host}:{port}: {exc}"
            ) from exc
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def build_astro_env(api_url: str) -> dict[str, str]:
    env = os.environ.copy()
    env["RENDER_MDX_API_URL"] = api_url
    if sys.platform.startswith("linux"):
        # Polling avoids Linux inotify exhaustion in constrained environments.
        env.setdefault("CHOKIDAR_USEPOLLING", "1")
        env.setdefault("CHOKIDAR_INTERVAL", "250")
    return env


def start_astro(host: str, port: int, api_url: str) -> subprocess.Popen[bytes]:
    env = build_astro_env(api_url)
    try:
        return subprocess.Popen(
            ["npm", "run", "dev", "--", "--host", host, "--port", str(port)],
            cwd=APP_DIR,
            env=env,
        )
    except OSError as exc:
        raise RuntimeError(
            f"Could not start the Astro app on http://{host}:{port}: {exc}"
        ) from exc


def stop_astro() -> None:
    if shutil.which("npm") is None:
        return
    subprocess.run(
        ["npm", "run", "astro", "--", "dev", "stop"],
        cwd=APP_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    if argv and argv[0] in {"add", "register"}:
        return parse_register_args(argv[1:])
    if argv and argv[0] == "install-skill":
        return parse_install_skill_args(argv[1:])

    parser = argparse.ArgumentParser(
        description="Start the local render-mdx web interface."
    )
    parser.add_argument(
        "paths",
        nargs="*",
        help="Optional .md/.mdx files or directories to add before starting.",
    )
    parser.add_argument(
        "--host", default=DEFAULT_ASTRO_HOST, help="Astro dev server host."
    )
    parser.add_argument(
        "--port", type=int, default=DEFAULT_ASTRO_PORT, help="Astro dev server port."
    )
    parser.add_argument(
        "--api-host", default=DEFAULT_API_HOST, help="Local picker API host."
    )
    parser.add_argument(
        "--api-port", type=int, default=DEFAULT_API_PORT, help="Local picker API port."
    )
    parser.add_argument(
        "--no-open", action="store_true", help="Do not open the browser automatically."
    )
    parser.add_argument(
        "--reset-app",
        action="store_true",
        help="Recreate the cached Astro app in ~/.render-mdx/app.",
    )
    parser.add_argument(
        "--skip-install",
        action="store_true",
        help="Fail instead of running npm install if needed.",
    )
    parser.add_argument(
        "--watch-interval",
        type=float,
        default=0.7,
        help="Seconds between source file change checks.",
    )
    return parser.parse_args(argv)


def parse_register_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="render-mdx register",
        description=(
            "Register .md/.mdx files or directories without starting the "
            "web interface."
        ),
    )
    parser.add_argument(
        "paths",
        nargs="+",
        help=(
            "One or more .md/.mdx files or directories to save in the "
            "render-mdx source registry."
        ),
    )
    args = parser.parse_args(argv)
    args.command = "register"
    return args


def parse_install_skill_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="render-mdx install-skill",
        description="Install the render-mdx agent skill into a project.",
    )
    parser.add_argument(
        "project",
        nargs="?",
        default=".",
        help="Project folder that should receive .agents/skills/render-mdx-components.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace an existing installed render-mdx-components skill.",
    )
    args = parser.parse_args(argv)
    args.command = "install-skill"
    return args


def register_paths(store: ConfigStore, raw_paths: list[str]) -> list[Source]:
    return [store.add(raw_path) for raw_path in raw_paths]


def install_skill(project: str, force: bool = False) -> Path:
    source = BUNDLED_SKILLS / DEFAULT_SKILL_NAME
    if not source.exists():
        raise RuntimeError(f"Bundled skill was not found: {source}")
    project_path = Path(project).expanduser().resolve()
    if not project_path.exists():
        raise ValueError(f"Project folder does not exist: {project_path}")
    if not project_path.is_dir():
        raise ValueError(f"Project path is not a directory: {project_path}")

    destination = project_path / ".agents" / "skills" / DEFAULT_SKILL_NAME
    if destination.exists():
        if not force:
            raise FileExistsError(
                f"Skill already exists: {destination}. Re-run with --force to replace it."
            )
        shutil.rmtree(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination)
    return destination


def print_registered_sources(sources: list[Source]) -> None:
    for source in sources:
        print(f"Registered: {source.path}")
    print(f"Saved MDX sources: {CONFIG_PATH}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    store = ConfigStore(CONFIG_PATH)
    if getattr(args, "command", None) == "register":
        try:
            sources = register_paths(store, args.paths)
        except ValueError as exc:
            print(f"render-mdx: {exc}", file=sys.stderr)
            return 1
        print_registered_sources(sources)
        return 0
    if getattr(args, "command", None) == "install-skill":
        try:
            destination = install_skill(args.project, force=args.force)
        except (FileExistsError, OSError, RuntimeError, ValueError) as exc:
            print(f"render-mdx: {exc}", file=sys.stderr)
            return 1
        print(f"Installed skill: {destination}")
        return 0

    try:
        copy_app_template(force=args.reset_app)
        register_paths(store, args.paths)
        ensure_node_dependencies(skip_install=args.skip_install)
    except (OSError, RuntimeError, subprocess.CalledProcessError, ValueError) as exc:
        print(f"render-mdx: {exc}", file=sys.stderr)
        return 1

    worker = SyncWorker(store, args.watch_interval)
    worker.start()
    api_server: ThreadingHTTPServer | None = None
    astro: subprocess.Popen[bytes] | None = None
    try:
        api_server = start_api_server(
            store, Path.home().resolve(), args.api_host, args.api_port
        )
        api_host, api_port = api_server.server_address[:2]
        api_url = f"http://{api_host}:{api_port}"
        astro = start_astro(args.host, args.port, api_url)
    except RuntimeError as exc:
        worker.stop()
        if api_server is not None:
            api_server.shutdown()
            api_server.server_close()
        print(f"render-mdx: {exc}", file=sys.stderr)
        return 1
    url = f"http://{args.host}:{args.port}/"
    print(f"render-mdx is running: {url}")
    print(f"Saved MDX sources: {CONFIG_PATH}")
    if not args.no_open:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()

    def shutdown(_signum: int, _frame: Any) -> None:
        if astro.poll() is None:
            astro.terminate()
        else:
            stop_astro()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    try:
        code = astro.wait()
        if code != 0:
            return code
        print("Astro started in the background. Press Ctrl+C to stop render-mdx.")
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        return 0
    finally:
        if astro.poll() is None:
            astro.terminate()
        else:
            stop_astro()
        worker.stop()
        api_server.shutdown()
        api_server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
