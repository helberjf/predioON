"""Verify feature command evidence after root reviews actual RED; never execute tests."""
from pathlib import Path
from datetime import datetime, timedelta
import argparse
import hashlib
import json
import math
import re

WORK = Path(__file__).resolve().parent
REPO = WORK.parent / "predioON"
ROUTE = "apps/api/src/modules/features/routes.ts"
LABEL = "platform-mfa-feature-commands"
TEST_SHA = "db5cb5058fcb16be1b5f404c6db029c82c50f2600f50c45b1da4f5ee9f7a400c"
TEST_MANIFEST_SHA = "4b3faf8f79e37974afb34a4376049dd1bb19881f4e13922b3fa7eeca539fb2bb"
PRODUCT_MANIFEST_SHA = "45d4b536782a1514f0e1f3de2f26c29ff14ac26f67c41020708e32ceb98fe8e4"
PARENT_SHA = "bc7fdd7f2cff325d14a5c7fc59ffcdd9fa97fd55cfd02144b049fa2b68d3ebc0"
# Runtime/prepared/executor pins are REQUIRED in the root-reviewed config.
# No result or unknown SHA is prefilled by this authoring-only draft.
REGRESSION = {'features-config': 6, 'building-feature-capabilities': 13, 'platform-mfa-features-read': 22, 'platform-mfa-feature-events': 7}
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
    from collections import Counter
    assert len(dispositions) == len({d['name'] for d in dispositions}) == 72
    observations=[];diagnostics=Counter();failed=[]
    for case in dispositions:
        assert case['fixed']=='PASS'
        match=re.fullmatch(r'FAIL_EXPECTED_(200|409)_VERSUS_(403|500)',case['baseline'])
        assert case['baseline']=='PASS' or match
        _,status,block=subtest(text,case['name'])
        assert status==('not ok' if baseline and match else 'ok'),case['name']
        if not match:continue
        actual,expected=map(int,match.groups());name=case['name'];failed.append(name)
        assert case['diagnostic']=='Baseline'+str(actual)
        if 'skipped settings insert' in name:
            diagnostic='Baseline200: zero actual settings writes yet false audit and notification committed'
        elif 'after proof trigger' in name:
            diagnostic='Baseline200: real trigger withdrew proof; command effects and notification committed'
        elif 'actual database wait' in name:
            diagnostic='Baseline200: actual owner lock wait and exact committed effects verified'
        elif 'transactional NOTIFY' in name:
            diagnostic='Baseline200: real NOTIFY queued then committed with exact command effects'
        elif actual==409:
            diagnostic='Baseline409: stale conflict exposed after proof loss; exact effects unchanged'
        else:
            diagnostic='Baseline200: exact settings transitions parking audit DTO and committed notification verified'
        diagnostics[diagnostic]+=1
        if baseline:
            for pattern in (r"failureType:\s*['\"]?testCodeFailure",r"code:\s*['\"]?ERR_ASSERTION",r"operator:\s*['\"]?strictEqual",'Expected values to be strictly equal'):
                assert re.search(pattern,block),(name,pattern)
            assert re.findall(r'^\s+expected:\s*(\d+)\s*$',block,re.M)==[str(expected)],name
            assert re.findall(r'^\s+actual:\s*(\d+)\s*$',block,re.M)==[str(actual)],name
            assert re.search(r'\b'+str(actual)+r'\s*!==\s*'+str(expected)+r'\b',block),name
            assert block.count(diagnostic)==1,(name,diagnostic)
            observations.append({'case':name,'actualStatus':actual,'expectedStatus':expected,'exactPrecedingChecksDiagnostic':diagnostic})
    assert len(failed)==45
    assert sum('real authorization' in n for n in failed)==16
    assert sum('actual database wait' in n for n in failed)==16
    assert sum('transactional NOTIFY' in n for n in failed)==4
    assert sum('after proof trigger' in n for n in failed)==8
    assert sum('skipped settings insert' in n for n in failed)==1
    for diagnostic,count in diagnostics.items():assert text.count(diagnostic)==(count if baseline else 0),(diagnostic,count)
    if baseline:
        assert len(observations)==45
        assert Counter((o['actualStatus'],o['expectedStatus']) for o in observations)=={(200,403):36,(409,403):8,(200,500):1}
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
    assert cfg["baselineFeatureCommandFailuresReviewed"] is True, "Root must review actual RED before verification"
    assert re.fullmatch(r"[a-f0-9]{40}", cfg["head"])
    assert cfg["qaDirectories"] == {**{v:f"mfa-feature-commands-v2-{v}-qa-20261109" for v in ("baseline","fixed")},"fixed-regression":"mfa-feature-commands-v2-fixed-regression-qa-20261109"}
    assert cfg["sourceDirectories"] == {v:f"mfa-feature-commands-v2-{v}-qa-20261109" for v in ("baseline","fixed")}
    assert cfg["regressionLabels"] == list(REGRESSION)
    assert len(cfg["typeFiles"]) == len(set(cfg["typeFiles"])) == 41
    assert cfg["preparedPins"] == PREPARED_PINS and cfg["configSha256"] == TYPE_CONFIG_SHA
    output = WORK / "mfa-feature-commands-v2-root-verification-20261109.json"
    assert not output.exists(), "Preserve previous verification"
    plan_path = WORK / "mfa-feature-commands-v2-harness-20261109/PLAN.json"
    test_manifest_path = WORK / "mfa-feature-commands-v2-test-20261109/manifest.json"
    product_manifest_path = WORK / "mfa-feature-commands-candidate-20261109/manifest.json"
    plan, test_manifest = read(plan_path), read(test_manifest_path)
    assert sha(plan_path) == PLAN_SHA and plan["priorPreparedSha256"] == PARENT_SHA
    assert sha(test_manifest_path) == TEST_MANIFEST_SHA == plan["testManifestSha256"]
    assert sha(product_manifest_path) == PRODUCT_MANIFEST_SHA == plan["productManifestSha256"]
    assert sha(test_manifest_path.parent / "apps/api/test" / (LABEL + ".test.ts")) == TEST_SHA == plan["testSha256"]
    assert cfg["typeFiles"] == ["./source/" + x for x in plan["typeTests"]]
    assert len(plan["requiredResolvedSources"]) == 14 and plan["sourceFiles"] == 1045
    assert (plan["directedTapPlanned"], plan["baselineExpectedPass"], plan["baselineExpectedFail"]) == (72, 27, 45)
    assert (test_manifest["independentCases"], test_manifest["parentGroups"], test_manifest["fixedExpectedPass"]) == (72, 0, 72)
    assert (plan["regressionTapPlanned"], plan["regressionIndependentCases"], plan["regressionParentGroups"]) == (48, 45, 3)
    assert {r["name"].removesuffix(".test.ts"): r["cases"] for r in plan["regressionFiles"]} == REGRESSION
    authored_path = WORK / "mfa-feature-commands-v2-harness-20261109/AUTHORED-PINS.json"
    authored = read(authored_path)
    assert authored["product"] == plan["productAfterSha256"] and authored["test"] == TEST_SHA
    assert authored["plan"] == PLAN_SHA and authored["config"] == TYPE_CONFIG_SHA and authored["types"] == TYPE_RUNNER_SHA
    parent_path = WORK / "mfa-support-grant-commands-v2-fixed-qa-20261109/prepared.json"
    assert sha(parent_path) == PARENT_SHA
    parent = read(parent_path)
    parent_files = {r["file"]: r["sha256"] for r in parent["composedFreeze"]}
    assert len(parent_files) == 1044
    freezes, type_checks = {}, []
    inputs = [artifact(config_path), artifact(plan_path), artifact(test_manifest_path), artifact(product_manifest_path), artifact(authored_path), artifact(parent_path)]
    harness = plan_path.parent
    handoff_path = harness / "executors-handoff.json"
    assert sha(handoff_path) == EXECUTORS_HANDOFF_SHA
    handoff = read(handoff_path)
    assert handoff["preparedPins"] == PREPARED_PINS and handoff["configSha256"] == TYPE_CONFIG_SHA
    assert handoff["typeTests"] == 41 and handoff["requiredSources"] == 14 and handoff["sourceFiles"] == 1045
    assert handoff["processLifecycleModified"] is False and handoff["requiresAlreadyRunningAttestedCluster"] is True
    assert handoff["clusterStartRestartCommandsAdded"] is False and handoff["computerRestarted"] is False
    assert sha(harness / "run-types.mjs") == TYPE_RUNNER_SHA
    assert len(handoff["executors"]) == 9
    for row in handoff["executors"]:
        assert sha(WORK / row["path"]) == row["sha256"]
        inputs.append(artifact(WORK / row["path"]))
    attestation_path = WORK / handoff["clusterAttestation"]
    assert sha(attestation_path) == handoff["clusterAttestationSha256"] == "9d43fe8e98ce5e11a26e7e943fb465a96f24a4c14368bbdab5712e5282cb426e"
    attestation = read(attestation_path)
    assert attestation["containerId"] == "3c0f4e5e47d3d488766eb2679ba97fabf29b12d72f9b8df41bb504205a41b4c8"
    assert attestation["systemIdentifier"] == "7705939420428193833"
    assert {row["path"] for row in handoff["executors"]} == {f"{cfg['qaDirectories'][v]}/{name}" for v in cfg['qaDirectories'] for name in ("run-mfa-directed.mjs","launch-mfa-directed.ps1")} | {f"run-feature-v2-{v}-awake-20261109.ps1" for v in cfg["qaDirectories"]}
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
        assert prepared_output["rootFiles"] == 994 and prepared_output["candidateFiles"] == 1045
        assert prepared_output["apiTypeTests"] == 41 and prepared_output["preparedSha256"] == PREPARED_PINS[variant]
        preparations.append({"variant": variant, "nativeChildExitedUtc": native["childExitedAt"],
                             "durationMs": finite(native["durationMs"]), "nativeResult": artifact(native_path)})
        inputs += [artifact(harness / f"{variant}-prepare{s}") for s in ("-result.json", "-guard.json", ".stdout.txt", ".stderr.txt")]
    for variant in ("baseline", "fixed"):
        root = WORK / cfg["sourceDirectories"][variant]
        prepared_path = root / "prepared.json"
        assert sha(prepared_path) == cfg["preparedPins"][variant]
        prepared = read(prepared_path)
        assert prepared["variant"] == variant and len(prepared["sourceFreeze"]) == 994
        assert len(prepared["composedFreeze"]) == 1045
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
        assert len(freezes[variant]) == 1045
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
    assert freezes["baseline"][ROUTE] == "d37a9cc3caaab826cde759da83efd107e7de8a2c9343fc887526031fdb591141"
    assert freezes["fixed"][ROUTE] == "fe7056b9ce50aa7891147ee8f47d5b63fe73308262f701c5af0340efeabae972"

    runs, observations = [], None
    for variant in ("baseline", "fixed", "fixed-regression"):
        root = WORK / cfg["qaDirectories"][variant]
        result_path, post_path = root / "mfa-directed-result.json", root / "mfa-directed-postchecks.json"
        result, post = read(result_path), read(post_path)
        awake_path=root/"awake-guard.json";awake=read(awake_path)
        assert awake['exitCode']==0 and awake['systemRequiredSet'] and awake['systemRequiredCleared']
        assert not any(awake[k] for k in ('displayRequired','awayMode','permanentPowerSettingsChanged','computerRestarted'))
        assert native_utc(awake['endedUtc'])>=native_utc(awake['startedUtc'])
        inputs.append(artifact(awake_path))
        prepared_variant = "baseline" if variant == "baseline" else "fixed"
        assert result["preparedSha256"] == cfg["preparedPins"][prepared_variant]
        prepared_root = WORK / cfg["sourceDirectories"][prepared_variant]
        prepared = read(prepared_root / "prepared.json")
        assert result["sourceFiles"] == [{"path": r["file"], "sha256": r["sha256"]} for r in prepared["sourceFreeze"]]
        assert result["archivedFiles"] == [{"path": r["file"], "sha256": r["sha256"]} for r in prepared["composedFreeze"] + prepared["controlFreeze"]]
        assert result["testFiles"] == (plan["regressionFiles"] if variant == "fixed-regression" else [
            {"name": LABEL + ".test.ts", "cases": 72, "sha256": TEST_SHA}])
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
                assert (totals["tests"], totals["suites"], totals["pass"], totals["fail"], child["exitCode"]) == (72, 1, 27, 45, 1)
                observations = directed_observations(text, test_manifest["caseDispositions"], True)
            else:
                count = REGRESSION[child["label"]] if variant == "fixed-regression" else 72
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
        assert sum(r["tests"] for r in rows) == (48 if variant == "fixed-regression" else 72)
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
              "baselineFeatureCommandFailuresReviewed": True, "sourceFiles": 1045, "typeFiles": 41,
              "requiredResolvedSources": 14, "sourceDifference": [ROUTE], "typeChecks": type_checks,
              "preparation": {"nativeResults": preparations, "isProductTestExecution": False},
              "acceptedCounts": {'directedTap': 72, 'directedIndependent': 72, 'directedAggregateGroups': 0, 'directedSuites': 1, 'regressionFiles': 4, 'regressionTap': 48, 'regressionIndependent': 45, 'regressionAggregateGroups': 3, 'combinedTap': 120, 'combinedIndependent': 117, 'combinedAggregateGroups': 3},
              "environment": {"attestation": attestation},
              "scopeLimits": ['Feature configuration global/local PUT commands only; the existing building read projection is extracted unchanged and reused. Schemas, policies, SQL transition helper and migrations unchanged.', 'Same advisory lock, optimistic versions, inheritance/dependencies, timestamps and transaction. Upsert is MFA/capability guarded; real row waits and VOLATILE transition returns require fresh checks; audit and NOTIFY are rolled back with the command.', 'V2 restores the full permission catalog row including created_at; V1 review is separate. All72 new cases use raw HTTP login, enrollment and TOTP for positive proof in the same SID; SQL fixtures supply only data and explicit negative identity/catalog/trigger changes.', 'Baseline45 expected failures:36 status200 versus403,8 conflict409 versus403,1 local zero-row200 versus500. Every baseline failure requires its exact preceding state/audit/notification diagnostic.', '16 actual restricted connection waits on owner advisory or row locks, with pg_stat_clear_snapshot polling and identity removal committed with release. Four late-NOTIFY cases prove rollback cancels queued delivery using a committed listener barrier.', 'Eight proof-removing triggers and eight exceptions, exact row/proof restoration, sequence witnesses and trigger catalog equality; two skipped inserts reject false success/audit/notification.', 'Eight positive cases cover flag/global binding, global/local first insertion, disable/reenable/inheritance, exact24-item/eight-field projection, every affected building and dependency, parking invalidation, versions and audit metadata. Additional role refusals, concurrency and validation checks are separate.', 'Four unchanged regressions:48 TAP,45 independent cases and3 parent groups. Historical read/event fixtures retain explicit synthetic-SQL proof limitations. Full feature lifecycle/ingest suite not run in this batch.', 'Temporary Windows system activity requests set and cleared for each functional run, with unchanged timeouts and memory guards. No permanent power settings or restart.', 'Mandatory MFA068 remains candidate; runtime main001-067 unchanged. Other domains, cache, full API/ingest, browser/native Android/iOS, performance, operations and final presentation remain pending.'],
              "baselineFailureObservations": observations, "runs": runs, "inputs": inputs,
              "performanceAssessed": False, "productionAccepted": False}

    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"verification": str(output), "sha256": sha(output), "runs": runs,
                      "baselineFeatureCommandFailuresReviewed": True, "performanceAssessed": False}))


if __name__ == "__main__":
    main()
