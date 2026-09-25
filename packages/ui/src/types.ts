export type Device = {
  id: string;
  buildingId: string;
  gatewayId: string | null;
  name: string;
  type: string;
  status: string;
  enabled: boolean;
  lastSeenAt: string | null;
};

export type Gateway = { id: string; name: string; status: string; last_seen_at: string | null };

export type Alert = {
  id: string;
  buildingId: string;
  deviceId: string | null;
  gatewayId: string | null;
  severity: string;
  type: string;
  status: string;
  message: string;
  triggeredAt: string;
  createdAt: string;
};

export type LatestReading = {
  device_id: string;
  device_name: string;
  metric: string;
  value: number | boolean | string;
  numeric_value: number | null;
  unit: string | null;
  quality: string;
  time: string;
};

export type SeriesPoint = {
  bucket: string;
  avg_value: number | null;
  min_value: number | null;
  max_value: number | null;
  samples: string;
};

export type BuildingOverview = {
  buildingId: string;
  counts: Record<string, string | number>;
  latestAlerts: Array<{
    id: string;
    device_id: string | null;
    severity: string;
    type: string;
    status: string;
    message: string;
    triggered_at: string;
  }>;
  gateways: Gateway[];
};

export type AlertRule = {
  id: string;
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  severity: string;
  alertType: string;
  cooldownSeconds: number;
  enabled: boolean;
  deviceId: string | null;
};

export type Occurrence = {
  id: string;
  groupId: string | null;
  updatedAt: string;
  protocol: string;
  category: string;
  title: string;
  description: string;
  location: string | null;
  unit: string | null;
  priority: string;
  status: string;
  openedBy: string | null;
  createdAt: string;
};

export type Notice = {
  id: string;
  category: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
};

export type CommonArea = {
  id: string;
  name: string;
  capacity: number | null;
  opensAt: string;
  closesAt: string;
  requiresApproval: boolean;
  maxHoursPerBooking: number;
};

export type Reservation = {
  id: string;
  areaId: string;
  userId: string;
  unit: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  notes: string | null;
};

export type Paged<T> = { items: T[] };
