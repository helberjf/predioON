import { ADMIN_URL, BUILDING_URL, RESIDENT_URL } from "./environment";

/** Every route of the three portals, as each App.tsx declares it. When a route is added to a
 * portal, add it here: the smoke suite opens all of them with the seed account of that portal.
 * `heading` is the visible page title; without it the page only needs some heading in <main>.
 * `menu` is the link name in the portal navigation (resident: shell title instead). */
/** `ready` replaces the heading when the page, by rule, shows only an explanation in this state.
 * `expected` lists API answers >= 400 that are the designed outcome here, each with its reason. */
export type Expected = { problem: RegExp; reason: string };
export type PortalRoute = { path: string; menu?: string; heading?: string | RegExp; ready?: string; expected?: Expected[] };
export type Portal = {
  key: "admin" | "building" | "resident";
  name: string;
  origin: string;
  account: string;
  viewport: { width: number; height: number };
  navigation: string;
  /** Designed API refusals that every page of this portal may produce. */
  expected?: Expected[];
  routes: PortalRoute[];
};

// The platform account registers buildings but holds no grant inside one (seed): operational
// pages explain that instead of showing data.
const noGrant = "Sua conta não tem concessão em nenhum condomínio.";

export const PORTALS: Portal[] = [
  {
    key: "admin", name: "administração da plataforma", origin: ADMIN_URL, account: "admin@predioon.local",
    viewport: { width: 1440, height: 1000 }, navigation: "Menu principal",
    routes: [
      { path: "/", menu: "Dashboard", heading: "Visão geral dos condomínios" },
      { path: "/alertas", menu: "Alertas", heading: "Alertas da plataforma" },
      { path: "/predios", menu: "Condomínios", heading: "Imóveis" },
      { path: "/clientes", menu: "Clientes", heading: "Clientes" },
      { path: "/operacao", menu: "Operação dos imóveis", heading: "Operação dos imóveis", expected: [
        { problem: /^HTTP 403 GET \/v1\/authorization$/, reason: "a projeção do condomínio é negada à conta sem concessão; a tela explica" },
      ] },
      { path: "/gateways", menu: "Comunicação", heading: "Gateways" },
      { path: "/dispositivos", menu: "Equipamentos", heading: "Dispositivos" },
      { path: "/suporte-remoto", menu: "Suporte remoto", heading: "Suporte remoto" },
      { path: "/usuarios", menu: "Usuários", heading: "Usuários" },
      { path: "/unidades-equipes", menu: "Unidades e equipes", ready: noGrant, expected: [
        { problem: /^HTTP 403 GET \/v1\/authorization$/, reason: "a projeção do condomínio é negada à conta sem concessão; a tela explica" },
      ] },
      { path: "/acesso-suporte", menu: "Acesso de suporte", heading: "Acesso de suporte" },
      { path: "/funcionalidades", menu: "Funcionalidades", heading: "Funcionalidades" },
      { path: "/auditoria", menu: "Histórico de atividades", heading: "Histórico de atividades" },
      { path: "/sessoes", menu: "Minhas sessões" },
    ],
  },
  {
    key: "building", name: "gestão do condomínio", origin: BUILDING_URL, account: "sindico@predioon.local",
    viewport: { width: 1440, height: 1000 }, navigation: "Menu principal",
    routes: [
      { path: "/", menu: "Início", heading: /^Olá, / },
      { path: "/alertas", menu: "Alertas", heading: "Alertas" },
      { path: "/agua", menu: "Água e reservatórios", heading: "Água e reservatórios" },
      { path: "/energia", menu: "Energia e fases", heading: "Monitoramento de energia" },
      { path: "/consumo", menu: "Consumo e análise" },
      { path: "/sensores", menu: "Gás, fumaça e vazamentos", heading: "Sensores e segurança" },
      { path: "/dispositivos", menu: "Equipamentos", heading: "Dispositivos" },
      { path: "/acessos", menu: "Portões e acessos" },
      { path: "/vagas", menu: "Vagas de carros e motos" },
      { path: "/chamados", menu: "Ocorrências", heading: "Chamados" },
      { path: "/ordens-servico", menu: "Ordens de serviço", heading: "Ordens de serviço" },
      { path: "/ativos", menu: "Ativos", heading: "Ativos" },
      { path: "/avisos", menu: "Avisos", heading: "Avisos e agenda" },
      { path: "/areas", menu: "Áreas comuns", heading: "Áreas comuns" },
      { path: "/transparencia", menu: "Transparência e contas", heading: "Transparência e prestação de contas" },
      { path: "/unidades-equipes", menu: "Unidades e equipes", heading: "Unidades e equipes" },
      { path: "/regras", menu: "Regras de alerta", heading: "Regras de alerta" },
      { path: "/automacoes", menu: "Automações", heading: "Automações" },
      { path: "/auditoria", menu: "Histórico de atividades", heading: "Histórico de atividades" },
      { path: "/acesso-suporte", menu: "Acesso de suporte" },
      { path: "/sessoes", menu: "Minhas sessões" },
    ],
  },
  {
    // The resident shell titles ordinary pages itself (MobileShell `title ?? label`).
    key: "resident", name: "morador", origin: RESIDENT_URL, account: "morador@predioon.local",
    viewport: { width: 390, height: 844 }, navigation: "Navegação do morador",
    expected: [
      { problem: /^HTTP 403 GET \/monitoring\/published$/, reason: "consumo não liberado aos moradores (opt-in da migration 051): o menu sonda e esconde Consumo" },
    ],
    routes: [
      { path: "/", heading: /^Olá, / },
      { path: "/reservas", heading: "Reservas" },
      // Pages with their own title (MobileShell ownHeading) name themselves, not the menu label.
      { path: "/acessos", heading: "Acessos" },
      { path: "/chamados", heading: "Chamados" },
      { path: "/avisos", heading: "Avisos" },
      { path: "/vagas", heading: "Vagas de carros e motos" },
      { path: "/consumo", ready: "O consumo não está disponível para moradores neste condomínio." },
      { path: "/transparencia", heading: "Transparência e prestação de contas" },
      { path: "/perfil", heading: "Perfil" },
    ],
  },
];
