export type List<T> = { items: T[] };
export type Building = {
  id: string;
  name: string;
  code: string;
  timezone?: string;
};
export type Notice = {
  id: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  publishedAt: string;
};
export type Ticket = {
  id: string;
  protocol: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  createdAt: string;
  openedBy: string | null;
  location: string | null;
  unit: string | null;
};
export type TicketDetail = Ticket & {
  timeline: Array<{
    id: string;
    kind: string;
    message: string;
    createdAt: string;
  }>;
};
export type CommonArea = {
  id: string;
  name: string;
  capacity: number | null;
  requiresApproval: boolean;
  opensAt: string;
  closesAt: string;
  maxHoursPerBooking: number;
};
export type Reservation = {
  id: string;
  areaId: string;
  startsAt: string;
  endsAt: string;
  status: string;
};
export type AlertRow = {
  id: string;
  message: string;
  severity: string;
  status: string;
  triggeredAt: string;
};
export type Reading = {
  device_id: string;
  device_name: string;
  metric: string;
  value: string | number | boolean;
  numeric_value: number | null;
  unit: string | null;
  quality: string;
  time: string;
};
