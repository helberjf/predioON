"""Verify tenancy-grants evidence after root reviews actual RED; never execute tests."""
from pathlib import Path
from datetime import datetime, timedelta
import argparse
import hashlib
import json
import math
import re

WORK = Path(__file__).resolve().parent
REPO = WORK.parent / "predioON"
ROUTE = "apps/api/src/modules/tenancy/routes.ts"
LABEL = "platform-mfa-tenancy-grants"
TEST_SHA = "137788364b48047a2ddcb46747e06564ba05873df14e97b00435b4936326c543"
TEST_MANIFEST_SHA = "9b5998c27b3aa22a8330281f1ed5a3f7b8b3b808648fc15224df53ac647e490f"
PRODUCT_MANIFEST_SHA = "c501c8217f290055363a67e8b9c3fc9b06118680dbc5ee844f74d8d6ef2c3f43"
PARENT_SHA = "ce90003f2777c890195c814b6560f0ca26edb2989f1770a2c4aabea8939d54ff"
# Runtime/prepared/executor pins are REQUIRED in the root-reviewed config.
# No result or unknown SHA is prefilled by this authoring-only draft.
REGRESSION = {"platform-mfa-tenancy-links": 12, "platform-mfa-tenancy-structure": 12,
              "tenancy-people": 9, "tenancy-http": 9, "tenancy-edit": 11, "membership-lifecycle": 4,
              "platform-mfa-tenancy-commands": 35, "platform-mfa-tenancy-revocations": 21, "platform-mfa-tenancy-create": 17}
DIAGNOSTIC_CAPABILITY = "Baseline201: full original DTO, persisted grant and exact actor/resource/action audit verified before expected403 mismatch"
DIAGNOSTIC_TRIGGER = "Baseline201: full original DTO, persisted grant and audit verified; narrow trigger executed once and removed the same family proof"
TRIGGER_CASES = {f"{kind}: rolls grant audit and family proof back after the narrow audit trigger"
                 for kind in ("unit-memberships", "role-bindings")}
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
read = lambda p: json.loads(p.read_bytes())


def artifact(path):
    path = path.resolve(strict=True)
    assert path.is_relative_to(WORK)
    return {"id": path.relative_to(WORK).as_posix(), "sha256": sha(path), "bytes": path.stat().st_size}


def summary(text, key):
    values = re.findall(r"^# " + re.escape(key) + r" (\d+)\s*$", text, re.M)
    assert len(values) == 1, ("Missing/duplicate TAP summary", key)
    return int(values[0])


def finite(value):
    assert isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
    return value


def native_utc(value):
    # Preserve native UTC; review/document date uses America/Sao_Paulo.
    assert isinstance(value, str) and value.endswith("Z")
    parsed = datetime.fromisoformat(value.removesuffix("Z") + "+00:00")
    assert parsed.utcoffset() == timedelta(0)
    return parsed


def subtest(text, name):
    """Return one unique named case and its native TAP result/diagnostics."""
    headers = list(re.finditer(r"^( *)# Subtest: " + re.escape(name) + r"\s*$", text, re.M))
    assert len(headers) == 1, ("Missing/duplicate named subtest", name)
    header = headers[0]
    indent = header.group(1)
    statuses = list(re.finditer(r"^" + re.escape(indent) + r"(not ok|ok) \d+ - "
                               + re.escape(name) + r"\s*$", text[header.end():], re.M))
    assert len(statuses) == 1, ("Missing/duplicate named result", name)
    status = statuses[0]
    status_start = header.end() + status.start()
    status_end = header.end() + status.end()
    lines = []
    for line in text[status_end:].splitlines():
        if line.strip() and len(line) - len(line.lstrip()) <= len(indent):
            if re.match(r"\s*(?:# Subtest:|(?:not )?ok \d+ - |1\.\.\d+|# (?:tests|suites|pass|fail) )", line):
                break
        lines.append(line)
    return text[header.end():status_start], status.group(1), "\n".join(lines)


