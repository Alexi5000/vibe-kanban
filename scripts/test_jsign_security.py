import hashlib
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


ACTION = Path(__file__).resolve().parents[1] / '.github/actions/setup-jsign/action.yml'


def run_step(name, env):
    text = ACTION.read_text()
    section = text.split('    - name: ' + name + '\n', 1)[1].split('\n    - name:', 1)[0]
    match = re.search(r'^      run: (.*)$', section, re.M)
    script = match.group(1)
    if script == '|':
        script = '\n'.join(line[8:] for line in section[match.end():].splitlines() if line.startswith('        '))
    expressions = {
        'inputs.version': env['JSIGN_VERSION'],
        'inputs.sha256': env['JSIGN_SHA256'],
        'steps.path.outputs.jar': env['JSIGN_JAR'],
        'runner.temp': env['RUNNER_TEMP'],
    }
    for key, value in expressions.items():
        script = script.replace('${{ ' + key + ' }}', value)
    return subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', script], env=env, cwd=env['RUNNER_TEMP'], capture_output=True, text=True)


class JsignSecurity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.jar = self.root / 'jsign-7.4.jar'
        self.jar.write_bytes(b'fixture jar bytes')
        self.marker = self.root / 'executed'
        self.env = dict(os.environ, JSIGN_VERSION='7.4', JSIGN_SHA256=hashlib.sha256(self.jar.read_bytes()).hexdigest(), JSIGN_JAR=str(self.jar), RUNNER_TEMP=str(self.root), GITHUB_OUTPUT=str(self.root / 'output'))

    def test_valid_version_sets_output(self):
        result = run_step('Set jar path', self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'output').read_text(), f'jar={self.jar}\n')

    def test_version_cannot_execute_shell(self):
        self.env['JSIGN_VERSION'] = '7.4$(touch ' + str(self.marker) + ')'
        result = run_step('Set jar path', self.env)
        self.assertFalse(self.marker.exists())
        self.assertNotEqual(result.returncode, 0)

    def test_version_cannot_escape_or_inject_output(self):
        for value in ['../../escape', '7.4\nother=bad', '7.4/../../escape', '--help', '7.4\r']:
            with self.subTest(value=value):
                self.env['JSIGN_VERSION'] = value
                self.assertNotEqual(run_step('Set jar path', self.env).returncode, 0)
                self.assertFalse((self.root / 'output').exists())

    def test_checksum_is_validated_before_download(self):
        for value in ['not-a-checksum', '0' * 63, 'g' * 64, '0' * 64 + '\ninjected']:
            self.env['JSIGN_SHA256'] = value
            self.assertNotEqual(run_step('Set jar path', self.env).returncode, 0)

    def test_checksum_accepts_bytes_and_rejects_tampering(self):
        self.env['JSIGN_SHA256'] = self.env['JSIGN_SHA256'].upper()
        self.assertEqual(run_step('Verify checksum', self.env).returncode, 0)
        self.jar.write_bytes(b'tampered jar bytes')
        self.assertNotEqual(run_step('Verify checksum', self.env).returncode, 0)

    def test_checksum_cannot_execute_shell(self):
        self.env['JSIGN_SHA256'] = '$(touch ' + str(self.marker) + ')'
        result = run_step('Verify checksum', self.env)
        self.assertFalse(self.marker.exists())
        self.assertNotEqual(result.returncode, 0)

    def test_path_is_literal_not_shell_code(self):
        path = self.root / 'jar $(touch executed).jar'
        path.write_bytes(self.jar.read_bytes())
        self.env['JSIGN_JAR'] = str(path)
        self.assertEqual(run_step('Verify checksum', self.env).returncode, 0)
        self.assertFalse(self.marker.exists())

    def test_download_failure_is_fatal(self):
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()
        curl = bin_dir / 'curl'
        curl.write_text('#!/bin/sh\nexit 22\n')
        curl.chmod(0o755)
        self.env['PATH'] = str(bin_dir) + ':' + self.env['PATH']
        self.assertNotEqual(run_step('Download Jsign', self.env).returncode, 0)


if __name__ == '__main__':
    unittest.main()
