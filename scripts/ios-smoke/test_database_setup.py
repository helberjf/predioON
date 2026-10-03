"""Private build diagnostics; these tests never start PostgreSQL or an Apple app."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

BASE = Path(__file__).resolve().parent
SECRET = "SENTINEL_PRIVATE_PASSWORD_TOKEN_CERTIFICATE"


def load_helper():
    spec = importlib.util.spec_from_file_location("ios_build_diagnostic", BASE / "build_diagnostic.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.helper = load_helper()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.runner = Path(self.temporary.name).resolve()
        self.cluster = self.runner / "predioon-ios-db.ABCDEF"
        self.cluster.mkdir()
        (self.cluster / ".owned-ci-cluster").touch()

    def diagnostic(self, log, stage="postgres-build", code=2):
        (self.cluster / self.helper.STAGES[stage]).write_bytes(log)
        result = self.helper.describe_failure(stage, code, self.cluster, self.runner)
        self.assertEqual(set(result), {"stage", "exitCode", "category", "hint"})
        self.assertEqual(result["stage"], stage)
        self.assertEqual(result["exitCode"], code)
        self.assertNotIn(SECRET, json.dumps(result))
        self.assertNotIn(str(self.cluster), json.dumps(result))
        return result

    def test_known_strchrnul_declaration_and_availability_are_distinct(self):
        for text, expected in [
            ("snprintf.c:123: error: call to undeclared function 'strchrnul'; ISO C99 does not support implicit function declarations", "compiler_strchrnul_declaration"),
            ("snprintf.c:123: error: 'strchrnul' is only available on macOS 15.4 or newer", "compiler_strchrnul_availability"),
        ]:
            with self.subTest(expected=expected):
                result = self.diagnostic((SECRET + "\n" + text + "\n" + SECRET).encode())
                self.assertEqual(result["category"], expected)

    def test_unknown_stderr_still_identifies_stage_and_original_exit(self):
        result = self.diagnostic((SECRET + "\nprivate future error from new compiler").encode(), "timescale-build", 42)
        self.assertEqual(result["category"], "unclassified_build_failure")

    def test_error_categories_never_copy_compiler_arguments_or_paths(self):
        cases = [
            ("fatal error: '" + SECRET + "/openssl/ssl.h' file not found", "compiler_missing_header"),
            ("Undefined symbols for architecture arm64:\n_" + SECRET, "linker_failure"),
            ("configure: error: " + SECRET, "configure_failure"),
            ("CMake Error at " + SECRET + ":1 (project):", "cmake_failure"),
            ("make: *** No rule to make target '" + SECRET + "'. Stop.", "make_rule_missing"),
            (SECRET + ": Permission denied", "permission_denied"),
            (SECRET + ": No space left on device", "storage_full"),
            ("source.c:10: error: " + SECRET, "compiler_failure"),
        ]
        for text, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(self.diagnostic(text.encode())["category"], expected)

    def test_strchrnul_warning_or_plain_secret_does_not_prove_known_error(self):
        for log in [b"checking for strchrnul... yes", b"warning: 'strchrnul' is only available on macOS 15.4", b"strchrnul " + SECRET.encode()]:
            self.assertEqual(self.diagnostic(log)["category"], "unclassified_build_failure")

    def test_unowned_outside_missing_or_oversized_logs_fail_closed(self):
        outside = self.runner.parent / ("outside-" + self.runner.name)
        (self.cluster / "postgres-build.log").write_bytes(b"x" * (self.helper.MAX_LOG_BYTES + 1))
        for cluster, runner in [(self.cluster, self.runner), (outside, self.runner), (self.cluster, self.cluster)]:
            result = self.helper.describe_failure("postgres-build", 2, cluster, runner)
            self.assertEqual(result["category"], "private_log_unavailable")
        (self.cluster / "postgres-build.log").unlink()
        self.assertEqual(self.helper.describe_failure("postgres-build", 2, self.cluster, self.runner)["category"], "private_log_unavailable")
        (self.cluster / ".owned-ci-cluster").unlink()
        self.assertEqual(self.helper.describe_failure("postgres-build", 2, self.cluster, self.runner)["category"], "private_log_unavailable")

    def test_log_symlink_is_not_followed(self):
        other = self.runner / "private-secret"
        other.write_text("error: " + SECRET)
        try:
            (self.cluster / "postgres-build.log").symlink_to(other)
        except OSError:
            self.skipTest("Host does not permit symlink creation")
        result = self.helper.describe_failure("postgres-build", 2, self.cluster, self.runner)
        self.assertEqual(result["category"], "private_log_unavailable")

    def test_cli_errors_and_invalid_inputs_have_no_raw_echo_or_traceback(self):
        for arguments in [[SECRET], [SECRET, "2", str(self.cluster), str(self.runner)], ["postgres-build", SECRET, str(self.cluster), str(self.runner)]]:
            process = subprocess.run([sys.executable, str(BASE / "build_diagnostic.py"), *arguments], capture_output=True, text=True)
            output = process.stdout + process.stderr
            self.assertNotIn(SECRET, output)
            self.assertNotIn("Traceback", output)
            result = json.loads(process.stdout)
            self.assertEqual(result["category"], "invalid_diagnostic_request")
            self.assertEqual(process.returncode, 2)

    def test_invalid_utf8_and_binary_log_are_never_exported(self):
        result = self.diagnostic(b"\xff\xfe\x00" + SECRET.encode() + b"\nsource.c:1: error: private")
        self.assertEqual(result["category"], "compiler_failure")

    def test_malformed_long_line_and_invalid_exit_codes_are_bounded(self):
        result = self.diagnostic(("error: " + SECRET * 4000).encode())
        self.assertEqual(result["category"], "unclassified_build_failure")
        for code in [0, -1, 256, True, "2"]:
            result = self.helper.describe_failure("postgres-build", code, self.cluster, self.runner)
            self.assertEqual(result["category"], "invalid_diagnostic_request")


@unittest.skipUnless(os.name == "posix" and shutil.which("bash"), "Build wrapper fixture requires POSIX bash")
class BuildWrapperTests(unittest.TestCase):
    def fixture(self, root):
        commands = root / "bin"
        commands.mkdir()
        driver = commands / "fixture-command"
        driver.write_text("""#!/usr/bin/env python3
