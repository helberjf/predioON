from pathlib import Path
import hashlib,json,re,runpy,subprocess
w=Path(__file__).resolve().parent;repo=w.parent/'predioON';h=w/'mfa-organization-commands-v2-harness-20261109';parent=w/'mfa-feature-command-boundaries-fixed-qa-20261109';fixture=w/'mfa-organization-commands-v2-test-20261109';product=w/'mfa-organization-commands-candidate-20261109'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();read=lambda p:json.loads(p.read_bytes());inputs=[]
def artifact(p):
 p=p.resolve(strict=True);assert p.is_relative_to(w.resolve());item={'id':p.relative_to(w).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size};inputs.append(item);return item
out=w/'mfa-organization-commands-root-verification-20261109.json';assert not out.exists()
plan=read(h/'PLAN.json');pins=read(h/'AUTHORED-PINS.json');handoff=read(h/'executors-handoff-v3.json');manifest=read(fixture/'manifest.json');prior=read(parent/'prepared.json');delta=read(product/'manifest.json');route=delta['files'][0]['path'];test=plan['testFile']
assert sha(h/'PLAN.json')==pins['plan']=='ff4c70c47b45a3c887ec53782e5d5021f285d17b8f03bea1f02473db0d6b1a3d'
assert sha(h/'executors-handoff-v3.json')=='756a21b68e8712a9a4f31de731bc8ccf774244cc271c2f7710329cb3221bcfee'
assert sha(parent/'prepared.json')==plan['priorPreparedSha256']=='eb22fda8ef119f03feaccac22cb685eaecd569ae8b5e74fe4457c7c0b91c1964'
assert sha(fixture/test)==pins['test']==plan['testSha256']=='950fb102f6a7841ac6ac90f6a61d7e944ad09ddb3cdffd890d88f5c57d0ae9ee'
assert sha(fixture/'manifest.json')==plan['testManifestSha256'] and manifest['positiveProofThroughRealHttp'] and not manifest['sqlResultsFaked'] and manifest['observerRejectionForwarded']
assert sha(product/'manifest.json')==plan['productManifestSha256'] and len(delta['files'])==1 and delta['readGetUnchanged'] and delta['existingDmlAndNoKeyUpdateLockUnchanged'] and delta['schemasPoliciesMigrationsUnchanged']
assert sha(product/'before.ts')==plan['productBeforeSha256']=='40c56393491eb4bb1533b271d68919e5022a1d940013cafda0a6046ca20f7075'
assert sha(product/'after.ts')==plan['productAfterSha256']==pins['product']=='0b7ffd335bf9f51ca05448850e86f11f2f0c4aa4b3933a61bc69eeb02487f400'
assert len(manifest['cases'])==len(set(manifest['cases']))==30 and len(plan['typeTests'])==len(set(plan['typeTests']))==47 and len(plan['requiredResolvedSources'])==15
for name,key in [('prepare-organization-commands.mjs','prepare'),('run-types.mjs','types')]:assert sha(h/name)==pins[key];artifact(h/name)
for row in prior['composedFreeze']:assert sha(parent/'source'/row['file'])==row['sha256']
old={x['file']:x['sha256'] for x in prior['composedFreeze']};assert len(old)==1048 and test not in old and old[route]==plan['productBeforeSha256']
prepared={};types=[]
for variant in ['baseline','fixed']:
 root=w/f'mfa-organization-commands-v2-{variant}-qa-20261109';p=read(root/'prepared.json');prepared[variant]=p
 assert sha(root/'prepared.json')==handoff['preparedPins'][variant] and p['priorPreparedSha256']==sha(parent/'prepared.json') and p['variant']==variant
 assert p['base']==plan['sourceBase'] and len(p['composedFreeze'])==1049 and len(p['sourceFreeze'])==994 and p['controlFreeze']==[] and p['excludedJunctions']==[] and len(p['inheritedExcludedJunctions'])==7
 for tree,rows in [(repo,p['sourceFreeze']),(root/'source',p['composedFreeze'])]:
  for row in rows:assert sha(tree/row['file'])==row['sha256'],row['file']
 actual={x['file']:x['sha256'] for x in p['composedFreeze']};expected={**old,test:plan['testSha256']};expected[route]=plan['productBeforeSha256' if variant=='baseline' else 'productAfterSha256'];assert actual==expected
 assert [sum(j['workspace']==flag for j in p['junctions']) for flag in [True,False]]==[23,134]
 for j in p['junctions']:
  assert Path(j['source']).resolve(strict=True)==Path(j['target']).resolve(strict=True)
  if j['workspace']:assert Path(j['target']).resolve(strict=True).is_relative_to((root/'source').resolve())
 assert p['apiTypeTests']==plan['typeTests'] and read(root/'tsconfig.test.json')=={'extends':'./source/apps/api/tsconfig.json','files':['./source/'+f for f in plan['typeTests']],'include':[]}
 assert sha(root/'tsconfig.test.json')==pins['config']==handoff['configSha256']=='e9f1b3d1404aa10a9dd7753667d2a5a2eb596d7074e43c01794347b24053111e'
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
parsers=runpy.run_path(str(w/'verify-feature-commands-v2-results-20261109.py'));review=read(w/'mfa-organization-baseline-review-20261109.json');assert review['reviewedByRoot'] and review['functionalCases']==30 and review['sourceProductModified'] is False
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip();runs=[]
for variant in ['baseline','fixed','fixed-regression']:
 root=w/f'mfa-organization-commands-v3-{variant}-evidence-20261109';src='baseline' if variant=='baseline' else 'fixed';p=prepared[src];source=w/f'mfa-organization-commands-v2-{src}-qa-20261109';r=read(root/'mfa-directed-result.json');post=read(root/'mfa-directed-postchecks.json')
 assert r['observedHeadBefore']==r['observedHeadAfter']==head and r['expectedHead']==plan['sourceBase'];assert r['status']=='completed-awaiting-TAP-GREEN-classification' and r['exitCode']==post['exitCode']==0
 assert r['sourceFiles']==[{'path':x['file'],'sha256':x['sha256']} for x in p['sourceFreeze']] and r['archivedFiles']==[{'path':x['file'],'sha256':x['sha256']} for x in p['composedFreeze']]
 assert r['preparedSha256']==sha(source/'prepared.json') and r['frozenManifestSha256']==sha(source/'source-pin.manifest.json')
 selected=plan['regressionFiles'] if variant=='fixed-regression' else [{'name':Path(test).name,'cases':30,'sha256':plan['testSha256']}];assert r['testFiles']==selected
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
     item=failures[name];assert item['expectedStatus']==403 and item['actualStatus'] in [200,404] and re.search(r'ERR_ASSERTION',diagnostic) and re.search(r"operator:\s*['\"]?strictEqual",diagnostic)
     assert re.findall(r'^\s+expected:\s*(\d+)\s*$',diagnostic,re.M)==['403'] and re.findall(r'^\s+actual:\s*(\d+)\s*$',diagnostic,re.M)==[str(item['actualStatus'])]
   assert len(failures)==t['fail'] and t['pass']==30-t['fail']
  else:
   assert t['pass']==selection['cases'] and t['fail']==0
   if variant=='fixed':
    for name in manifest['cases']:assert parsers['subtest'](text,name)[1]=='ok'
  totals.append({'label':child['label'],**t})
 awake=read(root/'awake-guard.json');assert awake['exitCode']==0 and awake['systemRequiredSet'] and awake['systemRequiredCleared'] and not any(awake[k] for k in ['displayRequired','awayMode','permanentPowerSettingsChanged','computerRestarted'])
 for f in ['mfa-directed-result.json','mfa-directed-postchecks.json','owned-database.json','awake-guard.json']:artifact(root/f)
 runs.append({'variant':variant,'startedUtc':r['startedUtc'],'endedUtc':r['endedUtc'],'totals':totals,'freeMiBAtStart':post['freeMiBAtStart'],'cleanupPassed':True,'temporarySystemActivityGuard':awake})
