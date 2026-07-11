from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from render_mdx.cli import ConfigStore


class RevisionNoteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.source = self.root / "plan.mdx"
        self.source.write_text("# Plan\n\nOriginal content.\n", encoding="utf-8")
        self.store = ConfigStore(self.root / "config.json")

    def test_add_note_writes_a_visible_revision_section(self) -> None:
        self.store.add(str(self.source))

        path, note_id = self.store.add_note(
            str(self.source),
            "Overview — Original content",
            "Clarify the {owner} <before> implementation.",
        )

        result = self.source.read_text(encoding="utf-8")
        self.assertEqual(path, self.source)
        self.assertIn("## Revision notes", result)
        self.assertIn("**Target:** Overview — Original content", result)
        self.assertIn(
            "Clarify the &#123;owner&#125; &lt;before&gt; implementation.", result
        )
        self.assertIn(f'data-rmx-note-id="{note_id}"', result)
        self.assertNotRegex(result, r"Revision note\*\* · \d{4}-\d{2}-\d{2}")

    def test_multiple_notes_share_one_revision_heading(self) -> None:
        self.store.add(str(self.source))

        self.store.add_note(str(self.source), "First target", "First note")
        self.store.add_note(str(self.source), "Second target", "Second note")

        result = self.source.read_text(encoding="utf-8")
        self.assertEqual(result.count("## Revision notes"), 1)
        self.assertEqual(result.count("> **Revision note**"), 2)

    def test_delete_note_removes_only_the_identified_note(self) -> None:
        self.store.add(str(self.source))
        _, first_note_id = self.store.add_note(
            str(self.source), "First target", "First note"
        )
        _, second_note_id = self.store.add_note(
            str(self.source), "Second target", "Second note"
        )

        path = self.store.delete_note(str(self.source), first_note_id)

        result = self.source.read_text(encoding="utf-8")
        self.assertEqual(path, self.source)
        self.assertNotIn(first_note_id, result)
        self.assertNotIn("First note", result)
        self.assertIn(second_note_id, result)
        self.assertIn("Second note", result)
        self.assertIn("## Revision notes", result)

    def test_delete_last_note_removes_empty_revision_section(self) -> None:
        self.store.add(str(self.source))
        _, note_id = self.store.add_note(str(self.source), "Target", "Feedback")

        self.store.delete_note(str(self.source), note_id)

        result = self.source.read_text(encoding="utf-8")
        self.assertNotIn("Revision note", result)
        self.assertNotIn("## Revision notes", result)

    def test_rejects_notes_for_unregistered_documents(self) -> None:
        with self.assertRaisesRegex(ValueError, "not registered"):
            self.store.add_note(str(self.source), "Target", "Feedback")

    def test_rejects_empty_notes(self) -> None:
        self.store.add(str(self.source))

        with self.assertRaisesRegex(ValueError, "Write a note"):
            self.store.add_note(str(self.source), "Target", "  ")


if __name__ == "__main__":
    unittest.main()
