from pathlib import Path
import hashlib,json,runpy,subprocess,re
w=Path(__file__).resolve().parent;repo=w.parent/'predioON';root=w/'mfa-feature-transition-waits-fixed-qa-20261109';h=w/'mfa-feature-transition-waits-harness-20261109';parent=w/'mfa-feature-transition-v3-fixed-qa-20261109';fixture=w/'mfa-feature-transition-waits-test-20261109'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();read=lambda p:json.loads(p.read_bytes());inputs=[]
def artifact(p):
 p=p.resolve(strict=True);assert p.is_relative_to(w.resolve());row={'id':p.relative_to(w).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size};inputs.append(row);return row
out=w/'mfa-feature-transition-waits-root-verification-20261109.json';assert not out.exists()
plan=read(h/'PLAN.json');pins=read(h/'AUTHORED-PINS.json');handoff=read(h/'executors-handoff.json');manifest=read(fixture/'manifest.json');p=read(root/'prepared.json');prior=read(parent/'prepared.json')
assert sha(h/'PLAN.json')==pins['plan']=='fb46bc6edcc301d16b3501be9cba33d7cfa796b2ed97c14ea42f3804b42f57b4'
assert sha(h/'executors-handoff.json')=='0beb057a4362060a1b5b7e0f7599b3dadef5342016d810628a14ba195a4c61e6'
assert sha(root/'prepared.json')==handoff['preparedSha256']=='ed84de87c330b2a4cb0ee1140bf52cddfde2a7352e9bf204d9a71920c71a8578'
assert sha(parent/'prepared.json')==plan['priorPreparedSha256']==p['priorPreparedSha256']=='31fecc8ed939cb832769132ba4de417280c5f5cd38d8cbb64127d397f2cbe2e6'
assert sha(fixture/'manifest.json')==plan['testManifestSha256'];assert not manifest['runtimeProductModified'] and not manifest['existingTestsChanged'] and manifest['positiveProofThroughRealHttp'] and manifest['actualDatabaseWaitsRequired']==24 and not manifest['triggersInstalled']
assert sha(root/'source'/plan['testFile'])==pins['test']==plan['testSha256']=='4fc7265b6052f2d8ab1b08b52f5381fcad3543587d600b4849f6e99574292211'
assert not (parent/'source'/plan['testFile']).exists()
for tree,freeze in [(repo,p['sourceFreeze']),(root/'source',p['composedFreeze']),(parent/'source',prior['composedFreeze'])]:
 for row in freeze:assert sha(tree/row['file'])==row['sha256'],row['file']
before={x['file']:x['sha256'] for x in prior['composedFreeze']};after={x['file']:x['sha256'] for x in p['composedFreeze']}
assert len(before)==1046 and len(after)==1047 and set(after)-set(before)=={plan['testFile']} and set(before).issubset(after);assert all(before[f]==after[f] for f in before)
assert len(p['sourceFreeze'])==994 and p['controlFreeze']==[] and p['excludedJunctions']==[] and len(p['inheritedExcludedJunctions'])==7
assert [sum(j['workspace']==x for j in p['junctions']) for x in [True,False]]==[23,134]
for j in p['junctions']:
 assert Path(j['source']).resolve(strict=True)==Path(j['target']).resolve(strict=True)
 if j['workspace']:assert Path(j['target']).resolve(strict=True).is_relative_to((root/'source').resolve())
