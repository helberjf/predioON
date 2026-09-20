import { Card, EmptyState, formatDateTime, useResource } from "@predioon/ui";

type AuditRow = {
  id: string;
  buildingId: string | null;
  userId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
};

export function Audit() {
  const logs = useResource<{ items: AuditRow[] }>("/audit?limit=100");

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Auditoria</h1>
      <Card title="Ações registradas" subtitle="Quem mudou o quê, e quando">
        {logs.data?.items.length ? (
          <ul className="divide-y divide-slate-100">
            {logs.data.items.map((log) => (
              <li key={log.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{log.action}</p>
                  <p className="truncate text-xs text-slate-400">
                    {log.actorType} · {log.userId ?? "sistema"} · {log.resourceType}
                    {log.resourceId ? `:${log.resourceId}` : ""}
                    {log.buildingId ? ` · ${log.buildingId}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-xs text-slate-400">{formatDateTime(log.createdAt)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState text={logs.error ?? "Nenhum registro de auditoria."} />
        )}
      </Card>
    </>
  );
}
