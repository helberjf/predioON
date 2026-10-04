"""PID-scoped native renderer failures; retain metadata, never raw log payloads."""
import re
import subprocess
import threading

PHASES = {"preflight", "startup", "login", "building", "notices", "finance", "expand", "requests", "final"}
KINDS = {"phase", "launch", "tap", "swipe", "text", "back"}
CATEGORIES = {"passed", "renderer-missing-view-state", "renderer-remove-view-at", "renderer-soft-exception",
              "log-format-rejected", "diagnostic-stream-failed", "process-changed", "privacy-rejected",
              "credential-exposure", "crash-or-anr", "adb-failed", "ui-incomplete", "fixture-rejected",
              "configuration-rejected", "harness-failed"}
EPOCH = r"[0-9]{10}\.[0-9]{3,6}"
LOG = re.compile(rf"^\s*({EPOCH})\s+([0-9]+)\s+([0-9]+)\s+([VDIWEF])\s+(\S+):\s?(.*)$")


class RendererFailure(RuntimeError):
    def __init__(self, category):
        if category not in CATEGORIES:
            category = "harness-failed"
        self.category = category
        super().__init__(category)


def classify(source, pid):
    source = source.rstrip("\r\n")
    if not source or re.fullmatch(r"--------- (?:beginning of|switch to) [a-z]+", source):
        return None
    match = LOG.fullmatch(source)
    if not match:
        raise RendererFailure("log-format-rejected")
    instant, owner, _thread, priority, tag, message = match.groups()
    if int(owner) != pid or "SurfaceMountingManager" not in tag:
        return None
    category = None
    if "MissingViewState" in tag or "MissingViewState" in message:
        category = "renderer-missing-view-state"
    elif ("Tried to remove view" in message and "but got view tag" in message) or (
            "removeViewAt:" in message and "view already removed from parent" in message):
        category = "renderer-remove-view-at"
    elif "ReactNoCrashSoftException" in message or "Unhandled SoftException" in message:
        category = "renderer-soft-exception"
    elif priority == "F":
        category = "crash-or-anr"
    return {"category": category, "deviceTime": instant} if category else None


def marker_time(source, expected):
    values = []
    for line in source.splitlines():
        match = LOG.fullmatch(line)
        if match and match.group(5) == "PredioonRenderer" and match.group(6) == expected:
            values.append(match.group(1))
    if len(values) != 1:
        raise RendererFailure("diagnostic-stream-failed")
    return values[0]


