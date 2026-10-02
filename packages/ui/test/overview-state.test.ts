import assert from "node:assert/strict";
import { test } from "node:test";
const helpers = await import("../src/overview-state.ts");
const full={buildingId:'a',coverage:{devices:'whole',gateways:'whole',alerts:'whole',telemetry:'whole',occurrences:'none'},counts:{devices:1,devices_online:1,gateways:1,gateways_online:1,open_alerts:0,open_occurrences:null},latestAlerts:[],gateways:[]} as const;
test('missing/error data and unreadable zero-looking counts are neutral',()=>{
  assert.equal(helpers.overviewMonitoringState(undefined,[],{}).tone,'neutral');
  assert.equal(helpers.overviewMonitoringState(full,[],{error:true}).tone,'neutral');
  assert.equal(helpers.overviewCountLabel(null,'none'),'Indisponível');
  assert.equal(helpers.overviewCountLabel(0,'whole'),'0');
  assert.equal(helpers.overviewCountLabel(0,'partial'),'0 no seu escopo');
  assert.equal(helpers.overviewRatio(null,null,'none'),null);
});
test('partial inventory or alerts never report complete monitoring health',()=>{
  const fresh=[{deviceId:'d',state:'reading'}] as const;
  for(const domain of ['devices','gateways','alerts','telemetry'])assert.equal(helpers.overviewMonitoringState({...full,coverage:{...full.coverage,[domain]:'partial'}},fresh,{inventoryComplete:true}).tone,'neutral');
  assert.equal(helpers.overviewMonitoringState(full,fresh,{inventoryComplete:true,inventoryDeviceIds:['d']}).tone,'success');
});
test('paused, stale, absent, invalid and bad-quality readings do not claim health',()=>{
  for(const state of ['missing','invalid','stale','disabled','detected'] as const)assert.equal(helpers.overviewMonitoringState(full,[{deviceId:'d',state}],{inventoryComplete:true}).tone,'neutral');
  assert.equal(helpers.overviewMonitoringState(full,[],{inventoryComplete:true}).tone,'neutral');
  assert.equal(helpers.overviewMonitoringState(full,[{deviceId:'d',state:'reading'}],{paused:true,inventoryComplete:true}).tone,'neutral');
});
test('whole rights require a complete inventory and observations for every sensor',()=>{
  const fresh=[{deviceId:'d',state:'reading'}] as const;
  assert.equal(helpers.overviewMonitoringState(full,fresh,{}).tone,'neutral');
  assert.equal(helpers.overviewMonitoringState({...full,counts:{...full.counts,devices:2,devices_online:2}},fresh,{inventoryComplete:true}).tone,'neutral');
  assert.equal(helpers.overviewMonitoringState({...full,counts:{...full.counts,devices:2,devices_online:2}},[...fresh,...fresh],{inventoryComplete:true}).tone,'neutral');
  assert.equal(helpers.overviewMonitoringState(full,[{deviceId:'other-device',state:'reading'}],{inventoryComplete:true,inventoryDeviceIds:['d']}).tone,'neutral');
});
test('unavailable communications differ from authorized empty/offline inventory',()=>{
  assert.equal(helpers.overviewCommunicationState(null,null,'none').label,'Indisponível');
  assert.equal(helpers.overviewCommunicationState(0,0,'whole').label,'Nenhum gateway cadastrado');
  assert.equal(helpers.overviewCommunicationState(0,1,'whole').label,'Sem conexão');
  assert.equal(helpers.overviewCommunicationState(1,1,'partial').tone,'neutral');
});

const monitoringFeatures=['WATER_TANK','WATER_CONSUMPTION','ENERGY_CONSUMPTION','ELECTRICAL','PUMP','WATER_LEAK','SEWAGE_LEAK','SMOKE','TEMPERATURE','GAS','AI_ANALYSIS'] as const;
const enabledMonitoringFeatures=monitoringFeatures.map(key=>({key,enabled:true}));
const meterVoltage=[{deviceId:'energy-meter',state:'reading'}] as const;
const completeMeterInventory={inventoryComplete:true,inventoryDeviceIds:['energy-meter'],monitoredFeatureKeys:monitoringFeatures};
test('fresh voltage from a mixed-feature meter cannot hide a paused monitoring domain',()=>{
  for(const pausedKey of ['ENERGY_CONSUMPTION','WATER_CONSUMPTION','AI_ANALYSIS'] as const){
    const featureStates=enabledMonitoringFeatures.map(feature=>({...feature,enabled:feature.key!==pausedKey}));
    const presentation=helpers.overviewMonitoringState(full,meterVoltage,{...completeMeterInventory,featureStates});
    assert.equal(presentation.tone,'neutral',`${pausedKey} must prevent a healthy overall presentation`);
    assert.notEqual(presentation.label,'Tudo em dia no monitoramento!');
  }
});
test('fresh complete monitoring is healthy when every relevant feature is enabled',()=>{
  assert.equal(helpers.overviewMonitoringState(full,meterVoltage,{...completeMeterInventory,featureStates:enabledMonitoringFeatures}).tone,'success');
});
test('missing or unknown relevant feature states cannot claim monitoring health',()=>{
  for(const featureStates of [undefined,null,[],enabledMonitoringFeatures.filter(feature=>feature.key!=='ENERGY_CONSUMPTION')]){
    assert.equal(helpers.overviewMonitoringState(full,meterVoltage,{...completeMeterInventory,featureStates}).tone,'neutral');
  }
});
test('unrelated routine feature pauses do not suppress healthy monitoring',()=>{
  const featureStates=[...enabledMonitoringFeatures,{key:'NOTICES',enabled:false},{key:'RESERVATIONS',enabled:false}] as const;
  assert.equal(helpers.overviewMonitoringState(full,meterVoltage,{...completeMeterInventory,featureStates}).tone,'success');
});
