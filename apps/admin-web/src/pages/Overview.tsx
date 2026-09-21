import { AlertTriangle, Building2, Cpu, RadioTower, ShieldCheck, Users } from "lucide-react";
import { Badge, Card, ErrorBanner, PageHeading, ResourceFeedback, StatTile, useResource } from "@predioon/ui";

type PlatformOverview = {
  counts: Record<string, string>;
  buildings: Array<{
    id: string;
    name: string;
    code: string;
    organization_name: string;
    gateways: string;
    gateways_online: string;
    devices: string;
    open_alerts: string;
  }>;
};

export function Overview() {
  const overview = useResource<PlatformOverview>("/overview/platform");
  const counts = overview.data?.counts ?? {};

  return (
    <>
      <PageHeading title="Visão geral dos condomínios" description="Acompanhe sua carteira, a comunicação dos equipamentos e os alertas." />
      {overview.error && <ErrorBanner message={overview.error} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Clientes" value={counts.organizations ?? "0"} icon={ShieldCheck} />
        <StatTile label="Prédios" value={counts.buildings ?? "0"} icon={Building2} />
        <StatTile
          label="Gateways online"
          value={`${counts.gateways_online ?? 0}/${counts.gateways ?? 0}`}
          icon={RadioTower}
          tone={counts.gateways_online === counts.gateways ? "success" : "warning"}
        />
        <StatTile label="Dispositivos online" value={`${counts.devices_online ?? 0}/${counts.devices ?? 0}`} icon={Cpu} />
        <StatTile
          label="Alertas abertos"
          value={counts.open_alerts ?? "0"}
          detail={`${counts.critical_alerts ?? 0} críticos`}
          icon={AlertTriangle}
          tone={Number(counts.critical_alerts ?? 0) > 0 ? "danger" : "neutral"}
        />
      </div>

      <Card title="Carteira de prédios" subtitle="Ordenado pelos que têm mais alertas abertos">
        {overview.data?.buildings.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="pb-3 font-medium">Prédio</th>
                  <th className="pb-3 font-medium">Cliente</th>
                  <th className="pb-3 font-medium">Gateways</th>
                  <th className="pb-3 font-medium">Dispositivos</th>
                  <th className="pb-3 font-medium">Alertas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview.data.buildings.map((building) => (
                  <tr key={building.id}>
                    <td className="py-3">
                      <p className="font-medium text-slate-800">{building.name}</p>
                      <p className="text-xs text-slate-400">{building.id}</p>
                    </td>
                    <td className="text-slate-600">{building.organization_name}</td>
                    <td className="text-slate-600">
                      {building.gateways_online}/{building.gateways}
                    </td>
                    <td className="text-slate-600">{building.devices}</td>
                    <td>
                      {Number(building.open_alerts) > 0 ? (
                        <Badge tone="danger">{building.open_alerts}</Badge>
                      ) : (
                        <Badge tone="success">0</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ResourceFeedback resource={overview} emptyText="Nenhum prédio cadastrado." />
        )}
      </Card>

      <Card title="Usuários" subtitle="Contas ativas na plataforma">
        <div className="flex items-center gap-3">
          <Users className="text-slate-400" />
          <p className="text-2xl font-bold text-slate-900">{counts.users ?? "0"}</p>
        </div>
      </Card>
    </>
  );
}
