from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from render_mdx.cli import ConfigStore, install_skill, parse_args, register_paths


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


if __name__ == "__main__":
    unittest.main()
