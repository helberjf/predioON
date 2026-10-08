import { useEffect, useState } from "react";
import { api, ApiError, Card } from "@predioon/ui";

type Listed = { id: string; name: string };

/**
 * A platform account sees every condominium in the portfolio but operates only
 * those where it holds a grant. Returns the ones it can open; `null` while checking.
 * A condominium whose check fails for another reason is kept, so a real error still shows.
 */
export function useGrantedBuildings<T extends Listed>(buildings: T[] | null | undefined): T[] | null {
  const [granted, setGranted] = useState<T[] | null>(null);
  const key = buildings?.map(building => building.id).join("|") ?? null;
  useEffect(() => {
    setGranted(null);
    if (!buildings) return;
    let active = true;
    void Promise.all(buildings.map(building => api.get(`/v1/authorization?buildingId=${encodeURIComponent(building.id)}`)
      .then(() => true, (cause: unknown) => !(cause instanceof ApiError && cause.status === 403))))
      .then(results => { if (active) setGranted(buildings.filter((_, index) => results[index])); });
    return () => { active = false; };
    // The list is identified by its ids; a new array with the same condominiums is not a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return granted;
}

/** Shown instead of an empty selector when the account holds no grant anywhere. */
export function NoGrant({ title }: { title: string }) {
  return <Card title={title}>
    <p role="status" className="text-sm font-semibold text-[#153451]">Sua conta não tem concessão em nenhum condomínio.</p>
    <p className="mt-2 text-sm leading-6 text-slate-600">A conta de administração da plataforma cadastra condomínios, clientes e equipamentos, mas não opera o dia a dia de um condomínio. Quem administra o condomínio concede o acesso no portal de operação, em <strong className="font-semibold">Unidades e equipes → Permissões</strong>.</p>
  </Card>;
}
