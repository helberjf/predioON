import { Button, Card, SessionsPanel, useAuth, useBuildingScope } from "@predioon/ui";

export function Profile() {
  const { user, signOut } = useAuth();
  const { buildings } = useBuildingScope();

  return (
    <><Card title="Meu perfil">
      <div className="mb-5 flex items-center gap-4">
        <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#1b3f60] text-lg font-semibold text-white">{user?.name.split(" ").filter(Boolean).map(part => part[0]).slice(0, 2).join("")}</span>
        <div className="min-w-0"><p className="truncate text-base font-bold text-[#142f50]">{user?.name}</p><p className="truncate text-sm text-slate-500">{user?.email}</p></div>
      </div>
      <dl className="space-y-3 border-t border-slate-100 pt-4 text-sm">
        <div>
          <dt className="text-xs text-slate-400">Condomínios disponíveis</dt>
          <dd className="font-medium text-slate-800">{buildings.length}</dd>
        </div>
      </dl>

      <div className="mt-6">
        <Button variant="secondary" full onClick={() => void signOut()}>
          Sair da conta
        </Button>
      </div>
    </Card><SessionsPanel /></>
  );
}
