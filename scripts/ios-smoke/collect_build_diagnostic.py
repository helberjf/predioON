"""Optional post-failure collector. Never export plaintext or alter journey results."""
import base64
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
sys.path.insert(0, str(BASE))
from run_auth import safe_json, SCOPE

MAX_LOG = 2 * 1024 * 1024
MAX_ENVELOPE = 3 * 1024 * 1024
RECIPIENT_KEY_ID = 'f792f93f45f280e421b4d5f643de2523d17f8a909be69bb34bb4bb48af28b8b2'
ENVELOPE = 'runner-build.envelope.json'


def eligible_context(report, environment):
    required = {'GITHUB_ACTIONS': 'true', 'RUNNER_OS': 'macOS', 'GITHUB_REF': 'refs/heads/main',
                'GITHUB_REPOSITORY': 'helberjf/predioON', 'IOS_BUILD_PRIVATE_DIAGNOSTIC': '1',
                'IOS_JOURNEY_OUTCOME': 'failure', 'IOS_EVIDENCE_READY': 'true'}
    if any(environment.get(key) != value for key, value in required.items()):
        return None
    try:
        safe_json('result.json', report)
        first = report.get('failureDiagnostic', {})
        if report['passed'] is not False or report.get('failureKind') != 'native-journey-failed' or report.get('securityFailure') is not None or first.get('stage') != 'runner-build' or first.get('category') != 'nonzero-exit' or type(first.get('exitCode')) is not int or first['exitCode'] == 0:
            return None
        if report['commit'] != environment.get('GITHUB_SHA') or not re.fullmatch(r'[1-9][0-9]{0,19}', environment.get('GITHUB_RUN_ID', '')) or not re.fullmatch(r'[1-9][0-9]{0,5}', environment.get('GITHUB_RUN_ATTEMPT', '')):
            return None
        return {'repository': 'helberjf/predioON', 'sha': report['commit'], 'runId': environment['GITHUB_RUN_ID'],
                'runAttempt': environment['GITHUB_RUN_ATTEMPT'], 'stage': 'runner-build', 'exitCode': first['exitCode']}
    except Exception:
        return None


def directory_fd(root, parts=(), create=False):
    if os.name != 'posix' or not hasattr(os, 'O_NOFOLLOW'):
        raise ValueError('Private collector requires POSIX guards')
    fd = os.open(Path(root).resolve(strict=True), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts:
            if part in {'', '.', '..'} or '/' in part or '\\' in part:
                raise ValueError('Invalid private path')
            if create:
                try: os.mkdir(part, 0o700, dir_fd=fd)
                except FileExistsError: pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            info = os.fstat(fd)
            if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o022:
                raise ValueError('Invalid private owner or mode')
        return fd
    except Exception:
        os.close(fd)
        raise


def read_owned(root, parts, cap, private_log=False):
    parent = directory_fd(root, parts[:-1])
    try:
        if private_log and stat.S_IMODE(os.fstat(parent).st_mode) != 0o700:
            raise ValueError('Invalid private directory mode')
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_nlink != 1 or not 0 < before.st_size <= cap or (private_log and stat.S_IMODE(before.st_mode) != 0o600) or stat.S_IMODE(before.st_mode) & 0o022:
                raise ValueError('Invalid private file')
            chunks = []
            remaining = before.st_size + 1
            while remaining:
                chunk = os.read(fd, min(remaining, 65536))
                if not chunk: break
                chunks.append(chunk)
                remaining -= len(chunk)
            after = os.fstat(fd)
            linked = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
            identity = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns)
            data = b''.join(chunks)
            if identity(before) != identity(after) or identity(linked) != identity(after) or len(data) != before.st_size:
                raise ValueError('Private file changed')
            return data
        finally: os.close(fd)
    finally: os.close(parent)


def strict_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError('Duplicate field')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique)


def read_report(root):
    return strict_json(read_owned(root, ('.local', 'ios-auth', 'evidence', 'result.json'), 131072))


def read_private_log(temporary):
    return read_owned(temporary, ('ios-auth-private', 'runner-build.log'), MAX_LOG, private_log=True)


