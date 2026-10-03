"""Classify a private build failure without exporting any compiler output."""
import json
import os
from pathlib import Path
import re
import stat
import sys

MAX_LOG_BYTES = 16 * 1024 * 1024
MAX_LINE_CHARACTERS = 8192
STAGES = {
    "postgres-configure": "configure.log",
    "postgres-build": "postgres-build.log",
    "postgres-install": "postgres-install.log",
    "btree-gist-install": "btree-gist-install.log",
    "timescale-configure": "timescale-configure.log",
    "timescale-build": "timescale-build.log",
    "timescale-install": "timescale-install.log",
}
HINTS = {
    "compiler_strchrnul_declaration": "Check PostgreSQL strchrnul declaration detection against the macOS SDK.",
    "compiler_strchrnul_availability": "Check PostgreSQL strchrnul availability against the macOS deployment target.",
    "compiler_missing_header": "Check the pinned build dependency headers and include configuration.",
    "linker_failure": "Check the pinned libraries, architecture and linker configuration.",
    "configure_failure": "Check the PostgreSQL configure dependencies and toolchain.",
    "cmake_failure": "Check the Timescale CMake dependencies and toolchain.",
    "make_rule_missing": "Check the extracted source tree and selected build target.",
    "permission_denied": "Check permissions inside the disposable runner build directory.",
    "storage_full": "Check available storage on the disposable runner.",
    "compiler_failure": "The compiler reported an unclassified compilation error.",
    "unclassified_build_failure": "No known signature matched; retain the private log without uploading it.",
    "private_log_unavailable": "The owned private compilation log could not be safely inspected.",
    "invalid_diagnostic_request": "The diagnostic request was rejected without echoing its arguments.",
}
# Patterns select only fixed categories. Matches, filenames, symbols, command
# arguments and environment values are never returned or printed. The first
# two categories distinguish hypotheses documented by PostgreSQL upstream;
# they do not assert a cause unless the corresponding compiler error exists.
PATTERNS = [
    ("compiler_strchrnul_declaration", r"^[^\r\n]*\berror:[^\r\n]*(?:undeclared function|undeclared identifier|conflicting types)[^\r\n]*\bstrchrnul\b"),
    ("compiler_strchrnul_availability", r"^[^\r\n]*\berror:[^\r\n]*\bstrchrnul\b[^\r\n]*only available on macOS"),
    ("compiler_missing_header", r"^[^\r\n]*fatal error:[^\r\n]*(?:file not found|No such file or directory)"),
    ("linker_failure", r"(?:Undefined symbols for architecture|ld: symbol\(s\) not found|undefined reference to)"),
    ("storage_full", r"No space left on device"),
    ("permission_denied", r"Permission denied"),
    ("configure_failure", r"^configure: error:"),
    ("cmake_failure", r"^CMake Error(?: at|:| in)"),
    ("make_rule_missing", r"No rule to make target"),
    ("compiler_failure", r"^[^\r\n]*\berror:"),
]


def result(stage, code, category):
    return {"stage": stage, "exitCode": code, "category": category, "hint": HINTS[category]}


def describe_failure(stage, code, cluster_root, runner_temp):
    if stage not in STAGES or type(code) is not int or not 1 <= code <= 255:
        return result("diagnostic", 2, "invalid_diagnostic_request")
    try:
        runner = Path(runner_temp).resolve(strict=True)
        root = Path(cluster_root)
        if not root.is_absolute() or root.is_symlink() or root.resolve(strict=True) != root:
            raise ValueError("Unowned directory")
        if root.parent != runner or not re.fullmatch(r"predioon-ios-db\.[A-Za-z0-9]{6}", root.name):
            raise ValueError("Unowned directory")
        marker = root / ".owned-ci-cluster"
        log = root / STAGES[stage]
        if marker.is_symlink() or not marker.is_file() or log.is_symlink():
            raise ValueError("Unsafe private log")
        descriptor = os.open(log, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as source:
            metadata = os.fstat(source.fileno())
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_LOG_BYTES:
                raise ValueError("Unsafe private log")
            contents = source.read(MAX_LOG_BYTES + 1)
        if len(contents) > MAX_LOG_BYTES:
            raise ValueError("Unsafe private log")
        decoded = contents.decode("utf-8", errors="replace")
        # Bound each regex input line too; malformed output must not turn a
        # diagnostic into an unbounded regex operation or a log export.
        text = "\n".join(line for line in decoded.splitlines() if len(line) <= MAX_LINE_CHARACTERS)
        for category, pattern in PATTERNS:
            if re.search(pattern, text, flags=re.MULTILINE):
                return result(stage, code, category)
        return result(stage, code, "unclassified_build_failure")
    except (OSError, ValueError):
        return result(stage, code, "private_log_unavailable")


def main(arguments):
    if len(arguments) != 4:
        diagnostic = result("diagnostic", 2, "invalid_diagnostic_request")
    else:
        try:
            code = int(arguments[1])
        except ValueError:
            code = 0
        diagnostic = describe_failure(arguments[0], code, arguments[2], arguments[3])
    print(json.dumps(diagnostic, separators=(",", ":")))
    return 2 if diagnostic["category"] == "invalid_diagnostic_request" else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
