/** Public JSON contracts for physical assets and their maintenance history. */
export type AssetCategory = "PUMP" | "ELEVATOR" | "GENERATOR" | "GATE" | "HVAC" | "FIRE_SAFETY" | "ELECTRICAL" | "PLUMBING" | "OTHER";

export type AssetView = {
  id: string; buildingId: string; name: string; category: AssetCategory; location: string;
  manufacturer: string; model: string; serialNumber: string;
  /** Calendar date, `YYYY-MM-DD`. */
  installedOn: string | null;
  notes: string; active: boolean; version: number; createdAt: string; updatedAt: string;
};
export type AssetDeviceView = { id: string; name: string; type: string };
export type AssetWorkOrderView = { id: string; title: string; status: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED"; priority: "LOW" | "NORMAL" | "HIGH" | "URGENT"; createdAt: string; closedAt: string | null };
/** `workOrders` holds only the orders the caller may see. */
export type AssetDetail = AssetView & { devices: AssetDeviceView[]; workOrders: AssetWorkOrderView[] };
export type AssetListResponse = { items: AssetView[]; nextCursor: string | null; canManage: boolean };

type AssetFields = { name: string; category: AssetCategory; location: string; manufacturer: string; model: string; serialNumber: string; installedOn: string | null; notes: string };
export type CreateAssetRequest = { buildingId: string; name: string } & Partial<Omit<AssetFields, "name">>;
/** `version` is the one last read; a stale value is answered with 409. */
export type UpdateAssetRequest = { version: number; active?: boolean } & Partial<AssetFields>;
export type ReplaceAssetDevicesRequest = { deviceIds: string[] };
