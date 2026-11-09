from pathlib import Path
import hashlib,json,runpy,subprocess,re
w=Path(__file__).resolve().parent;repo=w.parent/'predioON';root=w/'mfa-feature-transition-v3-fixed-qa-20261109';h=w/'mfa-feature-transition-v3-harness-20261109';parent=w/'mfa-feature-lifecycle-fixed-qa-20261109';fixture=w/'mfa-feature-transition-v2-test-20261109'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();read=lambda p:json.loads(p.read_bytes());inputs=[]
def artifact(p):
 p=p.resolve(strict=True);assert p.is_relative_to(w.resolve());row={'id':p.relative_to(w).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size};inputs.append(row);return row
out=w/'mfa-feature-transition-root-verification-20261109.json';assert not out.exists()
plan=read(h/'PLAN.json');pins=read(h/'AUTHORED-PINS.json');handoff=read(h/'executors-handoff.json');manifest=read(fixture/'manifest.json');p=read(root/'prepared.json');prior=read(parent/'prepared.json')
assert sha(h/'PLAN.json')==pins['plan']=='f4c4ac19fc092a737759986dddf9132376fa69abfc39aa761ea5f1a4872b38b7'
assert sha(h/'executors-handoff.json')=='2d01de9c18457cea3bd27c34b23c45d95a1e0196c67dfbc849e308b937054704'
assert sha(root/'prepared.json')==handoff['preparedSha256']=='31fecc8ed939cb832769132ba4de417280c5f5cd38d8cbb64127d397f2cbe2e6'
assert sha(parent/'prepared.json')==plan['priorPreparedSha256']==p['priorPreparedSha256']=='3a5f530aadbea9a098f9c27f841d8f67773b0184941fc72430809f8aabb5e786'
assert sha(fixture/'manifest.json')==plan['testManifestSha256'];assert not manifest['runtimeProductModified'] and not manifest['existingTestsChanged'] and manifest['positiveProofThroughRealHttp']
assert sha(root/'source'/plan['testFile'])==pins['test']==plan['testSha256']=='8c6782b315ec6c31bc30677a3a34a595f1cf2f30b1c6ec39397b41606f823a24'
assert not (parent/'source'/plan['testFile']).exists()
for tree,freeze in [(repo,p['sourceFreeze']),(root/'source',p['composedFreeze']),(parent/'source',prior['composedFreeze'])]:
 for row in freeze:assert sha(tree/row['file'])==row['sha256'],row['file']
before={x['file']:x['sha256'] for x in prior['composedFreeze']};after={x['file']:x['sha256'] for x in p['composedFreeze']}
assert len(before)==1045 and len(after)==1046 and set(after)-set(before)=={plan['testFile']} and set(before).issubset(after);assert all(before[f]==after[f] for f in before)
assert len(p['sourceFreeze'])==994 and p['controlFreeze']==[] and p['excludedJunctions']==[] and len(p['inheritedExcludedJunctions'])==7
assert [sum(j['workspace']==x for j in p['junctions']) for x in [True,False]]==[23,134]
for j in p['junctions']:
 assert Path(j['source']).resolve(strict=True)==Path(j['target']).resolve(strict=True)
 if j['workspace']:assert Path(j['target']).resolve(strict=True).is_relative_to((root/'source').resolve())
