import { Badge, Card, EmptyState, formatDateTime, useResource } from "@predioon/ui";
import type { Notice, Paged } from "@predioon/ui";

const LABELS: Record<string, string> = {
  COMMUNICATION: "Comunicado",
  MAINTENANCE: "Manutenção",
  EVENT: "Evento",
  WASTE_COLLECTION: "Coleta de lixo",
};

export function Notices({ buildingId }: { buildingId: string }) {
  const notices = useResource<Paged<Notice>>(`/notices?buildingId=${buildingId}`);

  if (!notices.data?.items.length) {
    return (
      <Card title="Avisos">
        <EmptyState text={notices.error ?? "Nenhum aviso publicado."} />
      </Card>
    );
  }

  return (
    <>
      {notices.data.items.map((notice) => (
        <Card key={notice.id}>
          <div className="flex items-center gap-2">
            <Badge tone="info">{LABELS[notice.category] ?? notice.category}</Badge>
            {notice.pinned && <Badge tone="warning">fixado</Badge>}
          </div>
          <h2 className="mt-2 font-semibold text-slate-900">{notice.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{notice.body}</p>
          <p className="mt-3 text-xs text-slate-400">{formatDateTime(notice.publishedAt)}</p>
        </Card>
      ))}
    </>
  );
}