assert len(plan['typeTests'])==len(set(plan['typeTests']))==44 and p['apiTypeTests']==plan['typeTests'] and len(plan['requiredResolvedSources'])==14
assert read(root/'tsconfig.test.json')=={'extends':'./source/apps/api/tsconfig.json','files':['./source/'+f for f in plan['typeTests']],'include':[]}
assert sha(root/'tsconfig.test.json')==pins['config']==handoff['configSha256']=='f5003b31ccaf65736f21567c23c181eb6bde9e9c91bca9a028fbfd2d3eba79af'
for name,key in [('prepare-feature-transition-waits.mjs','prepare'),('run-types.mjs','types'),('fixed-recipe.json','recipe')]:assert sha(h/name)==pins[key];artifact(h/name)
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
assert r['preparedSha256']==sha(root/'prepared.json') and r['frozenManifestSha256']==sha(root/'source-pin.manifest.json');assert r['testFiles']==[{'name':'platform-mfa-feature-transition-waits.test.ts','cases':24,'sha256':plan['testSha256']}]
assert all(r[k] for k in ['fixtureCleanupPassed','sourceHashesAfterMatch','ownedChildrenExited','runtimeUsesRestrictedConnections']);assert r['ownedChildrenWithoutExit']==[] and not r.get('cleanupHeldForOwnedProcessInspection',False) and not r.get('cleanupHeldOwnedPids',[]) and not r['credentialsPublished']
assert all(post[k] for k in ['systemIdentifierMatches','rolesRestoredIncludingPrivateCredentials','settingsRestored','containerAttestationMatches']);assert all(post[k]==0 for k in ['basePublicTables','temporaryDatabases','otherDatabases','otherClients']);assert post['roles']==6 and post['freeMiBAtStart']>=1536 and not post['computerRestarted'] and not post['credentialsPublished']
owned=read(root/'owned-database.json');assert owned['databaseName']==r['databaseName'] and owned['controllerPid']==r['controllerPid'] and re.fullmatch(r'ingest_runtime_[a-f0-9]{32}',r['databaseName'])
assert len(r['tests'])==1 and r['tests'][0]['label']=='platform-mfa-feature-transition-waits'
for child in [r['provision'],r['seed'],*r['tests']]:
 assert child['exitCode']==0 and child['signal'] is None and child['exitObserved'];assert not any(child[k] for k in ['spawnError','timedOut','overflow','treeKillFailed','drainTimedOut'])
 logfile=root/(child['label']+'.log');assert sha(logfile)==child['logSha256'];artifact(logfile)
parsers=runpy.run_path(str(w/'verify-feature-commands-v2-results-20261109.py'));text=(root/'platform-mfa-feature-transition-waits.log').read_text(encoding='utf-8');totals={k:parsers['summary'](text,k) for k in ['tests','suites','pass','fail','cancelled','skipped','todo']};assert totals=={'tests':24,'suites':1,'pass':24,'fail':0,'cancelled':0,'skipped':0,'todo':0}
for name in manifest['cases']:assert parsers['subtest'](text,name)[1]=='ok',name
awake=read(root/'awake-guard.json');assert awake['exitCode']==0 and awake['systemRequiredSet'] and awake['systemRequiredCleared'];assert not any(awake[k] for k in ['displayRequired','awayMode','permanentPowerSettingsChanged','computerRestarted'])
for f in [h/'PLAN.json',h/'AUTHORED-PINS.json',h/'executors-handoff.json',fixture/'manifest.json',root/'prepared.json',parent/'prepared.json',root/'tsconfig.test.json',root/'mfa-directed-result.json',root/'mfa-directed-postchecks.json',root/'owned-database.json',root/'awake-guard.json']:artifact(f)
report={'recordedOn':'2026-11-09','timeZone':'America/Sao_Paulo','status':'VERIFIED','verifierSha256':sha(Path(__file__)),'reviewedByRoot':True,'sourceFiles':1047,'typeFiles':44,'requiredResolvedSources':14,'runtimeProductModified':False,'existingTestsChanged':False,'changedSources':[plan['testFile']],'parentPreparedSha256':sha(parent/'prepared.json'),'preparedSha256':sha(root/'prepared.json'),'observedHead':head,'acceptedCounts':{'tap':24,'independentCases':24,'parentGroups':0,'suites':1},'totals':totals,'cases':manifest['cases'],'typeChecks':type_checks,'startedUtc':r['startedUtc'],'endedUtc':r['endedUtc'],'freeMiBAtStart':post['freeMiBAtStart'],'cleanupPassed':True,'temporarySystemActivityGuard':awake,'inputs':inputs,
 'scopeLimits':['One new 24-case file only; all 1046 parent sources, runtime product and existing tests are unchanged.', 'Real HTTP login/enrollment/TOTP, same bearer/SID; global-binding actor without platform flag for authority withdrawal.', 'Two scopes and four exact effect-row waits, each followed by externally committed proof/factor/global-binding loss. pg_stat_clear_snapshot and pg_blocking_pids prove the restricted API is waiting on this exact owner connection before withdrawal.', 'All rows in 14 business/audit/outbox tables and all tenants revert, while only the external negative identity change remains committed. Notification absence is fenced by a committed listener barrier. No triggers are added in this suite.', 'The owner locks one existing row; no external hardware/dispatcher, outbound webhook, browser, app build or performance acceptance. Missing-target/promotion and other domains remain pending.', 'Earlier32 rollback,8 positive lifecycle and117 independent configuration results retain separate evidence and are not summed into this24-case run. MFA068 remains candidate; runtime main001-067 unchanged.'],'computerRestarted':False,'performanceAssessed':False,'productionAccepted':False}
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');print(json.dumps({'proof':sha(out),'verifier':sha(Path(__file__)),'totals':totals,'head':head}))
