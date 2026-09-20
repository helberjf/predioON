import { Badge, Card, EmptyState, formatRelative, useResource } from "@predioon/ui";
import type { Device, Paged } from "@predioon/ui";

export function Devices({ buildingId }: { buildingId: string }) {
  const devices = useResource<Paged<Device>>(`/devices?buildingId=${buildingId}`);

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Dispositivos</h1>
      <Card subtitle="Sensores e monitores ligados ao gateway" title="Equipamentos do prédio">
        {devices.data?.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="pb-3 font-medium">Dispositivo</th>
                  <th className="pb-3 font-medium">Tipo</th>
                  <th className="pb-3 font-medium">Gateway</th>
                  <th className="pb-3 font-medium">Última leitura</th>
                  <th className="pb-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {devices.data.items.map((device) => (
                  <tr key={device.id}>
                    <td className="py-3">
                      <p className="font-medium text-slate-800">{device.name}</p>
                      <p className="text-xs text-slate-400">{device.id}</p>
                    </td>
                    <td className="text-slate-600">{device.type}</td>
                    <td className="text-slate-600">{device.gatewayId ?? "—"}</td>
                    <td className="text-slate-600">{formatRelative(device.lastSeenAt)}</td>
                    <td>
                      <Badge>{device.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text={devices.error ?? "Nenhum dispositivo cadastrado."} />
        )}
      </Card>
    </>
  );
}
