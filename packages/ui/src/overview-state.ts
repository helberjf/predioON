import type { BuildingOverview, OverviewCoverage } from "@predioon/contracts";
import type { FeatureKey, FeatureState } from "@predioon/shared";
/** The caller obtains these states from the canonical sensor reading helper. */
export type OverviewObservation={deviceId:string;state:'missing'|'invalid'|'stale'|'disabled'|'detected'|'clear'|'reading'};
type MonitoringOverview=Pick<BuildingOverview,'counts'|'coverage'>;
type DisplayState={tone:'neutral'|'success'|'warning';label:string};
export function overviewOccurrenceState(overview:Pick<BuildingOverview,'counts'|'coverage'|'occurrenceVisibility'>|null|undefined,options:{error?:boolean;paused?:boolean}={}):{label:string;count:string|null} {
  const unavailable={label:'Acompanhar ocorrências',count:null};
  if(!overview||options.error||options.paused||overview.coverage.occurrences==='none'||overview.occurrenceVisibility==='none'||overview.counts.open_occurrences==null)return unavailable;
  const label=overview.occurrenceVisibility==='own'?'Seus chamados abertos':overview.occurrenceVisibility==='all'&&overview.coverage.occurrences==='whole'?'Chamados abertos':'Chamados abertos no seu escopo';
  return {label,count:String(overview.counts.open_occurrences)};
}
type MonitoringFeatureState=Pick<FeatureState,'key'|'enabled'>;
/** Relevant domains come from the canonical catalog and inventory supplied by the caller. */
export function overviewMonitoringPaused(featureStates:readonly MonitoringFeatureState[]|null|undefined,monitoredFeatureKeys:readonly FeatureKey[]):boolean {
  return !featureStates||monitoredFeatureKeys.some(key=>featureStates.find(feature=>feature.key===key)?.enabled!==true);
}
export function overviewCountLabel(count:number|null|undefined,coverage:OverviewCoverage='none'):string {
  return count==null||coverage==='none'?'Indisponível':coverage==='partial'?`${count} no seu escopo`:String(count);
}
export function overviewRatio(online:number|null|undefined,total:number|null|undefined,coverage:OverviewCoverage='none'):number|null {
  return coverage==='none'||online==null||total==null||total===0?null:online/total*100;
}
export function overviewCommunicationState(online:number|null|undefined,total:number|null|undefined,coverage:OverviewCoverage='none'):DisplayState {
  if(coverage==='none'||online==null||total==null)return {tone:'neutral',label:'Indisponível'};
  if(coverage==='partial')return {tone:'neutral',label:'Comunicação no seu escopo'};
  if(total===0)return {tone:'neutral',label:'Nenhum gateway cadastrado'};
  return online>0?{tone:'success',label:'Conectado'}:{tone:'neutral',label:'Sem conexão'};
}
export function overviewMonitoringState(overview:MonitoringOverview|undefined,observations:readonly OverviewObservation[],options:{error?:boolean;paused?:boolean;featureStates?:readonly MonitoringFeatureState[]|null;monitoredFeatureKeys?:readonly FeatureKey[];inventoryComplete?:boolean;inventoryDeviceIds?:readonly string[]}={}):DisplayState {
  if(!overview||options.error)return {tone:'neutral',label:'Monitoramento indisponível'};
  const {counts,coverage}=overview;
  if(counts.open_alerts!=null&&counts.open_alerts>0)return {tone:'warning',label:`${counts.open_alerts} alerta${counts.open_alerts===1?' precisa':'s precisam'} de atenção${coverage.alerts==='partial'?' no seu escopo':''}`};
  const complete=[coverage.devices,coverage.gateways,coverage.alerts,coverage.telemetry].every(c=>c==='whole');
  const fresh=observations.length>0&&observations.every(r=>r.state==='reading'||r.state==='clear');
  const observed=new Set(observations.map(r=>r.deviceId)).size;
  const expected=new Set(options.inventoryDeviceIds??[]);
  const inventoryProven=options.inventoryComplete&&expected.size===counts.devices&&[...expected].every(id=>observations.some(o=>o.deviceId===id))&&observations.every(o=>expected.has(o.deviceId));
  const paused=options.paused||(options.monitoredFeatureKeys!==undefined&&overviewMonitoringPaused(options.featureStates,options.monitoredFeatureKeys));
  if(complete&&inventoryProven&&!paused&&fresh&&counts.devices!=null&&counts.devices>0&&observed===counts.devices&&counts.devices_online===counts.devices&&counts.gateways!=null&&counts.gateways>0&&counts.gateways_online===counts.gateways&&counts.open_alerts===0)
    return {tone:'success',label:'Tudo em dia no monitoramento!'};
  return {tone:'neutral',label:complete?'Acompanhe a atualização dos sensores':'Monitoramento parcial ou indisponível'};
}
