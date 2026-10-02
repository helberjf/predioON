import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthorizationResponse, BlockView, UnitView, TeamView } from "@predioon/contracts/tenancy";
import { api } from "../api.js";
import { useResource } from "../use-resource.js";
import { useTenancyCollection } from "../use-tenancy-collection.js";
import { membershipStatus, membershipValidity } from "../tenancy-state.js";
import { formatDateTime } from "../format.js";
import { Badge, Button, Card, EmptyState, ErrorBanner, ResourceFeedback } from "./primitives.js";
import { Field, Input, Select } from "./fields.js";

type Person = { id: string; name: string; email: string };
type Membership = { id: string; userId: string; unitId?: string; teamId?: string; kind?: string; startsAt: string | null; endsAt: string | null };
type Binding = { id: string; userId: string | null; teamId: string | null; roleKey: string; reason: string | null; startsAt: string | null; endsAt: string | null };
type Resource<T> = { data: T[]; loading: boolean; error: string | null; reload: () => void };
const ROLES = [{ value: "RESIDENT", label: "Morador" }, { value: "MAINTENANCE", label: "Manutenção" }, { value: "MAINTENANCE_MANAGER", label: "Gestor de manutenção" }, { value: "BUILDING_ADMIN", label: "Administrador do condomínio" }];
const KINDS = [{ value: "OWNER", label: "Proprietário" }, { value: "OCCUPANT", label: "Ocupante" }, { value: "DEPENDENT", label: "Dependente" }];

export function TenancyPanel({ buildingId }: { buildingId: string }) {
  const authorization = useResource<AuthorizationResponse>(`/v1/authorization?buildingId=${encodeURIComponent(buildingId)}`);
  useEffect(() => {
    window.addEventListener("focus", authorization.reload);
    return () => window.removeEventListener("focus", authorization.reload);
  }, [authorization.reload]);
  if (!authorization.data) return <Card title="Unidades, equipes e permissões"><ResourceFeedback resource={authorization} emptyText="Não há permissões disponíveis para este condomínio." /><p className="mt-3 text-sm text-slate-500">Os cadastros exigem uma concessão no condomínio. A conta de administração da plataforma, sozinha, não concede acesso operacional.</p></Card>;
  const capabilities = authorization.data.capabilities;
  if (!capabilities.some(capability => ["units:read", "teams:read", "memberships:read", "memberships:manage"].includes(capability))) return <Card><EmptyState text="Sua conta não tem permissão para consultar estes cadastros." /></Card>;
  return <TenancyWorkspace key={`${buildingId}:${capabilities.join(",")}`} buildingId={buildingId} capabilities={capabilities} refreshAuthorization={authorization.reload} />;
}