assert len(plan['typeTests'])==len(set(plan['typeTests']))==43 and p['apiTypeTests']==plan['typeTests'] and len(plan['requiredResolvedSources'])==14
assert read(root/'tsconfig.test.json')=={'extends':'./source/apps/api/tsconfig.json','files':['./source/'+f for f in plan['typeTests']],'include':[]}
assert sha(root/'tsconfig.test.json')==pins['config']==handoff['configSha256']=='eaa62868672a663388736c707f4659a72bc943a2b22e6145d275bf80d69132b8'
for name,key in [('prepare-feature-transition.mjs','prepare'),('run-types.mjs','types'),('fixed-recipe.json','recipe')]:assert sha(h/name)==pins[key];artifact(h/name)
prep=read(h/'fixed-prepare-result.json');guard=read(h/'fixed-prepare-guard.json');assert prep['exitCode']==0 and not prep['timedOut'] and prep['heapMiB']==256 and guard['minimumMiB']==1536 and guard['freeMiB']>=1536
for suffix in ['result.json','guard.json','stdout.txt','stderr.txt']:artifact(h/('fixed-prepare.'+suffix) if suffix.endswith('txt') else h/('fixed-prepare-'+suffix))
type_checks=[]
for phase in ['resolve','types']:
 base=root/'checks'/phase;r=read(base/'result.json');cmd=read(base/'command.json');g=read(base/'guard.json')
 assert r['phase']==phase and r['variant']=='fixed' and r['passed'] and r['exitObserved'] and not r['timedOut'] and not r['drainTimedOut'];assert r['exitCode']==0 and r['signal'] is None and r['errorCode'] is None
 assert not r['tests'] and not r['database'] and r['preparedSha256']==sha(root/'prepared.json')==cmd['preparedSha256'];assert cmd['configSha256']==sha(root/'tsconfig.test.json')
 assert all(r[stage][key] for stage in ['before','after'] for key in ['source','candidate','config','prepared','junctions'])
 assert g['minimumMiB']==1536 and g['freeMiB']>=1536 and g['parentHeapMiB']==128 and g['childHeapMiB']==640
 if phase=='resolve':
  assert r['resolved']=={'requiredSourcesCount':14,'mfaReadListed':True,'requiredSourcesListed':True,'allTestsListed':True,'originalWorkspacePaths':[]}
  lines=[x.replace('\\','/').lower() for x in (base/'stdout.log').read_text(encoding='utf-8').splitlines()]
  for f in plan['typeTests']+plan['requiredResolvedSources']:assert (root/'source'/f).as_posix().lower() in lines
 for stream in ['stdout','stderr']:assert sha(base/(stream+'.log'))==r[stream+'Sha256'];artifact(base/(stream+'.log'))
 type_checks.append({'phase':phase,'result':artifact(base/'result.json'),'startedUtc':r['startedUtc'],'childExitedUtc':r['childExitedUtc']});artifact(base/'command.json');artifact(base/'guard.json')
assert len(handoff['executors'])==3 and not handoff['runtimeProductModified'] and not handoff['processLifecycleModified'] and handoff['requiresAlreadyRunningAttestedCluster']
for row in handoff['executors']:assert sha(w/row['path'])==row['sha256'];artifact(w/row['path'])
attestation=read(w/handoff['clusterAttestation']);assert sha(w/handoff['clusterAttestation'])==handoff['clusterAttestationSha256']=='9d43fe8e98ce5e11a26e7e943fb465a96f24a4c14368bbdab5712e5282cb426e';artifact(w/handoff['clusterAttestation'])
assert attestation['containerId']=='3c0f4e5e47d3d488766eb2679ba97fabf29b12d72f9b8df41bb504205a41b4c8' and attestation['systemIdentifier']=='7705939420428193833'
r=read(root/'mfa-directed-result.json');post=read(root/'mfa-directed-postchecks.json');head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
assert r['observedHeadBefore']==r['observedHeadAfter']==head and r['expectedHead']==plan['sourceBase'];assert r['status']=='completed-awaiting-TAP-GREEN-classification' and r['exitCode']==post['exitCode']==0
assert r['sourceFiles']==[{'path':x['file'],'sha256':x['sha256']} for x in p['sourceFreeze']];assert r['archivedFiles']==[{'path':x['file'],'sha256':x['sha256']} for x in p['composedFreeze']]
assert r['preparedSha256']==sha(root/'prepared.json') and r['frozenManifestSha256']==sha(root/'source-pin.manifest.json');assert r['testFiles']==[{'name':'platform-mfa-feature-transition-rollback.test.ts','cases':32,'sha256':plan['testSha256']}]
assert all(r[k] for k in ['fixtureCleanupPassed','sourceHashesAfterMatch','ownedChildrenExited','runtimeUsesRestrictedConnections']);assert r['ownedChildrenWithoutExit']==[] and not r.get('cleanupHeldForOwnedProcessInspection',False) and not r.get('cleanupHeldOwnedPids',[]) and not r['credentialsPublished']
assert all(post[k] for k in ['systemIdentifierMatches','rolesRestoredIncludingPrivateCredentials','settingsRestored','containerAttestationMatches']);assert all(post[k]==0 for k in ['basePublicTables','temporaryDatabases','otherDatabases','otherClients']);assert post['roles']==6 and post['freeMiBAtStart']>=1536 and not post['computerRestarted'] and not post['credentialsPublished']
owned=read(root/'owned-database.json');assert owned['databaseName']==r['databaseName'] and owned['controllerPid']==r['controllerPid'] and re.fullmatch(r'ingest_runtime_[a-f0-9]{32}',r['databaseName'])
assert len(r['tests'])==1 and r['tests'][0]['label']=='platform-mfa-feature-transition-rollback'
for child in [r['provision'],r['seed'],*r['tests']]:
 assert child['exitCode']==0 and child['signal'] is None and child['exitObserved'];assert not any(child[k] for k in ['spawnError','timedOut','overflow','treeKillFailed','drainTimedOut'])
 logfile=root/(child['label']+'.log');assert sha(logfile)==child['logSha256'];artifact(logfile)
