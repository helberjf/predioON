import { useEffect, useRef, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import type { AccessGateView, GateTotemView, TotemPairingView } from "@predioon/shared";
import { api } from "../api.js";
import { Badge, Button, ErrorBanner } from "./primitives.js";

/** The totem asks every minute; a few missed rounds mean it is off or offline. */
const STALE_MS = 3 * 60_000;

type QrGate = AccessGateView & { qr: NonNullable<AccessGateView["qr"]> };

function contact(totem: GateTotemView, now: number): { text: string; stale: boolean } {
  if (!totem.lastSeenAt) return { text: "Ainda não mostrou o QR", stale: true };
  const seen = new Date(totem.lastSeenAt).getTime();
  if (now - seen > STALE_MS)
    return { text: `Sem contato há ${Math.round((now - seen) / 60_000)} min`, stale: true };
  return { text: `Último contato às ${new Date(seen).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, stale: false };
}

/** Tablets that show this gate's hourly QR. Only managers see it, and only with the add-on on. */
export function GateTotemSection({ gate, onChanged }: { gate: QrGate; onChanged: () => void }) {
  const [pairing, setPairing] = useState<TotemPairingView | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const now = Date.now();

  async function run(action: () => Promise<unknown>, done?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir a ação.");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  return (
    <section aria-label={`Totens de ${gate.name}`} className="space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <MonitorSmartphone size={18} className="text-emerald-600" />
        QR do totem
        {gate.requireQr && <Badge tone="info">Exigido para moradores</Badge>}
      </div>
      <p className="text-xs text-slate-500">
        O tablet mostra um QR que muda a cada hora. O morador lê o QR pelo app e confirma a abertura.
      </p>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">{notice}</p>}
      {gate.qr.totems.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {gate.qr.totems.map((totem) => {
            const state = contact(totem, now);
            return (
              <li key={totem.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium text-slate-800">{totem.label}</p>
                  <p className={state.stale ? "text-xs text-amber-700" : "text-xs text-slate-500"}>{state.text}</p>
                </div>
                {confirming === totem.id ? (
                  <div className="flex gap-2">
                    <Button variant="danger" disabled={busy}
                      onClick={() => void run(() => api.delete(`/access/${gate.id}/totems/${totem.id}`), `${totem.label} foi despareado.`)}>
                      Confirmar
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>Cancelar</Button>
                  </div>
                ) : (
                  <Button variant="secondary" disabled={busy} onClick={() => setConfirming(totem.id)}>Desparear</Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">Nenhum tablet pareado para este portão.</p>
      )}
      {confirming === "renew" && (
        <p role="alert" className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          O QR mostrado agora deixa de funcionar em todos os tablets deste portão, inclusive fotos dele. Os tablets
          passam a mostrar o novo QR em até um minuto.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy}
          onClick={() => void run(async () => setPairing(await api.post<TotemPairingView>(`/access/${gate.id}/totems/pairing`, {})))}>
          Parear tablet
        </Button>
        {confirming === "renew" ? (
          <>
            <Button variant="danger" disabled={busy}
              onClick={() => void run(() => api.post(`/access/${gate.id}/qr/renew`, {}), "Código renovado. O QR anterior não abre mais.")}>
              Confirmar renovação
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>Cancelar</Button>
          </>
        ) : (
          <Button variant="secondary" disabled={busy || !gate.qr.totems.length} onClick={() => setConfirming("renew")}>
            Renovar código agora
          </Button>
        )}
      </div>
      {pairing && <PairingDialog gateName={gate.name} pairing={pairing} onClose={() => { setPairing(null); onChanged(); }} />}
    </section>
  );
}

function PairingDialog({ gateName, pairing, onClose }: { gateName: string; pairing: TotemPairingView; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    dialog.current?.showModal();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      dialog.current?.close();
    };
  }, []);
  const left = Math.max(0, new Date(pairing.expiresAt).getTime() - now);
  const minutes = Math.floor(left / 60_000), seconds = Math.floor((left % 60_000) / 1000);
  return (
    <dialog
      ref={dialog}
      aria-label={`Parear tablet de ${gateName}`}
      className="w-full max-w-md rounded-xl border border-slate-200 p-6 shadow-xl backdrop:bg-slate-900/40"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 className="text-lg font-semibold">Parear tablet de {gateName}</h2>
      <ol className="my-4 list-decimal space-y-2 pl-5 text-sm text-slate-600">
        <li>No tablet do portão, abra <strong className="break-all">{`${window.location.origin}/totem`}</strong>.</li>
        <li>Digite o código abaixo e um nome para o tablet.</li>
      </ol>
      <p aria-label="Código de pareamento" className="rounded-lg bg-slate-100 p-4 text-center font-mono text-3xl font-semibold tracking-widest text-slate-900">
        {pairing.pairingCode}
      </p>
      <p role="timer" className="mt-2 text-center text-xs text-slate-500">
        {left > 0
          ? `Vale por mais ${minutes}:${String(seconds).padStart(2, "0")} e só funciona uma vez.`
          : "O código expirou. Feche e gere outro."}
      </p>
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>Fechar</Button>
      </div>
    </dialog>
  );
}