import os
from pathlib import Path
import sys
tool = Path(sys.argv[0]).name
args = sys.argv[1:]
secret = os.environ['FIXTURE_SECRET']
def stage(name):
    print(secret)
    print(os.environ.get('FIXTURE_LOG', 'unrecognized private build failure'), file=sys.stderr)
    if os.environ.get('FAIL_STAGE') == name:
        sys.exit(42)
if tool == 'curl':
    Path(args[args.index('-o') + 1]).write_text('fake pinned source')
elif tool == 'shasum':
    sys.stdin.read()
elif tool == 'tar':
    directory = Path(args[args.index('-C') + 1])
    if '-xjf' in args:
        source = directory / 'postgresql-16.15'
        source.mkdir()
        (source / 'configure').symlink_to(Path(sys.argv[0]).parent / 'postgres-configure')
    else:
        (directory / 'bootstrap').symlink_to(Path(sys.argv[0]).parent / 'timescale-configure')
elif tool == 'brew':
    print('/private/openssl-prefix')
elif tool == 'make':
    name = 'btree-gist-install' if '-C' in args else ('postgres-build' if '-j2' in args else 'postgres-install')
    stage(name)
    if name == 'postgres-install':
        cluster = Path.cwd().parent
        binary = cluster / 'pg16' / 'bin'
        binary.mkdir(parents=True)
        (binary / 'initdb').symlink_to(Path(sys.argv[0]).parent / 'initdb')
elif tool == 'cmake':
    stage('timescale-install' if '--target' in args else 'timescale-build')