def child_environment(context):
    return {'GITHUB_ACTIONS': 'true', 'RUNNER_OS': 'macOS', 'IOS_DIAGNOSTIC_CONTEXT': json.dumps(context, separators=(',', ':'))}


def invoke_sealer(node, root, payload, context):
    result = subprocess.run([str(node), str(Path(root) / 'scripts/ios-smoke/private_build_diagnostic.mjs'), 'seal'],
                            cwd=root, input=payload, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            env=child_environment(context), timeout=15, check=False)
    if result.returncode != 0:
        raise ValueError('Private sealer unavailable')


def validate_envelope(data, context, length):
    item = strict_json(data)
    fields = ['version', 'algorithm', 'keyId', 'context', 'iv', 'wrappedKey', 'ciphertext', 'tag']
    if not isinstance(item, dict) or list(item) != fields or type(item['version']) is not int or item['version'] != 1 or item['algorithm'] != 'RSA-OAEP-SHA256+A256GCM' or item['keyId'] != RECIPIENT_KEY_ID or json.dumps(item['context'], separators=(',', ':')) != json.dumps(context, separators=(',', ':')):
        raise ValueError('Invalid private envelope')
    if (json.dumps(item, separators=(',', ':'), ensure_ascii=False) + '\n').encode() != data:
        raise ValueError('Noncanonical private envelope')
    for field, size in [('iv', 12), ('wrappedKey', 512), ('ciphertext', length), ('tag', 16)]:
        value = item[field]
        if not isinstance(value, str) or len(value) > ((size + 2) // 3) * 4:
            raise ValueError('Invalid encrypted field')
        decoded = base64.b64decode(value, validate=True)
        if len(decoded) != size or base64.b64encode(decoded).decode() != value:
            raise ValueError('Invalid encrypted field')


def write_ready(environment):
    temporary = Path(environment['RUNNER_TEMP']).resolve(strict=True)
    path = Path(environment['GITHUB_OUTPUT'])
    relative = path.relative_to(temporary)
    parent = directory_fd(temporary, relative.parts[:-1])
    try:
        fd = os.open(relative.name, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) & 0o022:
                raise ValueError('Invalid workflow output')
            flag = b'private-diagnostic-ready=true\n'
            if os.write(fd, flag) != len(flag):
                raise ValueError('Workflow output unavailable')
        finally: os.close(fd)
    finally: os.close(parent)


def collect(root=ROOT, environment=None):
    environment = os.environ if environment is None else environment
    parent = None
    created = None
    try:
        context = eligible_context(read_report(root), environment)
        if context is None: return 'skipped'
        payload = read_private_log(Path(environment['RUNNER_TEMP']))
        parent = directory_fd(root, ('.local', 'ios-auth'), create=True)
        os.mkdir('encrypted-diagnostic', 0o700, dir_fd=parent)
        created = os.open('encrypted-diagnostic', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        node = shutil.which('node')
        if not node: raise ValueError('Private sealer unavailable')
        invoke_sealer(Path(node).resolve(strict=True), root, payload, context)
        encoded = read_owned(root, ('.local', 'ios-auth', 'encrypted-diagnostic', ENVELOPE), MAX_ENVELOPE)
        validate_envelope(encoded, context, len(payload))
        write_ready(environment)
        return 'ready'
    except Exception:
        if created is not None:
            try: os.unlink(ENVELOPE, dir_fd=created)
            except OSError: pass
            try:
                linked = os.stat('encrypted-diagnostic', dir_fd=parent, follow_symlinks=False)
                opened = os.fstat(created)
                if (linked.st_dev, linked.st_ino) == (opened.st_dev, opened.st_ino):
                    os.rmdir('encrypted-diagnostic', dir_fd=parent)
            except OSError: pass
        return 'unavailable'
    finally:
        if created is not None: os.close(created)
        if parent is not None: os.close(parent)


if __name__ == '__main__':
    # No original exception, paths, argv, environment, stdout or stderr is printed.
    print('IOS_PRIVATE_DIAGNOSTIC:' + collect())
