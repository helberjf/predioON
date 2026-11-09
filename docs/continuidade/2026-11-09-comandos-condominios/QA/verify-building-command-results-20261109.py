from pathlib import Path
import hashlib,json,re,runpy,subprocess
w=Path(__file__).resolve().parent;repo=w.parent/'predioON';h=w/'mfa-building-commands-v3-harness-20261109';parent=w/'mfa-organization-boundaries-fixed-qa-20261109';fixture=w/'mfa-building-commands-v3-test-20261109';product=w/'mfa-building-commands-candidate-20261109'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();read=lambda p:json.loads(p.read_bytes());inputs=[]
def artifact(p):
 p=p.resolve(strict=True);assert p.is_relative_to(w.resolve());item={'id':p.relative_to(w).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size};inputs.append(item);return item
out=w/'mfa-building-commands-root-verification-20261109.json';assert not out.exists()
plan=read(h/'PLAN.json');pins=read(h/'AUTHORED-PINS.json');handoff=read(h/'executors-handoff.json');manifest=read(fixture/'manifest.json');prior=read(parent/'prepared.json');delta=read(product/'manifest.json');route=delta['files'][0]['path'];test=plan['testFile']
assert sha(h/'PLAN.json')==pins['plan']=='0b0b1262243260c215af9b55bbe18ee06895b0de3962a378c578a8ff16f71ac8'
assert sha(h/'executors-handoff.json')=='b02e7a832da2e035b921fcc6bd797427e3f1288817f1185971373dffbed7d8f7'
assert sha(parent/'prepared.json')==plan['priorPreparedSha256']=='962cace5f3801a98a9dcc8f1eb968d0d4424ff1f3ecffe1b6e11bca8329f3688'
assert sha(fixture/test)==pins['test']==plan['testSha256']=='5bf8ceb3f33c1f56b698aee02d5018a80b398dac7bf72e9f79a0b4120ffff60e'
assert sha(fixture/'manifest.json')==plan['testManifestSha256'] and manifest['positiveProofThroughRealHttp'] and not manifest['sqlResultsFaked'] and not manifest['privateCacheAcceptanceClaimed']
assert sha(product/'manifest.json')==plan['productManifestSha256'] and len(delta['files'])==1 and delta['getUnchanged'] and delta['originalDmlLockAndCapabilitiesUnchanged'] and delta['schemasPoliciesMigrationsUnchanged']
assert sha(product/'before.ts')==plan['productBeforeSha256']=='d7474891553a5c4bd580c55b804f0a137558e47164e9a666d90b3ac4a0ea7c23'
assert sha(product/'after.ts')==plan['productAfterSha256']==pins['product']=='b5c9e08dcbbda4433a35afb42739ad7fcdf963a5ff10e0ba24ff501309095d58'
assert len(manifest['cases'])==len(set(manifest['cases']))==32 and len(plan['typeTests'])==len(set(plan['typeTests']))==51 and len(plan['requiredResolvedSources'])==15
for name,key in [('prepare-building-commands.mjs','prepare'),('run-types.mjs','types')]:assert sha(h/name)==pins[key];artifact(h/name)
for row in prior['composedFreeze']:assert sha(parent/'source'/row['file'])==row['sha256']
old={x['file']:x['sha256'] for x in prior['composedFreeze']};assert len(old)==1051 and test not in old and old[route]==plan['productBeforeSha256']
prepared={};types=[]
for variant in ['baseline','fixed']:
 root=w/f'mfa-building-commands-v3-{variant}-qa-20261109';p=read(root/'prepared.json');prepared[variant]=p
 assert sha(root/'prepared.json')==handoff['preparedPins'][variant] and p['priorPreparedSha256']==sha(parent/'prepared.json') and p['variant']==variant
 assert p['base']==plan['sourceBase'] and len(p['composedFreeze'])==1052 and len(p['sourceFreeze'])==994 and p['controlFreeze']==[] and p['excludedJunctions']==[] and len(p['inheritedExcludedJunctions'])==7
 for tree,rows in [(repo,p['sourceFreeze']),(root/'source',p['composedFreeze'])]:
  for row in rows:assert sha(tree/row['file'])==row['sha256'],row['file']
 actual={x['file']:x['sha256'] for x in p['composedFreeze']};expected={**old,test:plan['testSha256']};expected[route]=plan['productBeforeSha256' if variant=='baseline' else 'productAfterSha256'];assert actual==expected
 assert [sum(j['workspace']==flag for j in p['junctions']) for flag in [True,False]]==[23,134]
 for j in p['junctions']:
  assert Path(j['source']).resolve(strict=True)==Path(j['target']).resolve(strict=True)
  if j['workspace']:assert Path(j['target']).resolve(strict=True).is_relative_to((root/'source').resolve())
 assert p['apiTypeTests']==plan['typeTests'] and read(root/'tsconfig.test.json')=={'extends':'./source/apps/api/tsconfig.json','files':['./source/'+f for f in plan['typeTests']],'include':[]}
 assert sha(root/'tsconfig.test.json')==pins['config']==handoff['configSha256']=='6bb9a2ae91d2965c5a41b8661ccf107ffccdae6ea714cc8ab37453ee17dcc967'
 assert sha(h/f'{variant}-recipe.json')==pins['recipes'][variant]==p['recipeSha256'];artifact(h/f'{variant}-recipe.json')
 pr=read(h/f'{variant}-prepare-result.json');guard=read(h/f'{variant}-prepare-guard.json');assert pr['exitCode']==0 and not pr['timedOut'] and pr['heapMiB']==256 and guard['minimumMiB']==1536 and guard['freeMiB']>=1536
 for suffix in ['result.json','guard.json','stdout.txt','stderr.txt']:artifact(h/(variant+'-prepare.'+suffix) if suffix.endswith('txt') else h/(variant+'-prepare-'+suffix))
 for phase in ['resolve','types']:
  base=root/'checks'/phase;r=read(base/'result.json');cmd=read(base/'command.json');g=read(base/'guard.json')
  assert r['phase']==phase and r['variant']==variant and r['passed'] and r['exitObserved'] and not r['timedOut'] and not r['drainTimedOut'] and r['exitCode']==0 and r['signal'] is None and r['errorCode'] is None
  assert not r['tests'] and not r['database'] and r['preparedSha256']==sha(root/'prepared.json')==cmd['preparedSha256'] and cmd['configSha256']==sha(root/'tsconfig.test.json')
  assert all(r[stage][key] for stage in ['before','after'] for key in ['source','candidate','config','prepared','junctions']);assert g['minimumMiB']==1536 and g['freeMiB']>=1536 and g['parentHeapMiB']==128 and g['childHeapMiB']==640
  if phase=='resolve':
   assert r['resolved']=={'requiredSourcesCount':15,'mfaReadListed':True,'requiredSourcesListed':True,'allTestsListed':True,'originalWorkspacePaths':[]}
   lines=[x.replace('\\','/').lower() for x in (base/'stdout.log').read_text(encoding='utf-8').splitlines()]
   for f in plan['typeTests']+plan['requiredResolvedSources']:assert (root/'source'/f).as_posix().lower() in lines
  for stream in ['stdout','stderr']:assert sha(base/(stream+'.log'))==r[stream+'Sha256'];artifact(base/(stream+'.log'))
  types.append({'variant':variant,'phase':phase,'result':artifact(base/'result.json')});artifact(base/'command.json');artifact(base/'guard.json')
 artifact(root/'prepared.json');artifact(root/'tsconfig.test.json')