class RendererMonitor:
    def __init__(self, pid):
        if type(pid) is not int or not 1 <= pid < 2 ** 31:
            raise RendererFailure("configuration-rejected")
        self.pid, self.failure = pid, None
        self.process, self.reader = None, None
        self.lock = threading.Lock()
        self.stopping = False

    def fail(self, category, instant=None):
        with self.lock:
            if self.failure is None:
                self.failure = {"category": category, "deviceTime": instant}

    def observe(self, source):
        # No raw line, view tag, message, token or UI content is retained.
        try:
            result = classify(source, self.pid)
        except RendererFailure as error:
            self.fail(error.category)
        else:
            if result:
                self.fail(result["category"], result["deviceTime"])

    def start(self, serial):
        try:
            self.process = subprocess.Popen(["adb", "-s", serial, "logcat", f"--pid={self.pid}", "-b", "main", "-v", "epoch", "*:V"],
                                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except OSError:
            raise RendererFailure("diagnostic-stream-failed") from None
        def read():
            try:
                while True:
                    value = self.process.stdout.readline(65537)
                    if not value:
                        if not self.stopping:
                            self.fail("diagnostic-stream-failed")
                        return
                    if len(value) > 65536:
                        self.fail("log-format-rejected")
                        return
                    self.observe(value.decode("utf-8", errors="replace"))
                    if self.failure:
                        return
            except (OSError, ValueError):
                if not self.stopping:
                    self.fail("diagnostic-stream-failed")
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

    def check(self):
        if self.process is not None and not self.stopping and self.process.poll() is not None:
            self.fail("diagnostic-stream-failed")
        with self.lock:
            failure = self.failure
        if failure:
            raise RendererFailure(failure["category"])

    def snapshot(self, adb):
        self.check()
        try:
            if adb("shell", "pidof", "com.predioon.resident", required=False).strip() != str(self.pid):
                self.fail("process-changed")
                self.check()
            source = adb("logcat", f"--pid={self.pid}", "-b", "main", "-d", "-v", "epoch", "*:V")
            if len(source) > 16 * 1024 * 1024:
                raise RendererFailure("log-format-rejected")
            for line in source.splitlines():
                self.observe(line)
                self.check()
        except RendererFailure:
            raise
        except Exception:
            self.fail("diagnostic-stream-failed")
            raise RendererFailure("diagnostic-stream-failed") from None
        self.check()

    def close(self):
        self.stopping = True
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
            if self.reader:
                self.reader.join(timeout=5)
                if self.reader.is_alive():
                    self.fail("diagnostic-stream-failed")
            if self.process.stdout:
                self.process.stdout.close()


def public_report(passed, category, pid, markers, failure, database_unchanged, source=None):
    if type(passed) is not bool or type(database_unchanged) is not bool or category not in CATEGORIES:
        raise RendererFailure("configuration-rejected")
    if pid is not None and (type(pid) is not int or not 1 <= pid < 2 ** 31):
        raise RendererFailure("configuration-rejected")
    if len(markers) > 4096:
        raise RendererFailure("configuration-rejected")
    clean = []
    keys = {"sequence", "phase", "boundary", "kind", "deviceTime"}
    for sequence, marker in enumerate(markers, 1):
        if (set(marker) != keys or type(marker["sequence"]) is not int or marker["sequence"] != sequence or
                marker["phase"] not in PHASES or marker["boundary"] not in {"before", "after"} or
                marker["kind"] not in KINDS or not isinstance(marker["deviceTime"], str) or
                not re.fullmatch(EPOCH, marker["deviceTime"])):
            raise RendererFailure("configuration-rejected")
        clean.append({key: marker[key] for key in ["sequence", "phase", "boundary", "kind", "deviceTime"]})
    first = None
    if failure is not None:
        if (set(failure) != {"category", "deviceTime"} or failure["category"] not in CATEGORIES or
                (failure["deviceTime"] is not None and (not isinstance(failure["deviceTime"], str) or
                 not re.fullmatch(EPOCH, failure["deviceTime"])))):
            raise RendererFailure("configuration-rejected")
        first = {"category": failure["category"], "deviceTime": failure["deviceTime"]}
    if passed and (category != "passed" or first is not None or pid is None or not database_unchanged):
        raise RendererFailure("configuration-rejected")
    origin = None
    if source is not None:
        if (set(source) != {"commit", "apkSha256", "reactNative", "androidApi", "abi"} or
                not isinstance(source["commit"], str) or not re.fullmatch(r"[0-9a-f]{40}", source["commit"]) or
                not isinstance(source["apkSha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", source["apkSha256"]) or
                source["reactNative"] != "0.87.1" or type(source["androidApi"]) is not int or
                source["androidApi"] != 35 or source["abi"] != "x86_64"):
            raise RendererFailure("configuration-rejected")
        origin = {key: source[key] for key in ["commit", "apkSha256", "reactNative", "androidApi", "abi"]}
    if passed:
        if origin is None:
            raise RendererFailure("configuration-rejected")
        phases = ["startup", "login", "building", "notices", "finance", "expand", "requests", "final"]
        expected = [(phase, boundary) for phase in phases for boundary in ["before", "after"]]
        actual = [(marker["phase"], marker["boundary"]) for marker in clean if marker["kind"] == "phase"]
        if actual != expected:
            raise RendererFailure("configuration-rejected")
        active, action = None, None
        for marker in clean:
            phase, boundary, kind = marker["phase"], marker["boundary"], marker["kind"]
            if kind == "phase":
                if action is not None or (boundary == "before" and active is not None) or (boundary == "after" and active != phase):
                    raise RendererFailure("configuration-rejected")
                active = phase if boundary == "before" else None
            elif active != phase or (boundary == "before" and action is not None) or (boundary == "after" and action != (phase, kind)):
                raise RendererFailure("configuration-rejected")
            else:
                action = (phase, kind) if boundary == "before" else None
        required = {(phase, kind) for phase, kind in [("startup", "launch"), ("login", "tap"), ("building", "tap"),
                                                     ("finance", "tap"), ("expand", "tap"), ("requests", "tap")]}
        observed = {(marker["phase"], marker["kind"]) for marker in clean if marker["boundary"] == "after"}
        if not required.issubset(observed) or active is not None or action is not None:
            raise RendererFailure("configuration-rejected")
    return {"schema": 1, "app": "resident-mobile", "passed": passed, "category": category, "pid": pid,
            "markers": clean, "firstFailure": first, "domainSnapshotUnchanged": database_unchanged, "source": origin}