elif tool == 'configure':
    stage('postgres-configure')
elif tool == 'bootstrap':
    stage('timescale-configure')
elif tool == 'initdb':
    # This sentinel deliberately stops before any database can be initialized.
    sys.exit(77)
else:
    stage(tool)
""")
        driver.chmod(0o755)
        for name in ["curl", "shasum", "tar", "brew", "make", "cmake", "postgres-configure", "timescale-configure", "initdb"]:
            (commands / name).symlink_to(driver)
        environment = dict(os.environ, GITHUB_ACTIONS="true", RUNNER_OS="macOS", RUNNER_TEMP=str(root), GITHUB_ENV=str(root / "environment"), IOS_DB_PASSWORD=SECRET, FIXTURE_SECRET=SECRET, PATH=str(commands) + os.pathsep + os.environ["PATH"])
        return environment

    def test_each_compile_failure_preserves_exit_hides_logs_and_precedes_password_file(self):
        stages = ["postgres-configure", "postgres-build", "postgres-install", "btree-gist-install", "timescale-configure", "timescale-build", "timescale-install"]
        for stage in stages:
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                env = self.fixture(root)
                env["FAIL_STAGE"] = stage
                env["FIXTURE_LOG"] = "source.c:1: error: call to undeclared function 'strchrnul' " + SECRET
                process = subprocess.run(["bash", str(BASE / "database.sh"), "start"], env=env, capture_output=True, text=True)
                output = process.stdout + process.stderr
                self.assertEqual(process.returncode, 42, output)
                self.assertNotIn(SECRET, output)
                diagnostics = [json.loads(line) for line in output.splitlines() if line.startswith('{')]
                self.assertEqual(len(diagnostics), 1, output)
                self.assertEqual(diagnostics[0]["stage"], stage)
                self.assertEqual(diagnostics[0]["exitCode"], 42)
                self.assertEqual(diagnostics[0]["category"], "compiler_strchrnul_declaration")
                clusters = list(root.glob("predioon-ios-db.*"))
                self.assertEqual(len(clusters), 1)
                self.assertFalse((clusters[0] / "password").exists())

    def test_successful_compilation_reaches_only_fake_initdb_without_failure_diagnostic(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            env = self.fixture(root)
            process = subprocess.run(["bash", str(BASE / "database.sh"), "start"], env=env, capture_output=True, text=True)
            self.assertEqual(process.returncode, 77, process.stdout + process.stderr)
            self.assertNotIn(SECRET, process.stdout + process.stderr)
            self.assertNotIn('"category"', process.stdout + process.stderr)
            self.assertEqual(process.stdout.count("Pinned database build stage completed:"), 7)
            self.assertTrue(next(root.glob("predioon-ios-db.*")).joinpath("password").is_file())

    def test_broken_classifier_and_requested_shell_trace_do_not_export_private_stderr(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            env = self.fixture(root)
            env["FAIL_STAGE"] = "postgres-build"
            # A syntax error makes Python echo its source line into stderr.
            # The wrapper must keep that stderr private and preserve exit 42.
            script = root / "database.sh"
            shutil.copyfile(BASE / "database.sh", script)
            (root / "build_diagnostic.py").write_text("invalid syntax " + SECRET)
            process = subprocess.run(["bash", "-x", str(script), "start"], env=env, capture_output=True, text=True)
            output = process.stdout + process.stderr
            self.assertEqual(process.returncode, 42, output)
            self.assertNotIn(SECRET, output)
            self.assertNotIn("SyntaxError", output)
            diagnostics = [json.loads(line) for line in output.splitlines() if line.startswith('{')]
            self.assertEqual(len(diagnostics), 1, output)
            self.assertEqual(diagnostics[0]["category"], "private_log_unavailable")
            self.assertEqual(diagnostics[0]["stage"], "postgres-build")
            self.assertEqual(diagnostics[0]["exitCode"], 42)


if __name__ == "__main__":
    unittest.main()