assert len(handoff['executors'])==9 and not handoff['processLifecycleModified'] and handoff['requiresAlreadyRunningAttestedCluster'] and handoff['minimumFreeMiB']==1536
for row in handoff['executors']:assert sha(w/row['path'])==row['sha256'];artifact(w/row['path'])
assert sha(w/handoff['clusterAttestation'])==handoff['clusterAttestationSha256']=='9d43fe8e98ce5e11a26e7e943fb465a96f24a4c14368bbdab5712e5282cb426e';artifact(w/handoff['clusterAttestation'])
parsers=runpy.run_path(str(w/'verify-feature-commands-v2-results-20261109.py'));review=read(w/'mfa-building-commands-baseline-review-20261109.json');assert review['reviewedByRoot'] and review['functionalCases']==32 and review['sourceProductModified'] is False
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip();runs=[]
for variant in ['baseline','fixed','fixed-regression']:
 root=w/f'mfa-building-commands-v3-{variant}-evidence-20261109';src='baseline' if variant=='baseline' else 'fixed';p=prepared[src];source=w/f'mfa-building-commands-v3-{src}-qa-20261109';r=read(root/'mfa-directed-result.json');post=read(root/'mfa-directed-postchecks.json')
 assert r['observedHeadBefore']==r['observedHeadAfter']==head and r['expectedHead']==plan['sourceBase'];assert r['status']=='completed-awaiting-TAP-GREEN-classification' and r['exitCode']==post['exitCode']==0
 assert r['sourceFiles']==[{'path':x['file'],'sha256':x['sha256']} for x in p['sourceFreeze']] and r['archivedFiles']==[{'path':x['file'],'sha256':x['sha256']} for x in p['composedFreeze']]
 assert r['preparedSha256']==sha(source/'prepared.json') and r['frozenManifestSha256']==sha(source/'source-pin.manifest.json')
 selected=plan['regressionFiles'] if variant=='fixed-regression' else [{'name':Path(test).name,'cases':32,'sha256':plan['testSha256']}];assert r['testFiles']==selected
 assert all(r[k] for k in ['fixtureCleanupPassed','sourceHashesAfterMatch','ownedChildrenExited','runtimeUsesRestrictedConnections']) and r['ownedChildrenWithoutExit']==[] and not r.get('cleanupHeldForOwnedProcessInspection',False) and not r.get('cleanupHeldOwnedPids',[]) and not r['credentialsPublished']
 assert all(post[k] for k in ['systemIdentifierMatches','rolesRestoredIncludingPrivateCredentials','settingsRestored','containerAttestationMatches']) and all(post[k]==0 for k in ['basePublicTables','temporaryDatabases','otherDatabases','otherClients']) and post['roles']==6 and post['freeMiBAtStart']>=1536 and not post['computerRestarted'] and not post['credentialsPublished']
 owned=read(root/'owned-database.json');assert owned['databaseName']==r['databaseName'] and owned['controllerPid']==r['controllerPid'] and re.fullmatch(r'ingest_runtime_[a-f0-9]{32}',r['databaseName'])
 assert len(r['tests'])==len(selected) and [x['label'] for x in r['tests']]==[x['name'].removesuffix('.test.ts') for x in selected]
 for child in [r['provision'],r['seed'],*r['tests']]:
  expected_exit=1 if variant=='baseline' and child in r['tests'] and review['failures'] else 0
  assert child['exitCode']==expected_exit and child['signal'] is None and child['exitObserved'] and not any(child[k] for k in ['spawnError','timedOut','overflow','treeKillFailed','drainTimedOut'])
  logfile=root/(child['label']+'.log');assert sha(logfile)==child['logSha256'];artifact(logfile)
 totals=[]
 for child,selection in zip(r['tests'],selected):
  log=root/(child['label']+'.log');text=log.read_text(encoding='utf-8');t={k:parsers['summary'](text,k) for k in ['tests','suites','pass','fail','cancelled','skipped','todo']};assert t['tests']==selection['cases'] and t['suites']==1 and t['cancelled']==t['skipped']==t['todo']==0
  if variant=='baseline':
   assert sha(log)==review['tapSha256'] and t==review['totals'];failures={x['name']:x for x in review['failures']}
   for name in manifest['cases']:
    _,status,diagnostic=parsers['subtest'](text,name);assert status==('not ok' if name in failures else 'ok')
    if name in failures:
     item=failures[name];assert item['expectedStatus']==403 and item['actualStatus'] in [200,201,404] and re.search(r'ERR_ASSERTION',diagnostic) and re.search(r"operator:\s*['\"]?strictEqual",diagnostic)
     assert re.findall(r'^\s+expected:\s*(\d+)\s*$',diagnostic,re.M)==['403'] and re.findall(r'^\s+actual:\s*(\d+)\s*$',diagnostic,re.M)==[str(item['actualStatus'])]
   assert len(failures)==t['fail'] and t['pass']==32-t['fail']
  else:
   assert t['pass']==selection['cases'] and t['fail']==0
   if variant=='fixed':
    for name in manifest['cases']:assert parsers['subtest'](text,name)[1]=='ok'
  totals.append({'label':child['label'],**t})
 awake=read(root/'awake-guard.json');assert awake['exitCode']==0 and awake['systemRequiredSet'] and awake['systemRequiredCleared'] and not any(awake[k] for k in ['displayRequired','awayMode','permanentPowerSettingsChanged','computerRestarted'])
 for f in ['mfa-directed-result.json','mfa-directed-postchecks.json','owned-database.json','awake-guard.json']:artifact(root/f)
 runs.append({'variant':variant,'startedUtc':r['startedUtc'],'endedUtc':r['endedUtc'],'totals':totals,'freeMiBAtStart':post['freeMiBAtStart'],'cleanupPassed':True,'temporarySystemActivityGuard':awake})
