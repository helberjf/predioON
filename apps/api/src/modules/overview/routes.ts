import { Router } from "express";
import { sql } from "drizzle-orm";
import { readFeatures } from "@predioon/db/runtime";
import type { BuildingOverview, OverviewCoverage, PlatformOverview } from "@predioon/contracts";
import { z } from "zod";
import { assertGlobalCapability, inTenantContext } from "../../auth/middleware.js";
import { query, validateQuery } from "../../http/validate.js";
import { forbidden, pgErrorCode } from "../../http/errors.js";
import { alertFeatureKeys, authorizedAlertContexts, type AlertContext } from "../alerts/authorization.js";
import { buildingOverviewScope, type OverviewScope } from "./authorization.js";

export const overviewRouter = Router();
const BuildingQuerySchema = z.object({ buildingId: z.string().min(1) });

overviewRouter.get("/platform", async (req, res) => {
  const payload = await inTenantContext(req, async tx => {
    await assertGlobalCapability(tx,"platform:read-health");
    const data=await (async()=>{
      try {const [row]=await tx.execute(sql`select app_overview_platform_health() as payload`);return row.payload as PlatformOverview;}
      catch(error){if(pgErrorCode(error)==='42501')throw forbidden("Sem a capacidade global necessária");throw error;}
    })();
    // A fresh statement protects a cached aggregate and independently protects
    // the identified directory if permission changes during the read.
    const [current]=await tx.execute(sql`select app_has_global_capability('platform:read-health') health,app_has_global_capability('buildings:read') directory`);
    if(!current.health)throw forbidden("Sem a capacidade global necessária");
    if(!current.directory){data.directoryAvailability='unavailable';data.buildings=null;}
    return data;
  });
  res.json(payload);
});

type DeviceStatus={id:string;status:string};
type GatewayStatus={id:string;name:string;status:string;last_seen_at:string|null};
type LocalAlert=BuildingOverview['latestAlerts'][number];
type Revalidation={scope:OverviewScope;devices:string[];gateways:string[];alerts:AlertContext[]};
// A new grant after an earlier partial read cannot upgrade cached coverage.
function intersection(before:OverviewCoverage,after:OverviewCoverage):OverviewCoverage {
  return before==='none'||after==='none'?'none':before==='whole'&&after==='whole'?'whole':'partial';
}

overviewRouter.get("/building", validateQuery(BuildingQuerySchema), async (req, res) => {
  const {buildingId}=query<z.infer<typeof BuildingQuerySchema>>(req);
  const payload=await inTenantContext(req,async tx=>{
    const initial=await buildingOverviewScope(tx,buildingId);
    const devices:DeviceStatus[]=initial.devices==='none'?[]:await tx.execute(sql`select id,status::text from devices where building_id=${buildingId}`) as unknown as DeviceStatus[];
    const gateways:GatewayStatus[]=initial.gateways==='none'?[]:await tx.execute(sql`select id,name,status::text,last_seen_at from gateways where building_id=${buildingId} order by name,id`) as unknown as GatewayStatus[];
    const candidates:LocalAlert[]=initial.alerts==='none'?[]:await tx.execute(sql`select id,device_id,severity::text,type,status::text,message,triggered_at from alerts where building_id=${buildingId} and status<>'RESOLVED' order by triggered_at desc,id desc`) as unknown as LocalAlert[];
    const contexts=initial.alerts==='none'?[]:await authorizedAlertContexts(tx,buildingId);
    // Feature state is readable only after current alert domain authorization;
    // the shared feature lock remains held through final resource validation.
    const authorizedBeforeFeatures=await buildingOverviewScope(tx,buildingId);
    const features=initial.alerts!=='none'&&authorizedBeforeFeatures.alerts!=='none'?await readFeatures(tx,buildingId):null;
    const [row]=await tx.execute(sql`select
      (select to_jsonb(s) from app_overview_building_scope(${buildingId}) s) scope,
      coalesce((select jsonb_agg(d.id) from devices d where d.building_id=${buildingId}),'[]'::jsonb) devices,
      coalesce((select jsonb_agg(g.id) from gateways g where g.building_id=${buildingId}),'[]'::jsonb) gateways,
      coalesce((select jsonb_agg(to_jsonb(a)) from app_alert_authorized_contexts(${buildingId},null) a),'[]'::jsonb) alerts`);
    const current=row as Revalidation;
    if(!current.scope.basic&&[current.scope.devices,current.scope.gateways,current.scope.alerts,current.scope.telemetry].every(value=>value==='none'))throw forbidden("Prédio fora do seu escopo");
    const coverage:BuildingOverview['coverage']={devices:intersection(initial.devices,current.scope.devices),gateways:intersection(initial.gateways,current.scope.gateways),
      alerts:intersection(intersection(initial.alerts,authorizedBeforeFeatures.alerts),current.scope.alerts),telemetry:intersection(initial.telemetry,current.scope.telemetry),occurrences:'none'};
    const deviceIds=new Set(current.devices),gatewayIds=new Set(current.gateways),originalContexts=new Set(contexts.map(c=>c.alert_id));
    const currentContexts=new Map(current.alerts.map(c=>[c.alert_id,c]));
    const visibleDevices=coverage.devices==='none'?[]:devices.filter(d=>deviceIds.has(d.id));
    const visibleGateways=coverage.gateways==='none'?[]:gateways.filter(g=>gatewayIds.has(g.id));
    const visibleAlerts=coverage.alerts==='none'||!features?[]:candidates.filter(a=>{
      const context=currentContexts.get(a.id);
      return context&&originalContexts.has(a.id)&&alertFeatureKeys(context,a.type).every(key=>features[key].enabled);
    });
    return {buildingId,coverage,counts:{devices:coverage.devices==='none'?null:visibleDevices.length,devices_online:coverage.devices==='none'?null:visibleDevices.filter(d=>d.status==='ONLINE').length,
      gateways:coverage.gateways==='none'?null:visibleGateways.length,gateways_online:coverage.gateways==='none'?null:visibleGateways.filter(g=>g.status==='ONLINE').length,
      open_alerts:coverage.alerts==='none'?null:visibleAlerts.length,open_occurrences:null},latestAlerts:visibleAlerts.slice(0,10),gateways:visibleGateways} satisfies BuildingOverview;
  });
  res.json(payload);
});
