from pathlib import Path
import hashlib,json,runpy,subprocess,re
w=Path(__file__).resolve().parent;repo=w.parent/'predioON';root=w/'mfa-feature-lifecycle-fixed-qa-20261109';h=w/'mfa-feature-lifecycle-harness-20261109';parent=w/'mfa-feature-commands-v2-fixed-qa-20261109';fixture=w/'mfa-feature-lifecycle-test-20261109'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();read=lambda p:json.loads(p.read_bytes());inputs=[]
def artifact(p):
 p=p.resolve(strict=True);assert p.is_relative_to(w.resolve());row={'id':p.relative_to(w).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size};inputs.append(row);return row
out=w/'mfa-feature-lifecycle-root-verification-20261109.json';assert not out.exists()
plan=read(h/'PLAN.json');pins=read(h/'AUTHORED-PINS.json');handoff=read(h/'executors-handoff.json');manifest=read(fixture/'manifest.json');p=read(root/'prepared.json');prior=read(parent/'prepared.json')
assert sha(h/'PLAN.json')==pins['plan']=='f233dbe446cd8650a214edf635887e9aae02e28a83e817122b85ff92d517175a'
assert sha(h/'executors-handoff.json')=='bec504543787510182ecbebed9fb98f71af064ddc9d77ad66c0fd7170e2501a8'
assert sha(root/'prepared.json')==handoff['preparedSha256']=='3a5f530aadbea9a098f9c27f841d8f67773b0184941fc72430809f8aabb5e786'
assert sha(parent/'prepared.json')==plan['priorPreparedSha256']==p['priorPreparedSha256']=='c0d7479ab81c04667e1ed75e79275fab05e849a9d5c252e989514f713edec7be'
assert sha(fixture/'manifest.json')==plan['testManifestSha256'];assert not manifest['runtimeProductModified'] and manifest['existingBusinessAssertionsAndTimeoutsUnchanged'] and manifest['seedAdministratorIdentityUntouched']
assert sha(root/'source'/plan['testFile'])==pins['test']==plan['testSha256']=='320476a55183cd18b319758ea5fe716eeed55a52ef920dc57e393ccce66edc93'
assert sha(parent/'source'/plan['testFile'])==pins['testBefore']==plan['testBeforeSha256']=='cf4ca311db931ad88fa0c38c301a694acb694717508a356ffced9a7a57609ae5'
for tree,freeze in [(repo,p['sourceFreeze']),(root/'source',p['composedFreeze']),(parent/'source',prior['composedFreeze'])]:
 for row in freeze:assert sha(tree/row['file'])==row['sha256'],row['file']
before={x['file']:x['sha256'] for x in prior['composedFreeze']};after={x['file']:x['sha256'] for x in p['composedFreeze']}
assert len(before)==len(after)==1045 and before.keys()==after.keys();assert [f for f in before if before[f]!=after[f]]==[plan['testFile']]
assert len(p['sourceFreeze'])==994 and p['controlFreeze']==[] and p['excludedJunctions']==[] and len(p['inheritedExcludedJunctions'])==7
assert [sum(j['workspace']==x for j in p['junctions']) for x in [True,False]]==[23,134]
for j in p['junctions']:
 assert Path(j['source']).resolve(strict=True)==Path(j['target']).resolve(strict=True)
 if j['workspace']:assert Path(j['target']).resolve(strict=True).is_relative_to((root/'source').resolve())
