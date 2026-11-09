from pathlib import Path
import hashlib,json,runpy,subprocess,re
w=Path(__file__).resolve().parent;repo=w.parent/'predioON';root=w/'mfa-organization-boundaries-fixed-qa-20261109';h=w/'mfa-organization-boundaries-harness-20261109';parent=w/'mfa-organization-waits-fixed-qa-20261109';fixture=w/'mfa-organization-boundaries-test-20261109'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();read=lambda p:json.loads(p.read_bytes());inputs=[]
def artifact(p):
 p=p.resolve(strict=True);assert p.is_relative_to(w.resolve());row={'id':p.relative_to(w).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size};inputs.append(row);return row
out=w/'mfa-organization-boundaries-root-verification-20261109.json';assert not out.exists()
plan=read(h/'PLAN.json');pins=read(h/'AUTHORED-PINS.json');handoff=read(h/'executors-handoff.json');manifest=read(fixture/'manifest.json');p=read(root/'prepared.json');prior=read(parent/'prepared.json')
assert sha(h/'PLAN.json')==pins['plan']=='dd3fdd9897cfa19df96b3f24bda8e890408ed126110a46dfb6ab6b59cd0f63bf'
assert sha(h/'executors-handoff.json')=='44a1d97ebe6113786dde7eadbc706ae91e3e5fc39716acb55392edc20e4d7456'
assert sha(root/'prepared.json')==handoff['preparedSha256']=='962cace5f3801a98a9dcc8f1eb968d0d4424ff1f3ecffe1b6e11bca8329f3688'
assert sha(parent/'prepared.json')==plan['priorPreparedSha256']==p['priorPreparedSha256']=='8d4044f0769a41e2389d4b2f60c089a48d6e17568b6d6ffcef8f129d704826f1'
assert sha(fixture/'manifest.json')==plan['testManifestSha256'];assert not manifest['runtimeProductModified'] and manifest['positiveProofThroughRealHttp'] and not manifest['sqlResultsFaked'] and manifest['promotionSameSidRecoveryCases']==16 and manifest['authorityWaitCases']==4 and manifest['transactionalFaultCases']==16
assert sha(root/'source'/plan['testFile'])==pins['test']==plan['testSha256']=='72669c897fe8c524528088acf3ee1448e44f8fc9745e3aa3687ac51737e14b98'
assert not (parent/'source'/plan['testFile']).exists()
for tree,freeze in [(repo,p['sourceFreeze']),(root/'source',p['composedFreeze']),(parent/'source',prior['composedFreeze'])]:
 for row in freeze:assert sha(tree/row['file'])==row['sha256'],row['file']
before={x['file']:x['sha256'] for x in prior['composedFreeze']};after={x['file']:x['sha256'] for x in p['composedFreeze']}
assert len(before)==1050 and len(after)==1051 and set(after)-set(before)=={plan['testFile']} and set(before).issubset(after);assert all(before[f]==after[f] for f in before)
assert len(p['sourceFreeze'])==994 and p['controlFreeze']==[] and p['excludedJunctions']==[] and len(p['inheritedExcludedJunctions'])==7
assert [sum(j['workspace']==x for j in p['junctions']) for x in [True,False]]==[23,134]
for j in p['junctions']:
 assert Path(j['source']).resolve(strict=True)==Path(j['target']).resolve(strict=True)
 if j['workspace']:assert Path(j['target']).resolve(strict=True).is_relative_to((root/'source').resolve())
assert len(plan['typeTests'])==len(set(plan['typeTests']))==50 and p['apiTypeTests']==plan['typeTests'] and len(plan['requiredResolvedSources'])==15
assert read(root/'tsconfig.test.json')=={'extends':'./source/apps/api/tsconfig.json','files':['./source/'+f for f in plan['typeTests']],'include':[]}
assert sha(root/'tsconfig.test.json')==pins['config']==handoff['configSha256']=='b850f49630223ed7e55332f6bb6b9ba18d50d969b44231821d0fd03a28c35538'
for name,key in [('prepare-organization-boundaries.mjs','prepare'),('run-types.mjs','types'),('fixed-recipe.json','recipe')]:assert sha(h/name)==pins[key];artifact(h/name)
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
  assert r['resolved']=={'requiredSourcesCount':15,'mfaReadListed':True,'requiredSourcesListed':True,'allTestsListed':True,'originalWorkspacePaths':[]}
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
assert r['preparedSha256']==sha(root/'prepared.json') and r['frozenManifestSha256']==sha(root/'source-pin.manifest.json');assert r['testFiles']==[{'name':'platform-mfa-organization-boundaries.test.ts','cases':36,'sha256':plan['testSha256']}]
assert all(r[k] for k in ['fixtureCleanupPassed','sourceHashesAfterMatch','ownedChildrenExited','runtimeUsesRestrictedConnections']);assert r['ownedChildrenWithoutExit']==[] and not r.get('cleanupHeldForOwnedProcessInspection',False) and not r.get('cleanupHeldOwnedPids',[]) and not r['credentialsPublished']
assert all(post[k] for k in ['systemIdentifierMatches','rolesRestoredIncludingPrivateCredentials','settingsRestored','containerAttestationMatches']);assert all(post[k]==0 for k in ['basePublicTables','temporaryDatabases','otherDatabases','otherClients']);assert post['roles']==6 and post['freeMiBAtStart']>=1536 and not post['computerRestarted'] and not post['credentialsPublished']
owned=read(root/'owned-database.json');assert owned['databaseName']==r['databaseName'] and owned['controllerPid']==r['controllerPid'] and re.fullmatch(r'ingest_runtime_[a-f0-9]{32}',r['databaseName'])
assert len(r['tests'])==1 and r['tests'][0]['label']=='platform-mfa-organization-boundaries'
for child in [r['provision'],r['seed'],*r['tests']]:
 assert child['exitCode']==0 and child['signal'] is None and child['exitObserved'];assert not any(child[k] for k in ['spawnError','timedOut','overflow','treeKillFailed','drainTimedOut'])
 logfile=root/(child['label']+'.log');assert sha(logfile)==child['logSha256'];artifact(logfile)