parsers=runpy.run_path(str(w/'verify-feature-commands-v2-results-20261109.py'));text=(root/'platform-mfa-feature-transition-rollback.log').read_text(encoding='utf-8');totals={k:parsers['summary'](text,k) for k in ['tests','suites','pass','fail','cancelled','skipped','todo']};assert totals=={'tests':32,'suites':1,'pass':32,'fail':0,'cancelled':0,'skipped':0,'todo':0}
for name in manifest['cases']:assert parsers['subtest'](text,name)[1]=='ok',name
awake=read(root/'awake-guard.json');assert awake['exitCode']==0 and awake['systemRequiredSet'] and awake['systemRequiredCleared'];assert not any(awake[k] for k in ['displayRequired','awayMode','permanentPowerSettingsChanged','computerRestarted'])
for f in [h/'PLAN.json',h/'AUTHORED-PINS.json',h/'executors-handoff.json',fixture/'manifest.json',root/'prepared.json',parent/'prepared.json',root/'tsconfig.test.json',root/'mfa-directed-result.json',root/'mfa-directed-postchecks.json',root/'owned-database.json',root/'awake-guard.json']:artifact(f)
history=read(w/'mfa-feature-transition-v2-review-20261109.json')
assert history['totals']['fail']==32 and history['totals']['pass']==0 and history['featureRequestsReached']==0 and history['runtimeProductUnchanged'] and history['testAssertionsAndTimeoutsUnchanged']
assert history['newTestSha256']==plan['testSha256'] and history['cleanupPassed'] and not history['functionalAccepted']
for row in history['inputs']:
 f=w/row['id'];assert sha(f)==row['sha256'] and f.stat().st_size==row['bytes']
artifact(w/'mfa-feature-transition-v2-review-20261109.json');artifact(w/'mfa-feature-transition-v1-review-20261109.json')
report={'recordedOn':'2026-11-09','timeZone':'America/Sao_Paulo','status':'VERIFIED','verifierSha256':sha(Path(__file__)),'reviewedByRoot':True,'sourceFiles':1046,'typeFiles':43,'requiredResolvedSources':14,'runtimeProductModified':False,'existingTestsChanged':False,'changedSources':[plan['testFile']],'parentPreparedSha256':sha(parent/'prepared.json'),'preparedSha256':sha(root/'prepared.json'),'observedHead':head,'acceptedCounts':{'tap':32,'independentCases':32,'parentGroups':0,'suites':1},'totals':totals,'cases':manifest['cases'],'typeChecks':type_checks,'startedUtc':r['startedUtc'],'endedUtc':r['endedUtc'],'freeMiBAtStart':post['freeMiBAtStart'],'cleanupPassed':True,'temporarySystemActivityGuard':awake,'inputs':inputs,
 'scopeLimits':['One new 32-case test file only. All 1045 parent sources, runtime product and existing tests are byte-for-byte unchanged.', 'Real HTTP login/enrollment/TOTP; same bearer/SID. Global binding without platform flag for authority withdrawal; fictitious actors only.', 'Two scopes, four real effects and four failure modes. Narrow AFTER triggers and sequence witnesses prove actual cursor deletion, daily update, gate cancellation and durable delivery cancellation before complete rollback.', 'All rows in 14 business/audit/outbox tables, all tenants and the actor proof/factor/recovery/global binding are compared; transactional NOTIFY absence is fenced by a committed listener barrier.', 'This tests transactional rollback inside the helper, not separate-client races, hardware/dispatch, external webhooks, browsers, apps or performance. No new RED/GREEN product change.', 'V1 type-runner pin typo and V2 fixture TTL failure are preserved separately. V3 only uses the same statement timestamp for fixture creation/expiry, preserving every assertion and timeout.', 'Earlier eight lifecycle and 117 independent configuration results retain their own source/run evidence; no combined current-run count. MFA068 remains candidate, runtime main001-067. Remaining plan and production acceptance pending.'],'computerRestarted':False,'performanceAssessed':False,'productionAccepted':False}
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');print(json.dumps({'proof':sha(out),'verifier':sha(Path(__file__)),'totals':totals,'head':head}))