assert len(plan['typeTests'])==len(set(plan['typeTests']))==42 and p['apiTypeTests']==plan['typeTests'] and len(plan['requiredResolvedSources'])==14
assert read(root/'tsconfig.test.json')=={'extends':'./source/apps/api/tsconfig.json','files':['./source/'+f for f in plan['typeTests']],'include':[]}
assert sha(root/'tsconfig.test.json')==pins['config']==handoff['configSha256']=='9a86002fe3cc23f26faedea7334118a0b9642a12e2a2b12dfa3871f823afe277'
for name,key in [('prepare-feature-lifecycle.mjs','prepare'),('run-types.mjs','types'),('fixed-recipe.json','recipe')]:assert sha(h/name)==pins[key];artifact(h/name)
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
assert r['preparedSha256']==sha(root/'prepared.json') and r['frozenManifestSha256']==sha(root/'source-pin.manifest.json');assert r['testFiles']==[{'name':'features-lifecycle.test.ts','cases':8,'sha256':plan['testSha256']}]
assert all(r[k] for k in ['fixtureCleanupPassed','sourceHashesAfterMatch','ownedChildrenExited','runtimeUsesRestrictedConnections']);assert r['ownedChildrenWithoutExit']==[] and not r.get('cleanupHeldForOwnedProcessInspection',False) and not r.get('cleanupHeldOwnedPids',[]) and not r['credentialsPublished']
assert all(post[k] for k in ['systemIdentifierMatches','rolesRestoredIncludingPrivateCredentials','settingsRestored','containerAttestationMatches']);assert all(post[k]==0 for k in ['basePublicTables','temporaryDatabases','otherDatabases','otherClients']);assert post['roles']==6 and post['freeMiBAtStart']>=1536 and not post['computerRestarted'] and not post['credentialsPublished']
owned=read(root/'owned-database.json');assert owned['databaseName']==r['databaseName'] and owned['controllerPid']==r['controllerPid'] and re.fullmatch(r'ingest_runtime_[a-f0-9]{32}',r['databaseName'])
assert len(r['tests'])==1 and r['tests'][0]['label']=='features-lifecycle'
for child in [r['provision'],r['seed'],*r['tests']]:
 assert child['exitCode']==0 and child['signal'] is None and child['exitObserved'];assert not any(child[k] for k in ['spawnError','timedOut','overflow','treeKillFailed','drainTimedOut'])
 logfile=root/(child['label']+'.log');assert sha(logfile)==child['logSha256'];artifact(logfile)
parsers=runpy.run_path(str(w/'verify-feature-commands-v2-results-20261109.py'));text=(root/'features-lifecycle.log').read_text(encoding='utf-8');totals={k:parsers['summary'](text,k) for k in ['tests','suites','pass','fail','cancelled','skipped','todo']};assert totals=={'tests':8,'suites':1,'pass':8,'fail':0,'cancelled':0,'skipped':0,'todo':0}
for name in manifest['cases']:assert parsers['subtest'](text,name)[1]=='ok',name
awake=read(root/'awake-guard.json');assert awake['exitCode']==0 and awake['systemRequiredSet'] and awake['systemRequiredCleared'];assert not any(awake[k] for k in ['displayRequired','awayMode','permanentPowerSettingsChanged','computerRestarted'])
for f in [h/'PLAN.json',h/'AUTHORED-PINS.json',h/'executors-handoff.json',fixture/'manifest.json',root/'prepared.json',parent/'prepared.json',root/'tsconfig.test.json',root/'mfa-directed-result.json',root/'mfa-directed-postchecks.json',root/'owned-database.json',root/'awake-guard.json']:artifact(f)
report={'recordedOn':'2026-11-09','timeZone':'America/Sao_Paulo','status':'VERIFIED','verifierSha256':sha(Path(__file__)),'reviewedByRoot':True,'sourceFiles':1045,'typeFiles':42,'requiredResolvedSources':14,'runtimeProductModified':False,'changedSources':[plan['testFile']],'parentPreparedSha256':sha(parent/'prepared.json'),'preparedSha256':sha(root/'prepared.json'),'observedHead':head,'acceptedCounts':{'tap':8,'independentCases':8,'parentGroups':0,'suites':1},'totals':totals,'cases':manifest['cases'],'typeChecks':type_checks,'startedUtc':r['startedUtc'],'endedUtc':r['endedUtc'],'freeMiBAtStart':post['freeMiBAtStart'],'cleanupPassed':True,'temporarySystemActivityGuard':awake,'inputs':inputs,
 'scopeLimits':['Only the existing lifecycle test fixture changes; eight business assertions and deadlines unchanged, with requestedBy fixture changed to the isolated actor. Parent product bytes unchanged.',
 'Real login/enrollment/TOTP, same bearer/SID, own platform actor and local binding; no seed administrator MFA or credential changes.',
 'Real API/PostgreSQL/ingestion handlers/access dispatcher/notification protocol with a simulated device publisher and local HTTP webhook. This is not external MQTT/hardware, a browser, an app build or performance acceptance.',
 'Metrics/liveness, meter cursor/daily totals/incomplete day, AI preference, parking reactivation, queued gate cancellation/no replay, concurrent publish acknowledgement, concurrent alert delivery/cancellation and remote support outcome all passed.',
 'One eight-case suite only. Previous 72 directed and48 TAP regression results retain their own source/run evidence and are not added to this run.',
 'MFA068 remains candidate; runtime main001-067 unchanged. Additional authority races, other domains, full API/ingest, web/Android/iOS, operations and final presentation remain pending.'],'computerRestarted':False,'performanceAssessed':False,'productionAccepted':False}
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');print(json.dumps({'proof':sha(out),'verifier':sha(Path(__file__)),'totals':totals,'head':head}))
