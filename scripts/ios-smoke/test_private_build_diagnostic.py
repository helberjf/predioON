"""Portable guards plus real POSIX filesystem/subprocess checks; no Apple tools."""
import copy
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('private_diagnostic_collector', BASE / 'collect_build_diagnostic.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.environment = {'GITHUB_ACTIONS': 'true', 'RUNNER_OS': 'macOS', 'GITHUB_REF': 'refs/heads/main',
                            'GITHUB_REPOSITORY': 'helberjf/predioON', 'GITHUB_SHA': 'a' * 40,
                            'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'RUNNER_TEMP': str(self.root),
                            'IOS_BUILD_PRIVATE_DIAGNOSTIC': '1', 'IOS_JOURNEY_OUTCOME': 'failure', 'IOS_EVIDENCE_READY': 'true'}
        self.report = {'passed': False, 'scope': collector.SCOPE, 'commit': 'a' * 40,
                       'runtime': 'com.apple.CoreSimulator.SimRuntime.iOS-18-5', 'sdkVersion': '18.5', 'steps': [],
                       'failureKind': 'native-journey-failed', 'failureDiagnostic': {'stage': 'runner-build', 'category': 'nonzero-exit', 'exitCode': 70}}

    def test_eligibility_is_closed_and_original_report_is_never_modified(self):
        original = copy.deepcopy(self.report)
        self.assertEqual(collector.eligible_context(self.report, self.environment)['exitCode'], 70)
        self.assertEqual(self.report, original)
        for key, value in [('IOS_BUILD_PRIVATE_DIAGNOSTIC', '0'), ('IOS_JOURNEY_OUTCOME', 'success'), ('IOS_EVIDENCE_READY', 'false'), ('GITHUB_SHA', 'b' * 40), ('GITHUB_REF', 'refs/heads/other'), ('RUNNER_OS', 'Windows')]:
            with self.subTest(key=key):
                self.assertIsNone(collector.eligible_context(self.report, {**self.environment, key: value}))

    def test_ineligible_result_never_reads_log_key_or_launches_child(self):
        variants = []
        for patch_report in [{'passed': True}, {'failureKind': 'security-rejection'}, {'failureKind': 'phase-rejected'}, {'private': 'secret'}, {'failureDiagnostic': {'stage': 'runner-test', 'category': 'nonzero-exit', 'exitCode': 70}}, {'failureDiagnostic': {'stage': 'runner-build', 'category': 'timed-out', 'exitCode': None}}]:
            variants.append({**self.report, **patch_report})
        for report in variants:
            with self.subTest(report=report), patch.object(collector, 'read_report', return_value=report), patch.object(collector, 'read_private_log', side_effect=AssertionError('must not read')) as read, patch.object(collector, 'invoke_sealer', side_effect=AssertionError('must not launch')) as child:
                self.assertEqual(collector.collect(self.root, self.environment), 'skipped')
                read.assert_not_called()
                child.assert_not_called()
        for key, value in [('IOS_BUILD_PRIVATE_DIAGNOSTIC', '0'), ('IOS_JOURNEY_OUTCOME', 'success'), ('IOS_EVIDENCE_READY', 'false'), ('GITHUB_SHA', 'b' * 40), ('GITHUB_REF', 'refs/heads/other'), ('GITHUB_REPOSITORY', 'other/repo'), ('RUNNER_OS', 'Windows'), ('GITHUB_ACTIONS', 'false')]:
            with self.subTest(gate=key), patch.object(collector, 'read_report', return_value=self.report), patch.object(collector, 'read_private_log') as read, patch.object(collector, 'invoke_sealer') as child:
                self.assertEqual(collector.collect(self.root, {**self.environment, key: value}), 'skipped')
                read.assert_not_called()
                child.assert_not_called()

    def test_child_environment_drops_credentials_preloads_and_debug_switches(self):
        context = collector.eligible_context(self.report, self.environment)
        environment = collector.child_environment(context)
        self.assertEqual(set(environment), {'GITHUB_ACTIONS', 'RUNNER_OS', 'IOS_DIAGNOSTIC_CONTEXT'})
        self.assertEqual(json.loads(environment['IOS_DIAGNOSTIC_CONTEXT']), context)

    def test_subprocess_is_one_bounded_attempt_with_devnull_not_public_capture(self):
        with patch.object(collector.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            collector.invoke_sealer(sys.executable, BASE, b'private payload', collector.eligible_context(self.report, self.environment))
        self.assertEqual(run.call_count, 1)
        _, options = run.call_args
        self.assertEqual(options['timeout'], 15)
        self.assertEqual(options['stdout'], subprocess.DEVNULL)
        self.assertEqual(options['stderr'], subprocess.DEVNULL)
        self.assertEqual(options['input'], b'private payload')

    @unittest.skipUnless(os.name == 'posix', 'POSIX owner/mode/openat guards; CI target is macOS')
    def test_real_log_accepts_only_owned_0600_regular_file(self):
        folder = self.root / 'ios-auth-private'
        folder.mkdir(mode=0o700)
        path = folder / 'runner-build.log'
        path.write_bytes(b'private\x00log')
        path.chmod(0o600)
        self.assertEqual(collector.read_private_log(self.root), b'private\x00log')
        for mode in [0o644, 0o660, 0o400]:
            path.chmod(mode)
            with self.subTest(mode=mode), self.assertRaises(Exception): collector.read_private_log(self.root)

    @unittest.skipUnless(os.name == 'posix', 'POSIX symlink/hardlink guards')
    def test_symlinks_hardlinks_and_oversize_are_rejected_without_truncation(self):
        folder = self.root / 'ios-auth-private'
        folder.mkdir(mode=0o700)
        path = folder / 'runner-build.log'
        target = self.root / 'secret'
        target.write_bytes(b'private')
        target.chmod(0o600)
        path.symlink_to(target)
        with self.assertRaises(Exception): collector.read_private_log(self.root)
        path.unlink()
        os.link(target, path)
        with self.assertRaises(Exception): collector.read_private_log(self.root)
        path.unlink()
        path.write_bytes(b'x' * (collector.MAX_LOG + 1))
        path.chmod(0o600)
        with self.assertRaises(Exception): collector.read_private_log(self.root)
        self.assertEqual(path.stat().st_size, collector.MAX_LOG + 1)

    def test_sealer_errors_and_timeout_cannot_write_a_ready_flag(self):
        for error in [OSError('private env argv'), subprocess.TimeoutExpired('secret', 15), RuntimeError('private stderr')]:
            with self.subTest(error=type(error).__name__), patch.object(collector, 'read_report', return_value=self.report), patch.object(collector, 'read_private_log', return_value=b'private'), patch.object(collector, 'invoke_sealer', side_effect=error), patch.object(collector, 'write_ready') as ready:
                self.assertEqual(collector.collect(self.root, self.environment), 'unavailable')
                ready.assert_not_called()
                self.assertEqual(self.report['failureDiagnostic']['exitCode'], 70)

    @unittest.skipUnless(os.name == 'posix', 'POSIX descriptor/path identity guard')
    def test_replacing_log_name_during_read_is_rejected(self):
        folder = self.root / 'ios-auth-private'
        folder.mkdir(mode=0o700)
        path = folder / 'runner-build.log'
        path.write_bytes(b'original private log')
        path.chmod(0o600)
        original_read = os.read
        changed = False
        def replacing_read(fd, count):
            nonlocal changed
            data = original_read(fd, count)
            if not changed:
                changed = True
                path.rename(folder / 'previous')
                path.write_bytes(b'replacement')
                path.chmod(0o600)
            return data
        with patch.object(collector.os, 'read', side_effect=replacing_read), self.assertRaises(Exception):
            collector.read_private_log(self.root)

    @unittest.skipUnless(os.name == 'posix', 'Actual CI subprocess and file descriptors require POSIX')
    def test_real_node_sealer_exports_only_ciphertext_and_separate_ready_flag(self):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'Node24 is required for the real encryption boundary test')
        generator = "const c=require('node:crypto');const p=c.generateKeyPairSync('rsa',{modulusLength:4096,publicExponent:65537}).publicKey;process.stdout.write(JSON.stringify({pem:p.export({type:'spki',format:'pem'}),id:c.createHash('sha256').update(p.export({type:'spki',format:'der'})).digest('hex')}));"
        recipient = json.loads(subprocess.run([node, '-e', generator], capture_output=True, text=True, check=True, timeout=15).stdout)
        scripts = self.root / 'scripts/ios-smoke'
        scripts.mkdir(parents=True)
        scripts.joinpath('private_build_diagnostic.mjs').write_text(BASE.joinpath('private_build_diagnostic.mjs').read_text().replace(collector.RECIPIENT_KEY_ID, recipient['id']))
        scripts.joinpath('diagnostic-recipient-public.pem').write_text(recipient['pem'])
        private = self.root / 'ios-auth-private'
        private.mkdir(mode=0o700)
        log = private / 'runner-build.log'
        payload = b'SENTINEL-password-DSN-token\x00 ::error:: native build failure'
        log.write_bytes(payload)
        log.chmod(0o600)
        evidence = self.root / '.local/ios-auth/evidence'
        evidence.mkdir(parents=True)
        report = json.dumps(self.report).encode()
        evidence.joinpath('result.json').write_bytes(report)
        output = self.root / 'outputs'
        output.touch(mode=0o600)
        environment = {**self.environment, 'GITHUB_OUTPUT': str(output), 'NODE_OPTIONS': '--require /private/secret', 'DATABASE_URL': 'secret'}
        public_output = io.StringIO()
        with patch.object(collector, 'RECIPIENT_KEY_ID', recipient['id']), redirect_stdout(public_output), redirect_stderr(public_output):
            self.assertEqual(collector.collect(self.root, environment), 'ready')
        self.assertEqual(public_output.getvalue(), '')
        self.assertEqual(output.read_text(), 'private-diagnostic-ready=true\n')
        self.assertEqual(log.read_bytes(), payload)
        self.assertEqual(evidence.joinpath('result.json').read_bytes(), report)
        envelope = self.root / '.local/ios-auth/encrypted-diagnostic/runner-build.envelope.json'
        self.assertNotIn(payload, envelope.read_bytes())
        self.assertEqual(set(path.name for path in envelope.parent.iterdir()), {collector.ENVELOPE})
        self.assertEqual(envelope.stat().st_mode & 0o777, 0o600)

    @unittest.skipUnless(os.name == 'posix', 'Real post-failure child test requires POSIX staging')
    def test_real_child_errors_are_silent_and_never_retried(self):
        scripts = self.root / 'scripts/ios-smoke'
        scripts.mkdir(parents=True)
        scripts.joinpath('private_build_diagnostic.mjs').write_text("import{appendFileSync}from'node:fs';appendFileSync('called','1');console.log('SENTINEL-password ::error::');console.error(JSON.stringify(process.env));process.exit(29);")
        # Capture OS-level streams around the collector, so a child accidentally
        # inheriting stdout/stderr would expose the sentinel and fail this test.
        driver = """import json,sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
import collect_build_diagnostic as collector
with patch.object(collector, 'read_report', return_value=json.loads(sys.argv[3])), patch.object(collector, 'read_private_log', return_value=b'private'):
    print(collector.collect(Path(sys.argv[2]), json.loads(sys.argv[4])))
"""
        result = subprocess.run([sys.executable, '-B', '-c', driver, str(BASE), str(self.root), json.dumps(self.report), json.dumps(self.environment)], capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, 'unavailable\n')
        self.assertEqual(result.stderr, '')
        self.assertEqual(self.root.joinpath('called').read_text(), '1')
        self.assertFalse(self.root.joinpath('.local/ios-auth/encrypted-diagnostic').exists())

    def test_envelope_validator_rejects_wrong_context_types_duplicates_and_noncanonical_base64(self):
        import base64
        context = collector.eligible_context(self.report, self.environment)
        encode = lambda size: base64.b64encode(b'x' * size).decode()
        item = {'version': 1, 'algorithm': 'RSA-OAEP-SHA256+A256GCM', 'keyId': collector.RECIPIENT_KEY_ID,
                'context': context, 'iv': encode(12), 'wrappedKey': encode(512), 'ciphertext': encode(7), 'tag': encode(16)}
        serialize = lambda value: (json.dumps(value, separators=(',', ':')) + '\n').encode()
        collector.validate_envelope(serialize(item), context, 7)
        for field, value in [('version', True), ('extra', 'secret'), ('tag', encode(8)), ('iv', encode(12) + '\n'), ('keyId', '0' * 64), ('ciphertext', encode(8))]:
            with self.subTest(field=field), self.assertRaises(Exception):
                collector.validate_envelope(serialize({**item, field: value}), context, 7)
        data = serialize(item).replace(b'"version":1', b'"version":1,"version":1')
        with self.assertRaises(Exception): collector.validate_envelope(data, context, 7)
        context_one = {**context, 'exitCode': 1}
        boolean_context = {**context_one, 'exitCode': True}
        with self.assertRaises(Exception):
            collector.validate_envelope(serialize({**item, 'context': boolean_context}), context_one, 7)

    @unittest.skipUnless(os.name == 'posix', 'POSIX parent/FIFO/owner guards')
    def test_parent_symlink_fifo_wrong_owner_and_directory_fail_without_reading(self):
        folder = self.root / 'ios-auth-private'
        real = self.root / 'real'
        real.mkdir(mode=0o700)
        folder.symlink_to(real, target_is_directory=True)
        with self.assertRaises(Exception): collector.read_private_log(self.root)
        folder.unlink()
        folder.mkdir(mode=0o700)
        path = folder / 'runner-build.log'
        os.mkfifo(path, 0o600)
        with self.assertRaises(Exception): collector.read_private_log(self.root)
        path.unlink()
        path.mkdir()
        with self.assertRaises(Exception): collector.read_private_log(self.root)
        path.rmdir()
        path.write_bytes(b'private')
        path.chmod(0o600)
        with patch.object(collector.os, 'getuid', return_value=os.getuid() + 1), self.assertRaises(Exception):
            collector.read_private_log(self.root)

    def test_real_timeout_and_missing_spawn_never_expose_child_output(self):
        scripts = self.root / 'scripts/ios-smoke'
        scripts.mkdir(parents=True)
        scripts.joinpath('private_build_diagnostic.mjs').write_text("import sys,time\nsys.stdout.write('SENTINEL-password\\n');sys.stdout.flush()\nsys.stderr.write('SENTINEL-DSN-env-argv\\n');sys.stderr.flush()\ntime.sleep(60)\n")
        context = collector.eligible_context(self.report, self.environment)
        output = io.StringIO()
        with redirect_stdout(output), redirect_stderr(output):
            with self.assertRaises(subprocess.TimeoutExpired) as timed:
                collector.invoke_sealer(sys.executable, self.root, b'private', context)
            with self.assertRaises(OSError):
                collector.invoke_sealer(self.root / 'missing-private-node', self.root, b'private', context)
        # POSIX communicate reports its remaining budget after process startup.
        self.assertGreater(timed.exception.timeout, 14)
        self.assertLessEqual(timed.exception.timeout, 15)
        self.assertIsNone(timed.exception.stdout)
        self.assertIsNone(timed.exception.stderr)
        self.assertEqual(output.getvalue(), '')

    def test_real_original_exit_and_first_latch_survive_collector_error(self):
        from run_auth import FailureDiagnostic, PrivateCommandFailure, command
        diagnostic = FailureDiagnostic()
        with self.assertRaises(PrivateCommandFailure) as original:
            with diagnostic.stage('runner-build'):
                command(sys.executable, '-c', "import sys;print('SENTINEL-private-output');sys.exit(70)", observe_build_signals=True)
        first = copy.deepcopy(diagnostic.first)
        self.report['failureDiagnostic'] = first
        output = io.StringIO()
        with patch.object(collector, 'read_report', return_value=self.report), patch.object(collector, 'read_private_log', side_effect=OSError('SENTINEL-private-error')), redirect_stdout(output), redirect_stderr(output):
            self.assertEqual(collector.collect(self.root, self.environment), 'unavailable')
        self.assertEqual(original.exception.exit_code, 70)
        self.assertEqual(diagnostic.first, first)
        self.assertFalse(self.report['passed'])
        self.assertEqual(output.getvalue(), '')

    @unittest.skipUnless(os.name == 'posix', 'POSIX workflow output path guards')
    def test_ready_flag_cannot_follow_link_or_escape_runner_temporary_directory(self):
        target = self.root / 'keep'
        target.write_text('keep')
        target.chmod(0o600)
        link = self.root / 'output'
        link.symlink_to(target)
        with self.assertRaises(Exception):
            collector.write_ready({**self.environment, 'GITHUB_OUTPUT': str(link)})
        with self.assertRaises(Exception):
            collector.write_ready({**self.environment, 'GITHUB_OUTPUT': str(self.root.parent / 'outside-output')})
        self.assertEqual(target.read_text(), 'keep')

    def test_workflow_keeps_the_original_journey_arguments_and_separate_failure_upload(self):
        workflow = (BASE.parents[1] / '.github/workflows/ios-auth.yml').read_text()
        self.assertIn('umask 077\n          python3 -B scripts/ios-smoke/run_auth.py --private "$IOS_AUTH_PRIVATE"', workflow)
        self.assertIn('--resident "$IOS_AUTH_PRIVATE/build-resident-mobile/Build/Products/Release-iphonesimulator/PredioONMorador.app"', workflow)
        self.assertIn('--operations "$IOS_AUTH_PRIVATE/build-operations-mobile/Build/Products/Release-iphonesimulator/PredioONOperacao.app"', workflow)
        self.assertLess(workflow.index('name: Export only approved'), workflow.index('id: private-diagnostic'))
        companion = workflow[workflow.index('id: private-diagnostic'):]
        self.assertIn("steps.journey.outcome == 'failure' && steps.journey.outputs.evidence-ready == 'true'", companion)
        self.assertEqual(companion.count('continue-on-error: true'), 2)
        self.assertIn('path: .local/ios-auth/encrypted-diagnostic/runner-build.envelope.json', companion)
        self.assertIn('retention-days: 1', companion)
        self.assertIn('overwrite: false', companion)


if __name__ == '__main__':
    unittest.main()