for f in [h/'PLAN.json',h/'AUTHORED-PINS.json',h/'executors-handoff.json',fixture/'manifest.json',product/'manifest.json',w/'mfa-building-commands-baseline-review-20261109.json']:artifact(f)
history=[]
for name,pin in [('mfa-building-commands-v1-review-20261109.json','c94148ba461860805f0faddd918d8e33e2e06bc23414ce7327befcf709c98852'),('mfa-building-commands-v2-review-20261109.json','f8b835fbc5b98e0c3bb0c8697b585107e444d77d79172ee121e67cc514ff23f0')]:
 assert sha(w/name)==pin;history.append(read(w/name));artifact(w/name)
assert history[0]['functionalCasesExecuted']==0 and history[1]['mfaStatusFailures']==16 and history[1]['fixtureScopeFailures']==3 and not history[1]['productChangedByCorrection']
historical_log=w/'mfa-building-commands-v2-baseline-evidence-20261109/platform-mfa-building-commands.log';assert sha(historical_log)==history[1]['tapSha256'];artifact(historical_log)
report={'recordedOn':'2026-11-09','timeZone':'America/Sao_Paulo','status':'VERIFIED','reviewedByRoot':True,'verifierSha256':sha(Path(__file__)),'observedHead':head,'sourceFiles':1052,'typeFiles':51,'requiredResolvedSources':15,'parentPreparedSha256':sha(parent/'prepared.json'),'preparedPins':handoff['preparedPins'],'runtimeProductModified':True,'runtimeProductModifiedPaths':[route],'existingTestsChanged':False,'newTests':[test],'acceptedCounts':{'directed':32,'regressionFiles':3,'regression':30,'combinedTap':62,'combinedIndependent':62,'parentGroups':0,'suites':4},'baseline':review,'typeChecks':types,'runs':runs,'cleanupPassed':True,'attemptHistory':history,'inputs':inputs,
 'scopeLimits':['Building POST/PATCH gain seven explicit current-MFA checks. Original DML, FOR UPDATE lock, global/local capability rules, audit-before-deactivation, GET, schemas/policies/migrations and optional MFA for ordinary users preserved.',
 'Identical32-case V3 test bytes on baseline/fixed; raw real HTTP login/enrollment/TOTP. Observers pause after original SQL capability/write/audit/row-lock query and never fabricate SQL results. Not actual external database waits in this batch.',
 'Sixteen negative outcomes require403 and unchanged full building/organization/domain-audit snapshots. Sixteen controls check ten-field DTO/storage, global flag/binding, ordinary local manager updates/deactivation/name-only preservation, cross-organization isolation, local unauthorized roles, defaults and valid404.',
 'Three unchanged regressions: building/feature capabilities13, SQL envelopes11, mandatory MFA6. Some historical SQL contexts remain synthetic; real ceremony proven by directed32 and the existing HTTP administrator fixtures.',
 'V1 syntax failed before functional runs; V2 baseline had16 MFA divergences and three incorrect expected audit scopes. V3 preserves036 PLATFORM scope for creation and BUILDING for edits; other assertions, matrix, timeouts and product unchanged by fixture corrections.',
 'Private response cache, external waits, promotion/triggers, remaining equipment/domain commands and complete API/ingest/browser/native/hardware/operations acceptance pending. Earlier batches are separate and not summed. MFA068 candidate; canonical main001-067 unchanged.'],'computerRestarted':False,'performanceAssessed':False,'privateCacheAccepted':False,'productionAccepted':False}
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');print(json.dumps({'proof':sha(out),'verifier':sha(Path(__file__)),'accepted':report['acceptedCounts'],'head':head}))
