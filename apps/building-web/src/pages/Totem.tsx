// The totem tablet at the gate. It has no user session: pairing gives it a token
// that only lets it draw this gate's hourly QR. Opening still needs a resident's
// own session in the app, which reads the QR and confirms on the server.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import qrcode from "qrcode-generator";
import { GATE_QR_WINDOW_MS, type TotemDisplay } from "@predioon/shared";

const API_URL = (import.meta.env?.VITE_API_URL as string | undefined) ?? "http://localhost:3000";
const TOKEN_KEY = "predioon.totem";
const REFRESH_MS = 60_000;

type State =
  | { kind: "loading" }
  | { kind: "pairing"; message?: string }
  | { kind: "showing"; display: TotemDisplay; offsetMs: number }
  | { kind: "unavailable"; message: string };

// Storage can be missing or blocked (private mode, kiosk policies); the page then asks to pair again.
function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* The token then lives only until the page reloads. */ }
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error ?? fallback;
  } catch { return fallback; }
}

export function TotemScreen() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(Date.now());
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    const token = readToken();
    if (!token) { setState({ kind: "pairing" }); return; }
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch(`${API_URL}/totem/display`, {
        headers: { Authorization: `Totem ${token}` }, credentials: "omit", cache: "no-store",
      });
      if (response.status === 401) {
        writeToken(null);
        setState({ kind: "pairing", message: "Este tablet foi despareado. Peça um novo código à administração do condomínio." });
      } else if (!response.ok) {
        setState({ kind: "unavailable", message: await errorMessage(response, "QR indisponível no momento.") });
      } else {
        const display = await response.json() as TotemDisplay;
        // The QR changes on the server's clock, not on this tablet's.
        setState({ kind: "showing", display, offsetMs: new Date(display.serverTime).getTime() - Date.now() });
      }
      setOffline(false);
    } catch {
      // Keep the QR already on screen; it is valid until its own hour ends.
      setOffline(true);
      setState(current => current.kind === "loading" ? { kind: "unavailable", message: "Sem conexão com o Prédio ON." } : current);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(poll); clearInterval(clock); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);

  useWakeLock(state.kind === "showing");

  if (state.kind === "loading") return <Frame><p className="text-lg text-slate-300">Carregando…</p></Frame>;
  if (state.kind === "pairing") return <Pairing message={state.message} onPaired={() => void refresh()} />;
  if (state.kind === "unavailable") return <Frame><Notice title="QR indisponível" text={state.message} /></Frame>;
  return <QrDisplay display={state.display} now={now + state.offsetMs} offline={offline} onBoundary={() => void refresh()} />;
}

function QrDisplay({ display, now, offline, onBoundary }: { display: TotemDisplay; now: number; offline: boolean; onBoundary: () => void }) {
  const boundary = new Date(display.current.validUntil).getTime();
  // Past the boundary the next hour's QR is already valid, for one hour.
  const showing = now < boundary ? display.current.content : display.next.content;
  const switchesAt = now < boundary ? boundary : boundary + GATE_QR_WINDOW_MS;
  const expired = now >= boundary + GATE_QR_WINDOW_MS;
  const asked = useRef<number | null>(null);
  // Fetch the new pair as soon as the hour turns, so "next" is ready again.
  useEffect(() => {
    if (now >= boundary && asked.current !== boundary) { asked.current = boundary; onBoundary(); }
  }, [now, boundary, onBoundary]);
  if (expired) return <Frame><Notice title="Totem sem conexão" text="Não foi possível atualizar o QR. Verifique o Wi-Fi do tablet." /></Frame>;
  return (
    <Frame>
      <div className="flex w-full max-w-3xl flex-col items-center gap-6 text-center">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">{display.building.name}</p>
          <h1 className="mt-1 text-3xl font-semibold text-white sm:text-4xl">{display.gate.name}</h1>
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-2xl">
          <QrSvg content={showing} />
        </div>
        <p className="text-xl text-slate-100">Abra o app Prédio ON › Acessos › <strong>Ler QR do portão</strong></p>
        <p className="text-sm text-slate-400">
          O QR muda a cada hora. Próxima troca às {new Date(switchesAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.
          {offline && " Sem conexão agora; tentando de novo."}
        </p>
      </div>
    </Frame>
  );
}

/** Drawn as SVG paths from the module matrix, so no markup string is injected. */
function QrSvg({ content }: { content: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(content);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++)
      for (let col = 0; col < count; col++)
        if (qr.isDark(row, col)) d += `M${col + 4},${row + 4}h1v1h-1z`;
    return { size: count + 8, path: d };
  }, [content]);
  return (
    <svg role="img" aria-label="QR do portão" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges"
      className="h-[min(60vh,80vw)] w-[min(60vh,80vw)]">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#0f172a" />
    </svg>
  );
}

function Pairing({ message, onPaired }: { message?: string; onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/totem/pair`, {
        method: "POST", credentials: "omit", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairingCode: code, label: label.trim() }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível parear este tablet."));
      const { token } = await response.json() as { token: string };
      writeToken(token);
      onPaired();
    } catch (cause) {
      setError(cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : "Sem conexão com o Prédio ON.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame>
      <form onSubmit={event => void submit(event)} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 text-slate-900 shadow-2xl">
        <div>
          <h1 className="text-xl font-semibold">Totem do portão</h1>
          <p className="mt-1 text-sm text-slate-600">
            Em <strong>Portões e acessos</strong>, a administração gera um código em “Parear tablet”. Ele vale por 10 minutos.
          </p>
        </div>
        {message && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <label className="block text-sm font-medium">
          Código de pareamento
          <input value={code} onChange={event => setCode(event.target.value)} required autoComplete="off" autoCapitalize="characters"
            spellCheck={false} maxLength={16} placeholder="ABCDE-FGHIJ"
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-lg uppercase tracking-widest" />
        </label>
        <label className="block text-sm font-medium">
          Nome deste tablet
          <input value={label} onChange={event => setLabel(event.target.value)} required minLength={2} maxLength={60}
            placeholder="Tablet da garagem" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" />
        </label>
        <button type="submit" disabled={busy || label.trim().length < 2 || !code.trim()}
          className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? "Pareando…" : "Parear tablet"}
        </button>
      </form>
    </Frame>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div role="status" className="max-w-lg text-center">
      <h1 className="text-2xl font-semibold text-white">{title}</h1>
      <p className="mt-3 text-lg text-slate-300">{text}</p>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8">{children}</main>;
}

/** Keeps the screen on while a QR is shown, where the browser supports it. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null, released = false;
    const request = async () => {
      try { lock = await navigator.wakeLock.request("screen"); } catch { /* Denied or unsupported: the tablet's own settings apply. */ }
    };
    const visible = () => { if (document.visibilityState === "visible" && !released) void request(); };
    void request();
    document.addEventListener("visibilitychange", visible);
    return () => { released = true; document.removeEventListener("visibilitychange", visible); void lock?.release(); };
  }, [active]);
}