function TenancyWorkspace({ buildingId, capabilities, refreshAuthorization }: { buildingId: string; capabilities: AuthorizationResponse["capabilities"]; refreshAuthorization: () => void }) {
  const can = (capability: AuthorizationResponse["capabilities"][number]) => capabilities.includes(capability);
  const route = (name: string) => `/v1/tenancy/${name}?buildingId=${encodeURIComponent(buildingId)}`;
  const blocks = useTenancyCollection<BlockView>(can("units:read") ? route("blocks") : null);
  const units = useTenancyCollection<UnitView>(can("units:read") ? route("units") : null);
  const teams = useTenancyCollection<TeamView>(can("teams:read") ? route("teams") : null);
  const residents = useTenancyCollection<Membership>(can("memberships:read") ? route("unit-memberships") : null);
  const teamMembers = useTenancyCollection<Membership>(can("teams:read") ? route("team-members") : null);
  const bindings = useTenancyCollection<Binding>(can("memberships:manage") ? route("role-bindings") : null);
  const people = useTenancyCollection<Person>(can("memberships:manage") || can("teams:manage") ? route("people") : null);
  const [tab, setTab] = useState("units");
  const tabs = [{ value: "units", label: "Blocos e unidades", visible: can("units:read") }, { value: "teams", label: "Equipes", visible: can("teams:read") }, { value: "people", label: "Moradores e vínculos", visible: can("memberships:read") }, { value: "roles", label: "Permissões", visible: can("memberships:manage") }].filter(item => item.visible);
  const currentTab = tabs.some(item => item.value === tab) ? tab : tabs[0]?.value;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [confirmation, setConfirmation] = useState<{ path: string; label: string } | null>(null);
  const [blockForm, setBlockForm] = useState({ code: "", name: "" });
  const [unitForm, setUnitForm] = useState({ blockId: "", code: "", floor: "" });
  const [teamName, setTeamName] = useState("");
  const [unitMember, setUnitMember] = useState({ userId: "", unitId: "", kind: "OCCUPANT", startsAt: "", endsAt: "" });
  const [teamMember, setTeamMember] = useState({ userId: "", teamId: "", startsAt: "", endsAt: "" });
  const [binding, setBinding] = useState({ target: "person", targetId: "", roleKey: "RESIDENT", reason: "", startsAt: "", endsAt: "" });
  const personLabel = (id: string) => people.data.find(person => person.id === id)?.name ?? `Pessoa ${id}`;
  const teamLabel = (id: string) => teams.data.find(team => team.id === id)?.name ?? `Equipe ${id}`;
  const unitLabel = (id: string) => {
    const unit = units.data.find(item => item.id === id);
    const block = blocks.data.find(item => item.id === unit?.blockId);
    return unit ? `${block ? `${block.code} · ` : ""}${unit.code}` : `Unidade ${id}`;
  };
  const personOptions = [{ value: "", label: "Selecione uma pessoa" }, ...people.data.map(person => ({ value: person.id, label: `${person.name} · ${person.email}` }))];
  const teamOptions = [{ value: "", label: "Selecione uma equipe" }, ...teams.data.map(team => ({ value: team.id, label: team.name }))];
  const refresh = () => { for (const resource of [blocks, units, teams, residents, teamMembers, bindings]) resource.reload(); people.reload(); refreshAuthorization(); };

  async function mutate(action: () => Promise<unknown>, message: string, after?: () => void) {
    if (busy.current) return;
    busy.current = true;
    setPending(true); setError(null); setSuccess("");
    try { await action(); after?.(); setSuccess(message); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a alteração."); }
    finally { busy.current = false; setPending(false); }
  }
  const post = (name: string, payload: object) => api.post(`/v1/tenancy/${name}`, { buildingId, ...payload });
  const personField = (value: string, onChange: (id: string) => void) => <Field label="Pessoa"><Select required value={value} onChange={onChange} options={personOptions} disabled={people.loading || pending} /></Field>;
  const revokeButton = (path: string, label: string) => <Button variant="ghost" disabled={pending} onClick={() => { setConfirmation({ path, label }); setError(null); setSuccess(""); }}>Revogar</Button>;

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Unidades e equipes</h1><p className="mt-1 text-sm text-slate-500">Organize o condomínio e conceda somente o acesso necessário.</p></div><Button variant="secondary" disabled={pending} onClick={refresh}>Atualizar cadastros</Button></div>
    <nav aria-label="Cadastros do condomínio" className="flex flex-wrap gap-2">{tabs.map(item => <button key={item.value} type="button" aria-pressed={currentTab === item.value} onClick={() => { setTab(item.value); setError(null); setSuccess(""); setConfirmation(null); }} className={`rounded-lg border px-4 py-2 text-sm font-medium ${currentTab === item.value ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}>{item.label}</button>)}</nav>
    {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    {success && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
    {confirmation && <Card title="Revogar vínculo"><p className="mb-4 text-sm text-slate-600">Confirme a revogação de {confirmation.label}. O histórico será preservado. Revogar sua própria permissão pode encerrar seu acesso ao cadastro.</p><div className="flex flex-wrap gap-2"><Button variant="danger" disabled={pending} onClick={() => void mutate(() => api.delete(confirmation.path), "Vínculo revogado.", () => setConfirmation(null))}>{pending ? "Revogando…" : "Confirmar revogação"}</Button><Button variant="secondary" disabled={pending} onClick={() => setConfirmation(null)}>Manter vínculo</Button></div></Card>}
    {people.error && ["teams", "people", "roles"].includes(currentTab ?? "") && <Card><ErrorBanner message={`Não foi possível carregar as pessoas: ${people.error}`} /><Button variant="secondary" onClick={people.reload}>Tentar carregar pessoas</Button></Card>}

    {currentTab === "units" && <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Blocos">
        {can("units:manage") && <form className="mb-5 space-y-3" onSubmit={event => { event.preventDefault(); void mutate(() => post("blocks", { code: blockForm.code.trim(), name: blockForm.name.trim() }), "Bloco cadastrado.", () => setBlockForm({ code: "", name: "" })); }}><fieldset disabled={pending} className="space-y-3"><Field label="Código do bloco"><Input required maxLength={40} value={blockForm.code} onChange={code => setBlockForm({ ...blockForm, code })} placeholder="A" /></Field><Field label="Nome do bloco"><Input required maxLength={120} value={blockForm.name} onChange={name => setBlockForm({ ...blockForm, name })} placeholder="Torre A" /></Field><Button type="submit" disabled={pending}>Cadastrar bloco</Button></fieldset></form>}
        <Rows resource={blocks} empty="Nenhum bloco cadastrado." render={block => <><strong>{block.code}</strong><span className="ml-2">{block.name}</span></>} />
      </Card>
      <Card title="Unidades">
        {can("units:manage") && <form className="mb-5 space-y-3" onSubmit={event => { event.preventDefault(); void mutate(() => post("units", { code: unitForm.code.trim(), blockId: unitForm.blockId || null, floor: unitForm.floor === "" ? null : Number(unitForm.floor) }), "Unidade cadastrada.", () => setUnitForm({ ...unitForm, code: "", floor: "" })); }}><fieldset disabled={pending} className="space-y-3"><Field label="Bloco"><Select value={unitForm.blockId} onChange={blockId => setUnitForm({ ...unitForm, blockId })} options={[{ value: "", label: "Sem bloco" }, ...blocks.data.map(block => ({ value: block.id, label: `${block.code} · ${block.name}` }))]} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Código da unidade"><Input required maxLength={40} value={unitForm.code} onChange={code => setUnitForm({ ...unitForm, code })} placeholder="101" /></Field><Field label="Andar (opcional)"><Input type="number" min={-10} max={300} step={1} value={unitForm.floor} onChange={floor => setUnitForm({ ...unitForm, floor })} /></Field></div><Button type="submit" disabled={pending}>Cadastrar unidade</Button></fieldset></form>}
        <Rows resource={units} empty="Nenhuma unidade cadastrada." render={unit => <><strong>{unitLabel(unit.id)}</strong>{unit.floor !== null && <span className="ml-2 text-slate-500">Andar {unit.floor}</span>}</>} />
      </Card>
    </div>}

    {currentTab === "teams" && <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Equipes">
        {can("teams:manage") && <form className="mb-5 space-y-3" onSubmit={event => { event.preventDefault(); void mutate(() => post("teams", { name: teamName.trim() }), "Equipe cadastrada.", () => setTeamName("")); }}><Field label="Nome da equipe"><Input required maxLength={120} disabled={pending} value={teamName} onChange={setTeamName} placeholder="Manutenção predial" /></Field><Button type="submit" disabled={pending}>Cadastrar equipe</Button></form>}
        <Rows resource={teams} empty="Nenhuma equipe cadastrada." render={team => <strong>{team.name}</strong>} />
      </Card>
      <Card title="Integrantes das equipes" subtitle="O acesso da equipe é definido na aba Permissões.">
        {can("teams:manage") && <form className="mb-5 space-y-3" onSubmit={event => { event.preventDefault(); void mutate(() => post("team-members", { userId: teamMember.userId, teamId: teamMember.teamId, ...membershipValidity(teamMember.startsAt, teamMember.endsAt) }), "Integrante incluído na equipe.", () => setTeamMember({ ...teamMember, userId: "" })); }}><fieldset disabled={pending} className="space-y-3">{personField(teamMember.userId, userId => setTeamMember({ ...teamMember, userId }))}<Field label="Equipe"><Select required value={teamMember.teamId} onChange={teamId => setTeamMember({ ...teamMember, teamId })} options={teamOptions} /></Field><ValidityFields value={teamMember} onChange={value => setTeamMember({ ...teamMember, ...value })} /><Button type="submit" disabled={pending || !teamMember.userId || !teamMember.teamId}>Adicionar integrante</Button></fieldset></form>}
        <Rows resource={teamMembers} empty="Nenhum integrante cadastrado." render={member => <><div><strong>{personLabel(member.userId)}</strong><p>{teamLabel(member.teamId ?? "")}</p><Validity value={member} /></div>{can("teams:manage") && revokeButton(`/v1/tenancy/team-members/${member.id}`, `${personLabel(member.userId)} na equipe ${teamLabel(member.teamId ?? "")}`)}</>} />
      </Card>
    </div>}

    {currentTab === "people" && <Card title="Pessoas nas unidades" subtitle="O vínculo registra a ocupação; as permissões de acesso são concedidas separadamente.">
      {can("memberships:manage") && <form className="mb-5 space-y-3" onSubmit={event => { event.preventDefault(); void mutate(() => post("unit-memberships", { userId: unitMember.userId, unitId: unitMember.unitId, kind: unitMember.kind, ...membershipValidity(unitMember.startsAt, unitMember.endsAt) }), "Pessoa vinculada à unidade.", () => setUnitMember({ ...unitMember, userId: "" })); }}><fieldset disabled={pending} className="grid gap-3 md:grid-cols-2">{personField(unitMember.userId, userId => setUnitMember({ ...unitMember, userId }))}<Field label="Unidade"><Select required value={unitMember.unitId} onChange={unitId => setUnitMember({ ...unitMember, unitId })} options={[{ value: "", label: "Selecione uma unidade" }, ...units.data.map(unit => ({ value: unit.id, label: unitLabel(unit.id) }))]} /></Field><Field label="Tipo de vínculo"><Select value={unitMember.kind} onChange={kind => setUnitMember({ ...unitMember, kind })} options={KINDS} /></Field><ValidityFields value={unitMember} onChange={value => setUnitMember({ ...unitMember, ...value })} /><div><Button type="submit" disabled={pending || !unitMember.userId || !unitMember.unitId}>Vincular pessoa</Button></div></fieldset></form>}
      <Rows resource={residents} empty="Nenhuma pessoa vinculada às unidades." render={member => <><div><strong>{personLabel(member.userId)}</strong><p>{unitLabel(member.unitId ?? "")} · {KINDS.find(kind => kind.value === member.kind)?.label ?? member.kind}</p><Validity value={member} /></div>{can("memberships:manage") && revokeButton(`/v1/tenancy/unit-memberships/${member.id}`, `${personLabel(member.userId)} na unidade ${unitLabel(member.unitId ?? "")}`)}</>} />
    </Card>}

    {currentTab === "roles" && <Card title="Concessões de acesso" subtitle="Aplicadas somente ao condomínio selecionado, com justificativa e histórico.">
      <form className="mb-5 space-y-3" onSubmit={event => { event.preventDefault(); void mutate(() => post("role-bindings", { ...(binding.target === "team" ? { teamId: binding.targetId } : { userId: binding.targetId }), roleKey: binding.roleKey, reason: binding.reason.trim(), ...membershipValidity(binding.startsAt, binding.endsAt) }), "Permissão concedida.", () => setBinding({ ...binding, targetId: "", reason: "" })); }}><fieldset disabled={pending} className="grid gap-3 md:grid-cols-2"><Field label="Conceder para"><Select value={binding.target} onChange={target => setBinding({ ...binding, target, targetId: "" })} options={[{ value: "person", label: "Uma pessoa" }, { value: "team", label: "Uma equipe" }]} /></Field>{binding.target === "person" ? personField(binding.targetId, targetId => setBinding({ ...binding, targetId })) : <Field label="Equipe"><Select required value={binding.targetId} onChange={targetId => setBinding({ ...binding, targetId })} options={teamOptions} /></Field>}<Field label="Papel no condomínio"><Select value={binding.roleKey} onChange={roleKey => setBinding({ ...binding, roleKey })} options={ROLES} /></Field><Field label="Justificativa"><Input required minLength={3} maxLength={500} value={binding.reason} onChange={reason => setBinding({ ...binding, reason })} placeholder="Responsável pela manutenção contratada" /></Field><ValidityFields value={binding} onChange={value => setBinding({ ...binding, ...value })} /><div><Button type="submit" disabled={pending || !binding.targetId}>Conceder permissão</Button></div></fieldset></form>
      <Rows resource={bindings} empty="Nenhuma concessão cadastrada." render={row => <><div><strong>{row.userId ? personLabel(row.userId) : teamLabel(row.teamId ?? "")}</strong><p>{ROLES.find(role => role.value === row.roleKey)?.label ?? row.roleKey}</p>{row.reason && <p className="mt-1 text-xs text-slate-500">{row.reason}</p>}<Validity value={row} /></div>{revokeButton(`/v1/tenancy/role-bindings/${row.id}`, `${ROLES.find(role => role.value === row.roleKey)?.label ?? row.roleKey} de ${row.userId ? personLabel(row.userId) : teamLabel(row.teamId ?? "")}`)}</>} />
    </Card>}
  </>;
}

function Rows<T extends { id: string }>({ resource, empty, render }: { resource: Resource<T>; empty: string; render: (row: T) => ReactNode }) {
  if (resource.loading || resource.error || !resource.data.length) return <ResourceFeedback resource={resource} emptyText={empty} />;
  return <><p className="mb-2 text-xs text-slate-500">{resource.data.length} registro(s)</p><ul className="max-h-[32rem] divide-y divide-slate-100 overflow-auto">{resource.data.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-slate-700">{render(row)}</li>)}</ul></>;
}

function ValidityFields({ value, onChange }: { value: { startsAt: string; endsAt: string }; onChange: (value: { startsAt: string; endsAt: string }) => void }) {
  return <div className="grid gap-3 sm:grid-cols-2 md:col-span-2"><Field label="Início da vigência" hint="Opcional; horário deste computador"><Input type="datetime-local" value={value.startsAt} onChange={startsAt => onChange({ startsAt, endsAt: value.endsAt })} /></Field><Field label="Fim da vigência" hint="Opcional; vazio mantém o vínculo sem prazo"><Input type="datetime-local" value={value.endsAt} onChange={endsAt => onChange({ startsAt: value.startsAt, endsAt })} /></Field></div>;
}
function Validity({ value }: { value: { startsAt: string | null; endsAt: string | null } }) {
  const status = membershipStatus(value);
  return <div className="mt-2 flex flex-wrap items-center gap-2"><Badge tone={status === "Vigente" ? "success" : "neutral"}>{status}</Badge><span className="text-xs text-slate-500">{value.startsAt ? `Desde ${formatDateTime(value.startsAt)}` : "Início imediato"} · {value.endsAt ? `Até ${formatDateTime(value.endsAt)}` : "Sem prazo final"}</span></div>;
}
