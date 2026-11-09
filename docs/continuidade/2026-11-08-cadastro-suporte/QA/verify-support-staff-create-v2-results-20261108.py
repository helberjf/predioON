"""Verify support-staff creation evidence after root reviews actual RED; never execute tests."""
from pathlib import Path
from datetime import datetime, timedelta
import argparse
import hashlib
import json
import math
import re

WORK = Path(__file__).resolve().parent
REPO = WORK.parent / "predioON"
ROUTE = "apps/api/src/modules/support-access/routes.ts"
LABEL = "platform-mfa-support-staff-create"
TEST_SHA = "97f1122469fefeb727b8795141d89a79557aec5e3db69ea7ab1e87ad490f83ce"
TEST_MANIFEST_SHA = "34c49d8bfcf7241826ca7fd8dfc2f5ae62e0452922998b8d81cae0f9f3de9879"
PRODUCT_MANIFEST_SHA = "3e6835a662b67fc6f0e2c7a163b620cda9729f23983c9b80344e7a0b492ad79b"
PARENT_SHA = "93823355255fc582df588072800b4db99edfbc6187b7d449148b38924678634b"
# Runtime/prepared/executor pins are REQUIRED in the root-reviewed config.
# No result or unknown SHA is prefilled by this authoring-only draft.
REGRESSION = {'support-access': 4, 'platform-mfa-support-read': 14, 'platform-mfa-support-timestamp-order': 2, 'platform-mfa-admin-directory-read': 12}
DIAG_MUTATION = "Baseline201: exact support binding, unchanged account, platform audit and no building access verified before expected403 mismatch"
DIAG_REFUSAL = "Baseline{}: staff refusal leaves accounts bindings grants and audits unchanged before expected403 mismatch"
DIAG_TRIGGER = "Baseline201: staff binding and audit persisted; narrow trigger fired once and removed the same family proof"
TRIGGER_CASES = {f"{relation}: rolls staff creation and audit back after proof trigger" for relation in ("role_bindings", "audit_logs")}
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
    assert len(dispositions) == len({d["name"] for d in dispositions}) == 36
    expected_negative_names = {
        f"{kind} {state}: rejects {change} after real global authorization"
        for kind in ("flag", "binding") for state in ("new", "existing", "inactive", "missing")
        for change in ("factor removal", "family proof removal")
    } | TRIGGER_CASES
    disposition_map = {"PASS":None,"FAIL_EXPECTED_201_VERSUS_403":201,"FAIL_EXPECTED_409_VERSUS_403":409,"FAIL_EXPECTED_400_VERSUS_403":400,"FAIL_EXPECTED_404_VERSUS_403":404}
    names,observations=set(),[]
    for case in dispositions:
        assert case["baseline"] in disposition_map and case["fixed"] == "PASS"
        actual=disposition_map[case["baseline"]]
        if actual is not None:
            names.add(case["name"]);assert case["diagnostic"]=="Baseline"+str(actual)
        _,status,block=subtest(text,case["name"])
        assert status == ("not ok" if baseline and actual is not None else "ok"),case["name"]
        if baseline and actual is not None:
            for pattern in (r"failureType:\s*['\"]?testCodeFailure",r"code:\s*['\"]?ERR_ASSERTION",r"operator:\s*['\"]?strictEqual","Expected values to be strictly equal"):
                assert re.search(pattern,block),(case["name"],pattern)
            assert re.findall(r"^\s+expected:\s*(\d+)\s*$",block,re.M)==["403"]
            assert re.findall(r"^\s+actual:\s*(\d+)\s*$",block,re.M)==[str(actual)]
            assert re.search(r"\b"+str(actual)+r"\s*!==\s*403\b",block)
            if case["name"] in TRIGGER_CASES:diagnostic=DIAG_TRIGGER;boundary="narrow role_binding AFTER INSERT or audit AFTER INSERT trigger"
            elif actual==201:diagnostic=DIAG_MUTATION;boundary="after real global rbac:manage authorization before staff creation"
            else:diagnostic=DIAG_REFUSAL.format(actual);boundary="after real global rbac:manage authorization before person/duplicate lookup"
            assert block.count(diagnostic)==1
            observations.append({"case":case["name"],"actualStatus":actual,"expectedStatus":403,
              "exactPrecedingChecksDiagnostic":diagnostic,
              "expectedReasonAfterFix":"MFA_ENROLLMENT_REQUIRED" if "factor removal" in case["name"] else "MFA_VERIFICATION_REQUIRED",
              "boundary":boundary})
    assert names==expected_negative_names
    for diagnostic,count in ((DIAG_MUTATION,4),(DIAG_REFUSAL.format(409),4),(DIAG_REFUSAL.format(400),4),(DIAG_REFUSAL.format(404),4),(DIAG_TRIGGER,2)):
        assert text.count(diagnostic)==(count if baseline else 0)
    if baseline:
        assert len(observations)==18
        assert [sum(o["actualStatus"]==code for o in observations) for code in (201,409,400,404)]==[6,4,4,4]
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
    assert cfg["baselineStaffCreationFailuresReviewed"] is True, "Root must review actual RED before verification"
    assert re.fullmatch(r"[a-f0-9]{40}", cfg["head"])
    assert cfg["qaDirectories"] == {**{v:f"mfa-support-staff-create-v2-{v}-qa-20261108" for v in ("baseline","fixed")},"fixed-regression":"mfa-support-staff-create-v2-fixed-regression-qa-20261108"}
    assert cfg["sourceDirectories"] == {v:f"mfa-support-staff-create-v2-{v}-qa-20261108" for v in ("baseline","fixed")}
    assert cfg["regressionLabels"] == list(REGRESSION)
    assert len(cfg["typeFiles"]) == len(set(cfg["typeFiles"])) == 38
    assert cfg["preparedPins"] == PREPARED_PINS and cfg["configSha256"] == TYPE_CONFIG_SHA
    output = WORK / "mfa-support-staff-create-v2-root-verification-20261108.json"
    assert not output.exists(), "Preserve previous verification"
    plan_path = WORK / "mfa-support-staff-create-v2-harness-20261108/PLAN.json"
    test_manifest_path = WORK / "mfa-support-staff-create-v2-test-20261108/manifest.json"
    product_manifest_path = WORK / "mfa-support-staff-create-candidate-20261108/manifest.json"
    plan, test_manifest = read(plan_path), read(test_manifest_path)
    assert sha(plan_path) == PLAN_SHA and plan["priorPreparedSha256"] == PARENT_SHA
    assert sha(test_manifest_path) == TEST_MANIFEST_SHA == plan["testManifestSha256"]
    assert sha(product_manifest_path) == PRODUCT_MANIFEST_SHA == plan["productManifestSha256"]
    assert sha(test_manifest_path.parent / "apps/api/test" / (LABEL + ".test.ts")) == TEST_SHA == plan["testSha256"]
    assert cfg["typeFiles"] == ["./source/" + x for x in plan["typeTests"]]
    assert len(plan["requiredResolvedSources"]) == 14 and plan["sourceFiles"] == 1042
    assert (plan["directedTapPlanned"], plan["baselineExpectedPass"], plan["baselineExpectedFail"]) == (36, 18, 18)
    assert (test_manifest["independentCases"], test_manifest["parentGroups"], test_manifest["fixedExpectedPass"]) == (36, 0, 36)
    assert (plan["regressionTapPlanned"], plan["regressionIndependentCases"], plan["regressionParentGroups"]) == (32, 28, 4)
    assert {r["name"].removesuffix(".test.ts"): r["cases"] for r in plan["regressionFiles"]} == REGRESSION
    authored_path = WORK / "mfa-support-staff-create-v2-harness-20261108/AUTHORED-PINS.json"
    authored = read(authored_path)
    assert authored["product"] == plan["productAfterSha256"] and authored["test"] == TEST_SHA
    assert authored["plan"] == PLAN_SHA and authored["config"] == TYPE_CONFIG_SHA and authored["types"] == TYPE_RUNNER_SHA
    parent_path = WORK / "mfa-user-revocation-fixed-qa-20261108/prepared.json"
    assert sha(parent_path) == PARENT_SHA
    parent = read(parent_path)
    parent_files = {r["file"]: r["sha256"] for r in parent["composedFreeze"]}
    assert len(parent_files) == 1041
    freezes, type_checks = {}, []
    inputs = [artifact(config_path), artifact(plan_path), artifact(test_manifest_path), artifact(product_manifest_path), artifact(authored_path), artifact(parent_path)]
    harness = plan_path.parent
    handoff_path = harness / "executors-handoff.json"
    assert sha(handoff_path) == EXECUTORS_HANDOFF_SHA
    handoff = read(handoff_path)
    assert handoff["preparedPins"] == PREPARED_PINS and handoff["configSha256"] == TYPE_CONFIG_SHA
    assert handoff["typeTests"] == 38 and handoff["requiredSources"] == 14 and handoff["sourceFiles"] == 1042
    assert handoff["processLifecycleModified"] is False and handoff["requiresAlreadyRunningAttestedCluster"] is True
    assert handoff["clusterStartRestartCommandsAdded"] is False and handoff["computerRestarted"] is False
    assert sha(harness / "run-types.mjs") == TYPE_RUNNER_SHA
    assert len(handoff["executors"]) == 6
    for row in handoff["executors"]:
        assert sha(WORK / row["path"]) == row["sha256"]
        inputs.append(artifact(WORK / row["path"]))
    attestation_path = WORK / handoff["clusterAttestation"]
    assert sha(attestation_path) == handoff["clusterAttestationSha256"] == "9d43fe8e98ce5e11a26e7e943fb465a96f24a4c14368bbdab5712e5282cb426e"
    attestation = read(attestation_path)
    assert attestation["containerId"] == "3c0f4e5e47d3d488766eb2679ba97fabf29b12d72f9b8df41bb504205a41b4c8"
    assert attestation["systemIdentifier"] == "7705939420428193833"
    assert {row["path"] for row in handoff["executors"]} == {f"{cfg['qaDirectories'][v]}/{name}" for v in cfg['qaDirectories'] for name in ("run-mfa-directed.mjs","launch-mfa-directed.ps1")}
    inputs += [artifact(handoff_path), artifact(attestation_path), artifact(harness / "run-types.mjs")]

    preparations = []
    for variant in ("baseline", "fixed"):
        native_path = harness / f"{variant}-prepare-result.json"
        native, guard = read(native_path), read(harness / f"{variant}-prepare-guard.json")
        prepared_output = read(harness / f"{variant}-prepare.stdout.txt")
        assert native["exitCode"] == 0 and native["timedOut"] is False and native["heapMiB"] == 256
        assert guard["minimumMiB"] == 1536 and finite(guard["freeMiB"]) >= 1536
        native_utc(native["childExitedAt"])
        assert prepared_output["variant"] == variant and prepared_output["status"] == "prepared-only"
        assert prepared_output["rootFiles"] == 994 and prepared_output["candidateFiles"] == 1042
        assert prepared_output["apiTypeTests"] == 38 and prepared_output["preparedSha256"] == PREPARED_PINS[variant]
        preparations.append({"variant": variant, "nativeChildExitedUtc": native["childExitedAt"],
                             "durationMs": finite(native["durationMs"]), "nativeResult": artifact(native_path)})
        inputs += [artifact(harness / f"{variant}-prepare{s}") for s in ("-result.json", "-guard.json", ".stdout.txt", ".stderr.txt")]
    for variant in ("baseline", "fixed"):
        root = WORK / cfg["sourceDirectories"][variant]
        prepared_path = root / "prepared.json"
        assert sha(prepared_path) == cfg["preparedPins"][variant]
        prepared = read(prepared_path)
        assert prepared["variant"] == variant and len(prepared["sourceFreeze"]) == 994
        assert len(prepared["composedFreeze"]) == 1042
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
        assert len(freezes[variant]) == 1042
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
    assert freezes["baseline"][ROUTE] == "4178deab935e6241a63c32bf59fe66add1d921598e5ac19cdf1c26979795cd0f"
    assert freezes["fixed"][ROUTE] == "4d718ecad31a0c16573c099fb4c2a9073587c3ac26542d592686d995c52c7498"

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
            {"name": LABEL + ".test.ts", "cases": 36, "sha256": TEST_SHA}])
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
                assert (totals["tests"], totals["suites"], totals["pass"], totals["fail"], child["exitCode"]) == (36, 1, 18, 18, 1)
                observations = directed_observations(text, test_manifest["caseDispositions"], True)
            else:
                count = REGRESSION[child["label"]] if variant == "fixed-regression" else 36
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
        assert len(rows) == (4 if variant == "fixed-regression" else 1)
        assert sum(r["tests"] for r in rows) == (32 if variant == "fixed-regression" else 36)
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
              "baselineStaffCreationFailuresReviewed": True, "sourceFiles": 1042, "typeFiles": 38,
              "requiredResolvedSources": 14, "sourceDifference": [ROUTE], "typeChecks": type_checks,
              "preparation": {"nativeResults": preparations, "isProductTestExecution": False},
              "acceptedCounts": {"directedTap": 36, "directedIndependent": 36, "directedAggregateGroups": 0,
                                 "directedSuites": 1, "regressionFiles": 4, "regressionTap": 32,
                                 "regressionIndependent": 28, "regressionAggregateGroups": 4,
                                 "combinedTap": 68, "combinedIndependent": 64, "combinedAggregateGroups": 4},
              "environment": {"attestation": attestation},
              "scopeLimits": [
                  "Only POST /v1/support-access/staff changes: person and duplicate reads, INSERT and final MFA decision after audit. DELETE staff, grants, shared revoke helper, schemas, policies and migrations remain unchanged.",
                  "Direct cases enroll flag/global-binding administrators via real HTTP/TOTP in the same session family. No positive factor/proof in these36 cases is fabricated by SQL.",
                  "Baseline expects six201, four409, four400 and four404 versus403. Successful writes verify exact binding, unchanged target account, platform audit and absence of building access. Refusal paths verify unchanged data, not an unauthorized write.",
                  "Sixteen cases pause after the actual parameterized global rbac:manage capability returned true. These controlled interleavings do not prove an actual PostgreSQL lock wait or simultaneous first staff insert safety.",
                  "Eight positive combinations cover flag/global-binding authorities and new/revoked/local/self staff; identity and any historical binding are preserved. Staff designation alone adds no building grant.",
                  "Recent-password expiration/refusal and real HTTP recovery, strict schema, duplicate active/expired binding, inactive/missing account, local/resident refusal, authentication and hidden-person404 after global binding withdrawal preserve the exercised contracts.",
                  "Two proof-removing AFTER INSERT triggers on role_bindings and audit_logs fire once; fixed rollback restores exact accounts/bindings/grants/audit and original proof timestamp text/generation/presence.",
                  "Two narrow generic exception triggers and one BEFORE INSERT skip preserve data and proof; opaque500 remains. These scoped fixtures do not cover every possible database exception.",
                  "All guards remain1536MiB. Four related regression files total32 TAP with28 independent cases and4 aggregate groups. Historical read fixtures using direct SQL factor/proof retain that limitation; new36 direct cases use real TOTP.",
                  "Staff removal, grant replacement/revocation, features and remaining domains, promotions/concurrency, cache policy, full API/browser/native Android/iOS, performance and production acceptance remain pending."
],
              "baselineFailureObservations": observations, "runs": runs, "inputs": inputs,
              "performanceAssessed": False, "productionAccepted": False}

    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"verification": str(output), "sha256": sha(output), "runs": runs,
                      "baselineStaffCreationFailuresReviewed": True, "performanceAssessed": False}))


if __name__ == "__main__":
    main()
