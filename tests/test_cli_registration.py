from __future__ import annotations

import json
import tempfile
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from render_mdx.cli import (
    APP_TEMPLATE,
    BUNDLED_SKILLS,
    ConfigStore,
    Source,
    build_navigation_order,
    build_astro_env,
    discover_files,
    install_skill,
    parse_args,
    register_paths,
    start_api_server,
    sync_once,
    visible_sources,
)


class CliRegistrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.source = self.root / "guide.mdx"
        self.source.write_text("# Guide\n", encoding="utf-8")

    def test_register_subcommand_parses_without_server_options(self) -> None:
        args = parse_args(["register", str(self.source)])

        self.assertEqual(args.command, "register")
        self.assertEqual(args.paths, [str(self.source)])

    def test_add_alias_parses_as_register(self) -> None:
        args = parse_args(["add", str(self.source)])

        self.assertEqual(args.command, "register")
        self.assertEqual(args.paths, [str(self.source)])

    def test_bare_path_still_uses_server_mode_for_backward_compatibility(self) -> None:
        args = parse_args([str(self.source)])

        self.assertFalse(hasattr(args, "command"))
        self.assertEqual(args.paths, [str(self.source)])

    def test_install_skill_subcommand_defaults_to_current_project(self) -> None:
        args = parse_args(["install-skill"])

        self.assertEqual(args.command, "install-skill")
        self.assertEqual(args.project, ".")
        self.assertFalse(args.force)

    def test_install_skill_subcommand_accepts_project_and_force(self) -> None:
        args = parse_args(["install-skill", str(self.root), "--force"])

        self.assertEqual(args.command, "install-skill")
        self.assertEqual(args.project, str(self.root))
        self.assertTrue(args.force)

    def test_register_paths_writes_absolute_source_once(self) -> None:
        store = ConfigStore(self.root / "config.json")

        first, second = register_paths(store, [str(self.source), str(self.source)])

        self.assertEqual(first.path, self.source.resolve())
        self.assertEqual(second.path, self.source.resolve())
        self.assertEqual(
            [source.path for source in store.sources()], [self.source.resolve()]
        )

    def test_register_paths_accepts_a_directory(self) -> None:
        store = ConfigStore(self.root / "config.json")

        (source,) = register_paths(store, [str(self.root)])

        self.assertEqual(source.path, self.root.resolve())
        self.assertEqual([item.path for item in store.sources()], [self.root.resolve()])

    def test_register_paths_rejects_an_empty_path(self) -> None:
        store = ConfigStore(self.root / "config.json")

        with self.assertRaisesRegex(ValueError, "Choose"):
            register_paths(store, [""])

    def test_discover_files_recursively_finds_markdown_documents(self) -> None:
        docs = self.root / "docs"
        nested = docs / "nested"
        hidden = docs / ".hidden"
        dependencies = docs / "node_modules" / "package"
        nested.mkdir(parents=True)
        hidden.mkdir(parents=True)
        dependencies.mkdir(parents=True)
        top_level = docs / "intro.md"
        child = nested / "guide.mdx"
        top_level.write_text("# Intro\n", encoding="utf-8")
        child.write_text("# Guide\n", encoding="utf-8")
        (nested / "notes.txt").write_text("Notes\n", encoding="utf-8")
        (hidden / "draft.md").write_text("# Draft\n", encoding="utf-8")
        (dependencies / "readme.md").write_text("# Dependency\n", encoding="utf-8")
        source = ConfigStore(self.root / "config.json").add(str(docs))

        documents = discover_files(source)

        self.assertEqual(documents, [top_level, child])

    def test_sync_once_picks_up_new_files_in_a_registered_directory(self) -> None:
        docs = self.root / "docs"
        docs.mkdir()
        first = docs / "first.md"
        second = docs / "second.mdx"
        first.write_text("# First\n", encoding="utf-8")
        store = ConfigStore(self.root / "config.json")
        store.add(str(docs))

        with mock.patch("render_mdx.cli.CONTENT_DIR", self.root / "rendered"):
            initial = sync_once(store)
            second.write_text("# Second\n", encoding="utf-8")
            updated = sync_once(store)

        self.assertEqual(
            [document["path"] for document in initial["documents"]], [str(first)]
        )
        self.assertEqual(
            [document["path"] for document in updated["documents"]],
            [str(first), str(second)],
        )
        navigation = json.loads(
            (self.root / "rendered" / "_navigation.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            [item["path"] for item in navigation["items"]],
            [str(first), str(second)],
        )

    def test_sync_once_tracks_documents_for_overlapping_sources(self) -> None:
        docs = self.root / "docs"
        nested = docs / "nested"
        nested.mkdir(parents=True)
        document = nested / "guide.mdx"
        document.write_text("# Guide\n", encoding="utf-8")
        store = ConfigStore(self.root / "config.json")
        store.add(str(docs))
        store.add(str(nested))

        with mock.patch("render_mdx.cli.CONTENT_DIR", self.root / "rendered"):
            result = sync_once(store)

        self.assertEqual(len(result["documents"]), 1)
        self.assertEqual(
            result["documents"][0]["sources"],
            [str(docs.resolve()), str(nested.resolve())],
        )

    def test_visible_sources_hides_a_file_covered_by_a_directory(self) -> None:
        store = ConfigStore(self.root / "config.json")
        store.add(str(self.source))
        store.add(str(self.root))

        result = visible_sources(store.sources())

        self.assertEqual([source.path for source in result], [self.root.resolve()])

    def test_visible_sources_keeps_an_uncovered_file(self) -> None:
        docs = self.root / "docs"
        other = self.root / "other"
        docs.mkdir()
        other.mkdir()
        (docs / "covered.mdx").write_text("# Covered\n", encoding="utf-8")
        standalone = other / "standalone.mdx"
        standalone.write_text("# Standalone\n", encoding="utf-8")
        store = ConfigStore(self.root / "config.json")
        store.add(str(docs))
        store.add(str(standalone))

        result = visible_sources(store.sources())

        self.assertEqual(
            [source.path for source in result],
            [docs.resolve(), standalone.resolve()],
        )

    def test_navigation_order_matches_sidebar_tree_and_skips_covered_file(
        self,
    ) -> None:
        docs = self.root / "docs"
        nested = docs / "nested"
        nested.mkdir(parents=True)
        top = docs / "z-top.mdx"
        child_b = nested / "b-child.mdx"
        child_a = nested / "a-child.mdx"
        for path in (top, child_b, child_a):
            path.write_text(f"# {path.stem}\n", encoding="utf-8")
        sources = [Source(top), Source(docs)]
        documents = [
            {
                "path": str(path),
                "source": str(docs),
                "sources": [str(docs), str(top)] if path == top else [str(docs)],
                "title": path.stem,
                "url": f"/rendered/{path.stem}/",
            }
            for path in (top, child_b, child_a)
        ]

        result = build_navigation_order(sources, documents)

        self.assertEqual(
            [(item["source"], item["path"]) for item in result],
            [
                (str(docs), str(child_a)),
                (str(docs), str(child_b)),
                (str(docs), str(top)),
            ],
        )

    def test_install_skill_creates_project_agents_skill_directory(self) -> None:
        destination = install_skill(str(self.root))

        self.assertEqual(
            destination, self.root / ".agents" / "skills" / "render-mdx-components"
        )
        self.assertTrue((destination / "SKILL.md").is_file())
        self.assertTrue((destination / "evals" / "evals.json").is_file())

    def test_install_skill_refuses_to_replace_existing_skill_without_force(
        self,
    ) -> None:
        destination = install_skill(str(self.root))

        with self.assertRaisesRegex(FileExistsError, "already exists"):
            install_skill(str(self.root))

        self.assertTrue((destination / "SKILL.md").is_file())

    def test_install_skill_replaces_existing_skill_with_force(self) -> None:
        destination = install_skill(str(self.root))
        stale = destination / "stale.txt"
        stale.write_text("old", encoding="utf-8")

        replaced = install_skill(str(self.root), force=True)

        self.assertEqual(replaced, destination)
        self.assertTrue((destination / "SKILL.md").is_file())
        self.assertFalse(stale.exists())

    def test_app_template_exposes_bundled_mdx_components(self) -> None:
        config = (APP_TEMPLATE / "astro.config.mjs").read_text(encoding="utf-8")
        components = APP_TEMPLATE / "src" / "components" / "mdx"
        exports = (components / "index.ts").read_text(encoding="utf-8")

        self.assertIn("'@mdx-components':", config)
        self.assertTrue((components / "index.ts").is_file())
        self.assertTrue((components / "CodeWalkthrough.astro").is_file())
        self.assertTrue((components / "CodeWalkthroughStep.astro").is_file())
        self.assertIn("CodeWalkthrough", exports)
        self.assertIn("CodeWalkthroughStep", exports)

    def test_packaged_code_walkthrough_matches_the_development_app(self) -> None:
        project_root = Path(__file__).resolve().parents[1]
        mirrored_files = (
            "src/components/mdx/CodeWalkthrough.astro",
            "src/components/mdx/CodeWalkthroughStep.astro",
            "src/components/mdx/codeWalkthrough.ts",
            "src/components/mdx/index.ts",
            "src/components/CustomMarkdownContent.astro",
            "src/styles/custom.css",
        )

        for relative_path in mirrored_files:
            with self.subTest(path=relative_path):
                development = (project_root / relative_path).read_text(encoding="utf-8")
                packaged = (APP_TEMPLATE / relative_path).read_text(encoding="utf-8")
                self.assertEqual(packaged, development)

    def test_app_template_bundles_registered_document_tree(self) -> None:
        components = APP_TEMPLATE / "src" / "components"
        page_frame = (components / "CustomPageFrame.astro").read_text(encoding="utf-8")
        document_tree = (components / "DocumentTree.astro").read_text(encoding="utf-8")
        source_picker = (components / "SourcePicker.astro").read_text(encoding="utf-8")
        route_data = (APP_TEMPLATE / "src" / "route-data.ts").read_text(
            encoding="utf-8"
        )
        astro_config = (APP_TEMPLATE / "astro.config.mjs").read_text(encoding="utf-8")

        self.assertIn("<DocumentTree />", page_frame)
        self.assertIn("/api/state", document_tree)
        self.assertIn("state.displaySources", document_tree)
        self.assertIn("state.displaySources", source_picker)
        self.assertIn("relativeParts", document_tree)
        self.assertIn("document-tree__folder", document_tree)
        self.assertIn("_navigation.json", route_data)
        self.assertIn("routeMiddleware: './src/route-data.ts'", astro_config)

    def test_authoring_skill_lists_supported_aside_types(self) -> None:
        skill = (BUNDLED_SKILLS / "render-mdx-components" / "SKILL.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("`note`, `tip`, `caution`, or `danger`", skill)
        self.assertNotIn('type="warning"', skill)

    def test_build_astro_env_enables_polling_on_linux(self) -> None:
        with mock.patch("render_mdx.cli.sys.platform", "linux"):
            env = build_astro_env("http://127.0.0.1:8765")

        self.assertEqual(env["RENDER_MDX_API_URL"], "http://127.0.0.1:8765")
        self.assertEqual(env["CHOKIDAR_USEPOLLING"], "1")
        self.assertEqual(env["CHOKIDAR_INTERVAL"], "250")

    def test_build_astro_env_preserves_existing_watcher_overrides(self) -> None:
        with (
            mock.patch("render_mdx.cli.sys.platform", "linux"),
            mock.patch.dict(
                "render_mdx.cli.os.environ",
                {"CHOKIDAR_USEPOLLING": "0", "CHOKIDAR_INTERVAL": "900"},
                clear=False,
            ),
        ):
            env = build_astro_env("http://127.0.0.1:8765")

        self.assertEqual(env["CHOKIDAR_USEPOLLING"], "0")
        self.assertEqual(env["CHOKIDAR_INTERVAL"], "900")

    def test_start_api_server_falls_back_when_requested_port_is_busy(self) -> None:
        class QuietHandler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # pragma: no cover - handler body is irrelevant
                self.send_response(200)
                self.end_headers()

            def log_message(self, fmt: str, *args: object) -> None:
                return

        occupied = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        self.addCleanup(occupied.server_close)

        server = start_api_server(
            ConfigStore(self.root / "config.json"),
            self.root,
            "127.0.0.1",
            occupied.server_address[1],
        )
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)

        self.assertNotEqual(server.server_address[1], occupied.server_address[1])
        self.assertGreater(server.server_address[1], 0)


if __name__ == "__main__":
    unittest.main()
