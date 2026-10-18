import os
import pathlib
import shutil
import subprocess
import tempfile
import tomllib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class PrivateBillingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        (self.root / "scripts").mkdir()
        shutil.copy(ROOT / "Cargo.toml", self.root / "Cargo.toml")
        shutil.copy(ROOT / "scripts/enable-private-billing.sh", self.root / "scripts")

    def run_script(self, **extra):
        return subprocess.run(
            ["bash", str(self.root / "scripts/enable-private-billing.sh"), "--no-lock"],
            env={**os.environ, **extra}, capture_output=True, text=True,
        )

    def test_private_source_is_pinned_and_idempotent(self):
        before = tomllib.loads((self.root / "Cargo.toml").read_text())
        self.assertNotIn("billing", before["dependencies"])
        self.assertEqual(before["features"]["default"], [])
        self.assertEqual(self.run_script().returncode, 0)
        first = (self.root / "Cargo.toml").read_bytes()
        self.assertEqual(self.run_script().returncode, 0)
        self.assertEqual(first, (self.root / "Cargo.toml").read_bytes())
        after = tomllib.loads(first.decode())
        self.assertEqual(after["features"]["vk-billing"], ["dep:billing"])
        self.assertNotIn("private-billing-source-missing", after["features"])
        billing = after["dependencies"].pop("billing")
        self.assertTrue(billing["optional"])
        self.assertEqual(billing["rev"], "020091913ce5608d6c8bdb667d124fd22ab10561")
        self.assertEqual(after["dependencies"], before["dependencies"])

    def test_invalid_revision_does_not_mutate_manifest(self):
        before = (self.root / "Cargo.toml").read_bytes()
        self.assertNotEqual(self.run_script(VK_BILLING_REV='bad"revision').returncode, 0)
        self.assertEqual(before, (self.root / "Cargo.toml").read_bytes())

    def test_reviewed_revision_override(self):
        revision = "a" * 40
        self.assertEqual(self.run_script(VK_BILLING_REV=revision).returncode, 0)
        manifest = tomllib.loads((self.root / "Cargo.toml").read_text())
        self.assertEqual(manifest["dependencies"]["billing"]["rev"], revision)


if __name__ == "__main__":
    unittest.main()
