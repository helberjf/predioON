/** Counts represent authorized inventory/status; none is unavailable, never zero. */
export type OverviewCoverage = "whole" | "partial" | "none";
export type OverviewCounts = {
  devices: number | null; devices_online: number | null;
  gateways: number | null; gateways_online: number | null;
  open_alerts: number | null; open_occurrences: null;
};
export type BuildingOverview = {
  buildingId: string;
  coverage: { devices: OverviewCoverage; gateways: OverviewCoverage; alerts: OverviewCoverage; telemetry: OverviewCoverage; occurrences: "none" };
  counts: OverviewCounts;
  latestAlerts: Array<{id:string;device_id:string|null;severity:string;type:string;status:string;message:string;triggered_at:string}>;
  gateways: Array<{id:string;name:string;status:string;last_seen_at:string|null}>;
};
export type PlatformHealthCounts = {
  organizations:number;buildings:number;users:number;devices:number;devices_online:number;
  gateways:number;gateways_online:number;open_alerts:number;critical_alerts:number;
};
export type PlatformHealthCategory = {type:string;devices:number;devices_online:number};
export type PlatformHealthBuilding = Pick<PlatformHealthCounts,"devices"|"devices_online"|"gateways"|"gateways_online"|"open_alerts"|"critical_alerts"> & {
  id:string;name:string;code:string;organization_name:string;categories:PlatformHealthCategory[];
};
export type PlatformOverview = {
  counts:PlatformHealthCounts;categories:PlatformHealthCategory[];
  directoryAvailability:"available"|"unavailable";
  /** null means the directory is unavailable; [] means authorized empty. */
  buildings:PlatformHealthBuilding[]|null;
};
