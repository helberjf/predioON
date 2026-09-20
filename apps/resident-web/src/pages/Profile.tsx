import { Button, Card, useAuth } from "@predioon/ui";

export function Profile() {
  const { user, signOut } = useAuth();

  return (
    <Card title="Meu perfil">
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs text-slate-400">Nome</dt>
          <dd className="font-medium text-slate-800">{user?.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">E-mail</dt>
          <dd className="font-medium text-slate-800">{user?.email}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Unidades vinculadas</dt>
          <dd className="font-medium text-slate-800">{user?.memberships.length ?? 0}</dd>
        </div>
      </dl>

      <div className="mt-6">
        <Button variant="secondary" full onClick={() => void signOut()}>
          Sair da conta
        </Button>
      </div>
    </Card>
  );
}