history=read(w/'mfa-organization-commands-v1-review-20261109.json');assert sha(w/'mfa-organization-commands-v1-review-20261109.json')=='bc60b4b1ee62a24dbd79e7a80ca38ca5a67f81c3e492f1223e2448ccfcf45709' and history['functionalCasesExecuted']==0 and history['baselineTypesPassed'] and not history['productChangedByCorrection'] and not history['assertionsAndTimeoutsChanged']
for f in [h/'PLAN.json',h/'AUTHORED-PINS.json',h/'executors-handoff-v3.json',w/'mfa-organization-commands-v2-executor-review-20261109.json',fixture/'manifest.json',product/'manifest.json',w/'mfa-organization-baseline-review-20261109.json',w/'mfa-organization-commands-v1-review-20261109.json']:artifact(f)
report={'recordedOn':'2026-11-09','timeZone':'America/Sao_Paulo','status':'VERIFIED','reviewedByRoot':True,'verifierSha256':sha(Path(__file__)),'observedHead':head,'sourceFiles':1049,'typeFiles':47,'requiredResolvedSources':15,'parentPreparedSha256':sha(parent/'prepared.json'),'preparedPins':handoff['preparedPins'],'runtimeProductModified':True,'runtimeProductModifiedPaths':[route],'existingTestsChanged':False,'newTests':[test],'acceptedCounts':{'directed':30,'regressionFiles':2,'regression':17,'combinedTap':47,'combinedIndependent':47,'parentGroups':0,'suites':3},'baseline':review,'typeChecks':types,'runs':runs,'cleanupPassed':True,'inputs':inputs,
 'scopeLimits':['Organization POST/PATCH only; actual DML, NO KEY UPDATE lock, GET, schemas, policies and migrations unchanged. Explicit MFA/capability checks cover empty results and fresh post-mutation/audit/response decisions.',
 'Same 30-case test bytes on baseline and fixed; raw HTTP login/enrollment/TOTP and original SQL results. All organization rows and organization audit rows are compared after denied outcomes; four positive cases verify DTO, storage, unrelated organizations and exact audit semantics.',
 'Controlled post-SQL interleavings; no actual external MFA row-wait, promotion, trigger fault injection, hardware, browser, mobile build or performance acceptance in this batch.',
 'Two unchanged existing regression files: 11 SQL envelopes and six mandatory-MFA-family cases. These include existing synthetic SQL fixtures; real ceremony acceptance is established by the new directed suite. Legacy organizations-capabilities and full API/ingest regression still require integration work.',
 'V1 types passed before fixing observer rejection forwarding. No V1 functional run; assertions, timeouts and product were unchanged by that test correction. Earlier batches remain separate and are not summed.',
 'MFA068 remains candidate; canonical runtime main001-067 unchanged; not production acceptance.'],'computerRestarted':False,'performanceAssessed':False,'productionAccepted':False}
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');print(json.dumps({'proof':sha(out),'verifier':sha(Path(__file__)),'accepted':report['acceptedCounts'],'head':head}))