def directed_observations(text, dispositions, baseline):
    assert len(dispositions) == 17 and len({d["name"] for d in dispositions}) == 17
    expected_negative_names = {
        f"{kind}: rejects {change} after real manage authorization"
        for kind in ("unit-memberships", "role-bindings")
        for change in ("factor removal", "family proof removal")
    } | TRIGGER_CASES
    # Explicit mapping: this manifest uses a disposition string, NOT the
    # previous revocation manifest's optional baselineExpectedStatus field.
    disposition_map = {"PASS": False, "FAIL_EXPECTED_201_VERSUS_403": True}
    negative_names, observations = set(), []
    for case in dispositions:
        assert case["baseline"] in disposition_map and case["fixed"] == "PASS"
        negative = disposition_map[case["baseline"]]
        if negative:
            negative_names.add(case["name"])
            assert case["diagnostic"] == "Baseline201"
        _, status, block = subtest(text, case["name"])
        assert status == ("not ok" if baseline and negative else "ok"), case["name"]
        if baseline and negative:
            for pattern in (r"failureType:\s*['\"]?testCodeFailure", r"code:\s*['\"]?ERR_ASSERTION",
                            r"operator:\s*['\"]?strictEqual", r"Expected values to be strictly equal"):
                assert re.search(pattern, block), ("Unexpected failure kind", case["name"], pattern)
            assert re.findall(r"^\s+expected:\s*(\d+)\s*$", block, re.M) == ["403"], case["name"]
            assert re.findall(r"^\s+actual:\s*(\d+)\s*$", block, re.M) == ["201"], case["name"]
            assert re.search(r"\b201\s*!==\s*403\b", block), case["name"]
            diagnostic = DIAGNOSTIC_TRIGGER if case["name"] in TRIGGER_CASES else DIAGNOSTIC_CAPABILITY
            assert block.count(diagnostic) == 1, ("Missing exact grant/effect diagnostic", case["name"])
            reason = "MFA_ENROLLMENT_REQUIRED" if ": rejects factor removal " in case["name"] else "MFA_VERIFICATION_REQUIRED"
            observations.append({"case": case["name"], "actualStatus": 201, "expectedStatus": 403,
                                 "exactPrecedingChecksDiagnostic": diagnostic,
                                 "expectedReasonAfterFix": reason,
                                 "boundary": "narrow audit trigger" if case["name"] in TRIGGER_CASES else "real manage authorization"})
    assert negative_names == expected_negative_names
    assert text.count(DIAGNOSTIC_CAPABILITY) == (4 if baseline else 0)
    assert text.count(DIAGNOSTIC_TRIGGER) == (2 if baseline else 0)
    if baseline:
        assert len(observations) == 6
        assert sum(o["boundary"] == "real manage authorization" for o in observations) == 4
        assert sum(o["boundary"] == "narrow audit trigger" for o in observations) == 2
    return observations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pins", type=Path, required=True)
    args = parser.parse_args()
    config_path = args.pins.resolve(strict=True)
    assert config_path.is_relative_to(WORK)
    cfg = read(config_path)
    assert cfg["reviewedByRoot"] is True and cfg["finalPinsReviewedByRoot"] is True
    assert cfg["timeZone"] == "America/Sao_Paulo"
    for key in ("recordedOn", "reviewedOn"):
        assert isinstance(cfg[key], str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", cfg[key])
        datetime.strptime(cfg[key], "%Y-%m-%d")
    PREPARED_PINS = cfg["preparedPins"]
    assert set(PREPARED_PINS) == {"baseline", "fixed"}
    for value in PREPARED_PINS.values():
        assert isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value), "Actual prepared SHA required"
    TYPE_CONFIG_SHA, TYPE_RUNNER_SHA = cfg["configSha256"], cfg["typeRunnerSha256"]
    EXECUTORS_HANDOFF_SHA, PLAN_SHA = cfg["executorsHandoffSha256"], cfg["planSha256"]
    for value in (TYPE_CONFIG_SHA, TYPE_RUNNER_SHA, EXECUTORS_HANDOFF_SHA, PLAN_SHA):
        assert isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value), "Actual reviewed metadata pin required"
    assert cfg["baselineGrantFailuresReviewed"] is True, "Root must review actual RED before verification"
    assert re.fullmatch(r"[a-f0-9]{40}", cfg["head"])
    assert cfg["qaDirectories"] == {
        "baseline": "mfa-tenancy-grants-baseline-db2-attempt2-qa-20261108",
        "fixed": "mfa-tenancy-grants-fixed-db2-qa-20261108",
        "fixed-regression": "mfa-tenancy-grants-fixed-regression-db2-qa-20261108"}
    assert cfg["sourceDirectories"] == {v: f"mfa-tenancy-grants-{v}-qa-20261108" for v in ("baseline", "fixed")}
    assert cfg["regressionLabels"] == list(REGRESSION)
    assert len(cfg["typeFiles"]) == len(set(cfg["typeFiles"])) == 32
    assert cfg["preparedPins"] == PREPARED_PINS and cfg["configSha256"] == TYPE_CONFIG_SHA
    output = WORK / "mfa-tenancy-grants-root-verification-20261108.json"
    assert not output.exists(), "Preserve previous verification"
    plan_path = WORK / "mfa-tenancy-grants-harness-20261108/PLAN.json"
    test_manifest_path = WORK / "mfa-tenancy-grants-test-20261108/manifest.json"
    product_manifest_path = WORK / "mfa-tenancy-grants-candidate-20261108/manifest.json"
    plan, test_manifest = read(plan_path), read(test_manifest_path)
    assert sha(plan_path) == PLAN_SHA and plan["priorPreparedSha256"] == PARENT_SHA
    assert sha(test_manifest_path) == TEST_MANIFEST_SHA == plan["testManifestSha256"]
    assert sha(product_manifest_path) == PRODUCT_MANIFEST_SHA == plan["productManifestSha256"]
    assert sha(test_manifest_path.parent / "apps/api/test" / (LABEL + ".test.ts")) == TEST_SHA == plan["testSha256"]
    assert cfg["typeFiles"] == ["./source/" + x for x in plan["typeTests"]]
    assert len(plan["requiredResolvedSources"]) == 14 and plan["sourceFiles"] == 1036
    assert (plan["directedTapPlanned"], plan["baselineExpectedPass"], plan["baselineExpectedFail"]) == (17, 11, 6)
    assert (test_manifest["independentCases"], test_manifest["parentGroups"], test_manifest["fixedExpectedPass"]) == (17, 0, 17)
    assert (plan["regressionTapPlanned"], plan["regressionIndependentCases"], plan["regressionParentGroups"]) == (130, 120, 10)
    assert {r["name"].removesuffix(".test.ts"): r["cases"] for r in plan["regressionFiles"]} == REGRESSION
    authored_path = WORK / "mfa-tenancy-grants-harness-20261108/AUTHORED-PINS.json"
    authored = read(authored_path)
    assert authored["product"] == plan["productAfterSha256"] and authored["test"] == TEST_SHA
    assert authored["plan"] == PLAN_SHA and authored["config"] == TYPE_CONFIG_SHA and authored["types"] == TYPE_RUNNER_SHA
    parent_path = WORK / "mfa-tenancy-create-fixed-qa-20261107/prepared.json"
    assert sha(parent_path) == PARENT_SHA
    parent = read(parent_path)
    parent_files = {r["file"]: r["sha256"] for r in parent["composedFreeze"]}
    assert len(parent_files) == 1035
    freezes, type_checks = {}, []
    inputs = [artifact(config_path), artifact(plan_path), artifact(test_manifest_path), artifact(product_manifest_path), artifact(authored_path), artifact(parent_path)]
    harness = plan_path.parent
    handoff_path = harness / "executors-handoff.json"
    assert sha(handoff_path) == EXECUTORS_HANDOFF_SHA
    handoff = read(handoff_path)
    assert handoff["preparedPins"] == PREPARED_PINS and handoff["configSha256"] == TYPE_CONFIG_SHA
    assert handoff["typeTests"] == 32 and handoff["requiredSources"] == 14 and handoff["sourceFiles"] == 1036
    assert handoff["processLifecycleModified"] is False and handoff["requiresAlreadyRunningAttestedCluster"] is True
    assert handoff["clusterStartRestartCommandsAdded"] is False and handoff["computerRestarted"] is False
    assert sha(harness / "run-types.mjs") == TYPE_RUNNER_SHA
    assert len(handoff["executors"]) == 6
    for row in handoff["executors"]:
        assert sha(WORK / row["path"]) == row["sha256"]
        inputs.append(artifact(WORK / row["path"]))
    db2_path = harness / "db2-executors-handoff.json"
    assert sha(db2_path) == "48cdc87b765547ed054e042df9fdb4765a10865991fc1ef2aea760695d6a1270"
    db2 = read(db2_path)
    attestation_path = WORK / db2["clusterAttestation"]
    assert sha(attestation_path) == db2["clusterAttestationSha256"] == "9d43fe8e98ce5e11a26e7e943fb465a96f24a4c14368bbdab5712e5282cb426e"
    attestation = read(attestation_path)
    assert attestation["containerId"] == "3c0f4e5e47d3d488766eb2679ba97fabf29b12d72f9b8df41bb504205a41b4c8"
    assert attestation["systemIdentifier"] == "7705939420428193833"
    assert db2["preparedSourceUnchanged"] and db2["processAndCleanupGuardsUnchanged"]
    assert len(db2["executors"]) == 6
    for row in db2["executors"]:
        original, current = WORK / row["modelPath"], WORK / row["path"]
        assert sha(original) == row["modelSha256"] and sha(current) == row["sha256"]
        expected = original.read_text(encoding="utf-8")
        for old, new in row["exactSubstitutions"].items():
            assert expected.count(old) == 1
            expected = expected.replace(old, new)
        assert current.read_text(encoding="utf-8") == expected
        if "-baseline-db2-" in row["path"]:
            actual = WORK / cfg["qaDirectories"]["baseline"] / current.name
        else:
            actual = current
        assert sha(actual) == row["sha256"]
        inputs.append(artifact(actual))
    for refused in ("mfa-tenancy-grants-baseline-qa-20261108", "mfa-tenancy-grants-baseline-db2-qa-20261108"):
        assert not (WORK / refused / "controller-start.json").exists()
        assert not (WORK / refused / "owned-database.json").exists()
        assert not list((WORK / refused).glob("*.log"))
    inputs += [artifact(handoff_path), artifact(db2_path), artifact(attestation_path), artifact(harness / "run-types.mjs")]

    preparations = []
    for variant in ("baseline", "fixed"):
        native_path = harness / f"{variant}-prepare-result.json"
        native, guard = read(native_path), read(harness / f"{variant}-prepare-guard.json")
        prepared_output = read(harness / f"{variant}-prepare.stdout.txt")
        assert native["exitCode"] == 0 and native["timedOut"] is False and native["heapMiB"] == 256
        assert guard["minimumMiB"] == 1536 and finite(guard["freeMiB"]) >= 1536
        native_utc(native["childExitedAt"])
        assert prepared_output["variant"] == variant and prepared_output["status"] == "prepared-only"
        assert prepared_output["rootFiles"] == 994 and prepared_output["candidateFiles"] == 1036
        assert prepared_output["apiTypeTests"] == 32 and prepared_output["preparedSha256"] == PREPARED_PINS[variant]
        preparations.append({"variant": variant, "nativeChildExitedUtc": native["childExitedAt"],
                             "durationMs": finite(native["durationMs"]), "nativeResult": artifact(native_path)})
        inputs += [artifact(harness / f"{variant}-prepare{s}") for s in ("-result.json", "-guard.json", ".stdout.txt", ".stderr.txt")]
    for variant in ("baseline", "fixed"):
        root = WORK / cfg["sourceDirectories"][variant]
        prepared_path = root / "prepared.json"
        assert sha(prepared_path) == cfg["preparedPins"][variant]
        prepared = read(prepared_path)
        assert prepared["variant"] == variant and len(prepared["sourceFreeze"]) == 994
        assert len(prepared["composedFreeze"]) == 1036
        assert prepared["priorPreparedSha256"] == plan["priorPreparedSha256"]
        assert len([j for j in prepared["junctions"] if j["workspace"]]) == 23
        assert len([j for j in prepared["junctions"] if not j["workspace"]]) == 134
        assert prepared["controlFreeze"] == [] and prepared["excludedJunctions"] == []
        assert len(prepared["inheritedExcludedJunctions"]) == 7
        for junction in prepared["junctions"]:
            if junction["workspace"]:
                assert Path(junction["target"]).resolve(strict=True).is_relative_to((root / "source").resolve(strict=True))
        assert all(Path(j["target"]).resolve(strict=True) == Path(j["source"]).resolve(strict=True)
                   for j in prepared["junctions"])
        assert read(root / "tsconfig.test.json") == {"extends": "./source/apps/api/tsconfig.json", "files": cfg["typeFiles"], "include": []}
        assert sha(root / "tsconfig.test.json") == cfg["configSha256"]
        for row in prepared["sourceFreeze"]:
            assert sha(REPO / row["file"]) == row["sha256"], row["file"]
        for row in prepared["composedFreeze"]:
            assert sha(root / "source" / row["file"]) == row["sha256"], row["file"]
        freezes[variant] = {row["file"]: row["sha256"] for row in prepared["composedFreeze"]}
        assert len(freezes[variant]) == 1036
        assert set(freezes[variant]) - set(parent_files) == {"apps/api/test/" + LABEL + ".test.ts"}
        assert not set(parent_files) - set(freezes[variant])
        assert sorted(name for name in parent_files if parent_files[name] != freezes[variant][name]) == ([] if variant == "baseline" else [ROUTE])
        assert freezes[variant]["apps/api/test/" + LABEL + ".test.ts"] == TEST_SHA
        for row in plan["regressionFiles"]:
            assert freezes[variant]["apps/api/test/" + row["name"]] == row["sha256"]
        inputs += [artifact(prepared_path), artifact(root / "tsconfig.test.json")]
        for phase in ("resolve", "types"):
            result_path, command_path = root / "checks" / phase / "result.json", root / "checks" / phase / "command.json"
            result, command = read(result_path), read(command_path)
            assert result["passed"] is True and result["exitCode"] == 0 and result["timedOut"] is False
            assert result["drainTimedOut"] is False and result["exitObserved"] is True
            assert result["signal"] is None and result["errorCode"] is None
            assert result["database"] is False and result["tests"] is False
            assert native_utc(result["childExitedUtc"]) >= native_utc(result["startedUtc"])
            assert native_utc(result["harnessFinishedUtc"]) >= native_utc(result["childExitedUtc"])
            guard = read(root / "checks" / phase / "guard.json")
            assert guard["minimumMiB"] == 1536 and finite(guard["freeMiB"]) >= 1536
            assert guard["parentHeapMiB"] == 128 and guard["childHeapMiB"] == 640
            assert result["phase"] == command["phase"] == phase
            assert result["variant"] == command["variant"] == variant
            assert result["preparedSha256"] == command["preparedSha256"] == cfg["preparedPins"][variant]
            assert command["configSha256"] == cfg["configSha256"]
            assert Path(command["cwd"]).resolve(strict=True) == (root / "source/apps/api").resolve(strict=True)
            assert "--noEmit" in command["command"] and "--max-old-space-size=640" in command["command"]
            assert all(result["before"][key] is True and result["after"][key] is True
                       for key in ("source", "candidate", "config", "prepared", "junctions"))
            if phase == "resolve":
                assert "--listFilesOnly" in command["command"]
                assert result["resolved"] == {"requiredSourcesCount": 14, "mfaReadListed": True,
                                              "requiredSourcesListed": True, "allTestsListed": True, "originalWorkspacePaths": []}
                lines = [(line.replace("\\", "/").lower()) for line in (root / "checks/resolve/stdout.log").read_text(encoding="utf-8").splitlines()]
                for name in plan["requiredResolvedSources"] + plan["typeTests"]:
                    assert (root / "source" / name).as_posix().lower() in lines, name
                assert not any(line.startswith(REPO.as_posix().lower() + "/apps/") or line.startswith(REPO.as_posix().lower() + "/packages/")
                               for line in lines if "/node_modules/" not in line)
            else:
                assert "--extendedDiagnostics" in command["command"] and result["resolved"] is None
            for stream in ("stdout", "stderr"):
                assert sha(root / "checks" / phase / (stream + ".log")) == result[stream + "Sha256"]
                inputs.append(artifact(root / "checks" / phase / (stream + ".log")))
            inputs += [artifact(result_path), artifact(command_path), artifact(root / "checks" / phase / "guard.json")]
            type_checks.append({"variant": variant, "phase": phase, "result": artifact(result_path),
                                "startedUtc": result["startedUtc"], "childExitedUtc": result["childExitedUtc"],
                                "durationMs": finite(result["childDurationMs"])})
    assert freezes["baseline"].keys() == freezes["fixed"].keys()
    assert sorted(p for p in freezes["baseline"] if freezes["baseline"][p] != freezes["fixed"][p]) == [ROUTE]
    assert freezes["baseline"][ROUTE] == "3f0f4db1d92fdb8ed991d0e173d9aa82123f17b6376f137d7d543c60797b790b"
    assert freezes["fixed"][ROUTE] == "d660a272e2201bd8a8f68096457508ba1b5aca4d3d824e045b75724bf277ca00"

    runs, observations = [], None
    for variant in ("baseline", "fixed", "fixed-regression"):
        root = WORK / cfg["qaDirectories"][variant]
        result_path, post_path = root / "mfa-directed-result.json", root / "mfa-directed-postchecks.json"
        result, post = read(result_path), read(post_path)
        prepared_variant = "baseline" if variant == "baseline" else "fixed"
        assert result["preparedSha256"] == cfg["preparedPins"][prepared_variant]
        prepared_root = WORK / cfg["sourceDirectories"][prepared_variant]
        prepared = read(prepared_root / "prepared.json")
        assert result["sourceFiles"] == [{"path": r["file"], "sha256": r["sha256"]} for r in prepared["sourceFreeze"]]
        assert result["archivedFiles"] == [{"path": r["file"], "sha256": r["sha256"]} for r in prepared["composedFreeze"] + prepared["controlFreeze"]]
        assert result["testFiles"] == (plan["regressionFiles"] if variant == "fixed-regression" else [
            {"name": LABEL + ".test.ts", "cases": 17, "sha256": TEST_SHA}])
        assert result["frozenManifestSha256"] == sha(prepared_root / "source-pin.manifest.json")
        assert result["expectedHead"] == plan["sourceBase"]
        # This inherited native label is not a GREEN verdict for baseline.
        # The per-case TAP/diagnostic checks below decide RED versus GREEN.
        assert result["status"] == "completed-awaiting-TAP-GREEN-classification"
        assert native_utc(result["endedUtc"]) >= native_utc(result["startedUtc"])
        assert result["fixtureCleanupPassed"] is True and result["sourceHashesAfterMatch"] is True
        assert result["ownedChildrenExited"] is True and result["ownedChildrenWithoutExit"] == []
        assert result.get("cleanupHeldForOwnedProcessInspection", False) is False
        assert result.get("cleanupHeldOwnedPids", []) == []
        assert result["exitCode"] == post["exitCode"] == 0
        assert result["observedHeadBefore"] == result["observedHeadAfter"] == cfg["head"]
        assert result["runtimeUsesRestrictedConnections"] is True and result["credentialsPublished"] is False
        for key in ("systemIdentifierMatches", "rolesRestoredIncludingPrivateCredentials", "settingsRestored", "containerAttestationMatches"):
            assert post[key] is True
        for key in ("basePublicTables", "temporaryDatabases", "otherDatabases", "otherClients"):
            assert post[key] == 0
        assert post["roles"] == 6 and post["computerRestarted"] is False and post["credentialsPublished"] is False
        assert finite(post["freeMiBAtStart"]) >= 1536
        owned = read(root / "owned-database.json")
        assert owned["databaseName"] == result["databaseName"] and owned["controllerPid"] == result["controllerPid"]
        assert re.fullmatch(r"ingest_runtime_[a-f0-9]{32}", result["databaseName"])
        inputs.append(artifact(root / "owned-database.json"))
        for stage in ("provision", "seed"):
            child = result[stage]
            assert child["label"] == stage and child["exitCode"] == 0 and child["signal"] is None
            assert child["exitObserved"] is True
            assert all(child[k] is False for k in ("spawnError", "timedOut", "overflow", "treeKillFailed", "drainTimedOut"))
            assert sha(root / (stage + ".log")) == child["logSha256"]
            finite(child["elapsedMs"])
            inputs.append(artifact(root / (stage + ".log")))
        expected_labels = cfg["regressionLabels"] if variant == "fixed-regression" else [LABEL]
        assert [child["label"] for child in result["tests"]] == expected_labels
        rows = []
        for child in result["tests"]:
            assert all(child[key] is False for key in ("spawnError", "timedOut", "overflow", "treeKillFailed", "drainTimedOut"))
            assert child["exitObserved"] is True and child["signal"] is None
            log = root / (child["label"] + ".log")
            assert sha(log) == child["logSha256"]
            text = log.read_text(encoding="utf-8")
            totals = {key: summary(text, key) for key in ("tests", "suites", "pass", "fail", "cancelled", "skipped", "todo")}
            assert totals["cancelled"] == totals["skipped"] == totals["todo"] == 0
            if variant == "baseline":
                assert (totals["tests"], totals["suites"], totals["pass"], totals["fail"], child["exitCode"]) == (17, 1, 11, 6, 1)
                observations = directed_observations(text, test_manifest["caseDispositions"], True)
            else:
                count = REGRESSION[child["label"]] if variant == "fixed-regression" else 17
                assert totals["tests"] == totals["pass"] == count and totals["fail"] == child["exitCode"] == 0
                assert totals["suites"] == 1
                if variant == "fixed":
                    directed_observations(text, test_manifest["caseDispositions"], False)
            duration = re.findall(r"^# duration_ms ([\d.]+)\s*$", text, re.M)
            assert len(duration) == 1
            finite(float(duration[0]))
            rows.append({"test": child["label"], **totals, "tapDurationMs": float(duration[0]),
                         "childDurationMs": finite(child["elapsedMs"]), "logSha256": sha(log)})
            inputs.append(artifact(log))
        assert len(rows) == (9 if variant == "fixed-regression" else 1)
        assert sum(r["tests"] for r in rows) == (130 if variant == "fixed-regression" else 17)
        inputs += [artifact(result_path), artifact(post_path)]
        runs.append({"variant": variant, "tests": rows, "cleanupPassed": True, "sourceMatched": True,
                     "ownedChildrenExited": True, "cleanupHeld": False, "nativeStatus": result["status"],
                     "startedUtc": result["startedUtc"], "endedUtc": result["endedUtc"],
                     "observedHeadBefore": result["observedHeadBefore"], "observedHeadAfter": result["observedHeadAfter"]})
    assert observations is not None
    report = {"schemaVersion": 1, "status": "VERIFIED", "configSha256": sha(config_path),
              "recordedOn": cfg["recordedOn"], "recordedOnTimezone": cfg["timeZone"],
              "reviewedOn": cfg["reviewedOn"], "nativeExecutionTimestampsPreserved": True,
              "verifierSha256": sha(Path(__file__)), "reviewedByRoot": True,
              "baselineGrantFailuresReviewed": True, "sourceFiles": 1036, "typeFiles": 32,
              "requiredResolvedSources": 14, "sourceDifference": [ROUTE], "typeChecks": type_checks,
              "preparation": {"nativeResults": preparations, "isProductTestExecution": False},
              "acceptedCounts": {"directedTap": 17, "directedIndependent": 17, "directedAggregateGroups": 0,
                                 "directedSuites": 1, "regressionFiles": 9, "regressionTap": 130,
                                 "regressionIndependent": 120, "regressionAggregateGroups": 10,
                                 "combinedTap": 147, "combinedIndependent": 137, "combinedAggregateGroups": 10},
              "environment": {"attestation": attestation, "initialEnvironmentRefusalsAreNotRed": True},
              "scopeLimits": [
                  "Two POST grant routes only: unit-memberships and role-bindings. Team membership upsert, invitations, shared helpers, policies and migrations are unchanged.",
                  "Required actors use real HTTP login/enrollment/TOTP; recovery codes renew a second session and password verification in the recency scenario. No successful MFA proof is fabricated.",
                  "Four baseline failures occur after real separate memberships:manage authorization. Two occur after narrow audit triggers, one per route. Fixed rollback restores the exact original family proof timestamp text, generation and presence.",
                  "Full DTOs/defaults, optional dates/nulls, user/team recipient, scoped foreign keys, strict validation, repeated distinct grants, delegation RLS and session-specific password recency are checked.",
                  "Directed cases do not induce row-lock waits, promotion, capability-loss waits, concurrent constraints, a zero-row INSERT or generic audit-trigger exceptions. No universal commit-boundary guarantee is asserted.",
                  "The nine related regressions keep their own scenario limits; their PASS does not add unexecuted grant cases.",
                  "Owned child checks cover registered direct children; no universal census of other projects or descendants is claimed.",
                  "Native UTC timestamps are preserved. The two earlier environment refusals happened before tests and are not baseline reproductions.",
                  "No browser, Android/iOS, whole API, performance or production acceptance is asserted."
              ],
              "baselineFailureObservations": observations, "runs": runs, "inputs": inputs,
              "performanceAssessed": False, "productionAccepted": False}

    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"verification": str(output), "sha256": sha(output), "runs": runs,
                      "baselineGrantFailuresReviewed": True, "performanceAssessed": False}))


if __name__ == "__main__":
    main()
