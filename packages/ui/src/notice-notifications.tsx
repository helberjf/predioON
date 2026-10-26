import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, X } from "lucide-react";
import { useResource } from "./use-resource.js";
import { markNoticesSeen, noticeReadKey, parseSeenNotices, unreadNotices, type ReadableNotice } from "./notice-read-state.js";

const Context = createContext({ count: 0, promptOpen: false, dismiss: () => {}, markSeen: (_items: readonly ReadableNotice[]) => {} });
export const useNoticeNotifications = () => useContext(Context);

function readHistory(key: string): string[] {
  try { return parseSeenNotices(window.localStorage.getItem(key)); } catch { return []; }
}

/** Keep the scope outside the feature page so reading and dismissing survive navigation. */
export function NoticeNotificationsProvider({ userId, buildingId, enabled, children }: { userId: string; buildingId: string; enabled: boolean; children: ReactNode }) {
  return <NoticeScope key={noticeReadKey(userId, buildingId)} storageKey={noticeReadKey(userId, buildingId)} buildingId={buildingId} enabled={enabled}>{children}</NoticeScope>;
}

function NoticeScope({ storageKey, buildingId, enabled, children }: { storageKey: string; buildingId: string; enabled: boolean; children: ReactNode }) {
  const resource = useResource<{ items: ReadableNotice[] }>(enabled ? `/notices?buildingId=${encodeURIComponent(buildingId)}` : null);
  const [seen, setSeen] = useState(() => readHistory(storageKey));
  const seenRef = useRef(seen);
  const startupChecked = useRef(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [, setClockTick] = useState(0);
  const count = enabled && !resource.error ? unreadNotices(resource.data?.items ?? [], seen).length : 0;

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { setClockTick(value => value + 1); resource.reload(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [enabled, resource.reload]);

  useEffect(() => {
    if (!enabled || resource.loading || resource.error || !resource.data || startupChecked.current) return;
    startupChecked.current = true;
    setPromptOpen(unreadNotices(resource.data.items, seenRef.current).length > 0);
  }, [enabled, resource.loading, resource.error, resource.data]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      const next = readHistory(storageKey);
      seenRef.current = next;
      setSeen(next);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [storageKey]);

  const dismiss = useCallback(() => setPromptOpen(false), []);
  const markSeen = useCallback((items: readonly ReadableNotice[]) => {
    if (!items.length) return;
    startupChecked.current = true;
    setPromptOpen(false);
    const next = markNoticesSeen([...new Set([...readHistory(storageKey), ...seenRef.current])], items);
    if (next.length === seenRef.current.length) return;
    seenRef.current = next;
    setSeen(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Reading still works for this visit when browser storage is unavailable. */ }
  }, [storageKey]);

  return <Context.Provider value={{ count, promptOpen: enabled && !resource.error && promptOpen && count > 0, dismiss, markSeen }}>{children}</Context.Provider>;
}

/** Parent must be positioned; the full count remains available to screen readers. */
export function NoticeCount({ count }: { count: number }) {
  if (count < 1) return null;
  return <span aria-label={`${count} ${count === 1 ? "aviso novo" : "avisos novos"}`} className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">{count > 99 ? "99+" : count}</span>;
}

export function NewNoticesAlert({ onView }: { onView: () => void }) {
  const { count, promptOpen, dismiss } = useNoticeNotifications();
  if (!promptOpen) return null;
  return <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-sm">
    <Bell size={22} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
    <div className="min-w-0 flex-1"><p className="text-sm font-bold">{count === 1 ? "Você tem 1 aviso novo" : `Você tem ${count} avisos novos`}</p><p className="mt-1 text-xs leading-5">Confira as novidades do seu condomínio.</p><button type="button" onClick={onView} className="mt-2 min-h-10 rounded-lg bg-amber-900 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800">Ver avisos</button></div>
    <button type="button" aria-label="Fechar alerta de novos avisos" onClick={dismiss} className="rounded-lg p-2 text-amber-800 hover:bg-amber-100"><X size={18} /></button>
  </div>;
}