parsers=runpy.run_path(str(w/'verify-feature-commands-v2-results-20261109.py'));text=(root/'platform-mfa-organization-boundaries.log').read_text(encoding='utf-8');totals={k:parsers['summary'](text,k) for k in ['tests','suites','pass','fail','cancelled','skipped','todo']};assert totals=={'tests':36,'suites':1,'pass':36,'fail':0,'cancelled':0,'skipped':0,'todo':0}
for name in manifest['cases']:assert parsers['subtest'](text,name)[1]=='ok',name
awake=read(root/'awake-guard.json');assert awake['exitCode']==0 and awake['systemRequiredSet'] and awake['systemRequiredCleared'];assert not any(awake[k] for k in ['displayRequired','awayMode','permanentPowerSettingsChanged','computerRestarted'])
for f in [h/'PLAN.json',h/'AUTHORED-PINS.json',h/'executors-handoff.json',fixture/'manifest.json',root/'prepared.json',parent/'prepared.json',root/'tsconfig.test.json',root/'mfa-directed-result.json',root/'mfa-directed-postchecks.json',root/'owned-database.json',root/'awake-guard.json']:artifact(f)
report={'recordedOn':'2026-11-09','timeZone':'America/Sao_Paulo','status':'VERIFIED','verifierSha256':sha(Path(__file__)),'reviewedByRoot':True,'sourceFiles':1051,'typeFiles':50,'requiredResolvedSources':15,'runtimeProductModified':False,'existingTestsChanged':False,'changedSources':[plan['testFile']],'parentPreparedSha256':sha(parent/'prepared.json'),'preparedSha256':sha(root/'prepared.json'),'observedHead':head,'acceptedCounts':{'tap':36,'independentCases':36,'parentGroups':0,'suites':1},'totals':totals,'cases':manifest['cases'],'typeChecks':type_checks,'startedUtc':r['startedUtc'],'endedUtc':r['endedUtc'],'freeMiBAtStart':post['freeMiBAtStart'],'cleanupPassed':True,'temporarySystemActivityGuard':awake,'inputs':inputs,
 'scopeLimits':['One new36-case file; all1050 parent sources, product and previous tests preserved. No baseline comparison claimed for this test-only layer.', 'Sixteen ordinary local managers promoted by flag or global binding after real context SQL; no factor or unproved factor, success/conflict intents, both POST/PATCH. Same bearer/SID recovers using real enrollment/TOTP or one-use recovery code, then full original DTO/storage/audit or409 followed by success.', 'Four actual unique-index waits remove flag/global binding with MFA intact. Exact blocking owner observed and negative identity commit atomic with release. Only the externally committed competitor persists; command/audit remain unchanged.', 'Sixteen narrow AFTER triggers run after actual organization write or audit; proof/factor/binding loss or exception. Sequence witness verifies one invocation even after rollback. All organizations, domain audits, proof and hashed full factor/recovery state, bindings/flag restored. Temporary owner functions have restricted search_path and public EXECUTE revoked; catalog restored.', 'Earlier81 accepted cases remain separately evidenced and are not repeated or summed. Remaining domains, private cache, complete API/ingest and browser/native/hardware/operations acceptance remain pending. MFA068 candidate, main001-067 unchanged; no production or performance acceptance.'],'computerRestarted':False,'performanceAssessed':False,'productionAccepted':False}
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');print(json.dumps({'proof':sha(out),'verifier':sha(Path(__file__)),'totals':totals,'head':head}))
