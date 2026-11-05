# Inventário estático de fronteiras humanas MFA

Mapa de revisão do lote 2, **não lista de vulnerabilidades nem prova de cobertura completa**. Snapshot de 05/11/2026: composição `7b53ab4e47a4bf7f2fc480d2ce2f9f6a013c206da10367a895bab35c2894dbfb`, base canônica `53c4c70dcd24f1045fad420fbce36757fd3753a2`, 1.016 caminhos. O checkpoint correspondente tem 58 arquivos candidatos de implementação/testes. Device-status passou em nove casos e sete processos separados de regressão somaram 71; essa execução não valida automaticamente as demais fronteiras deste inventário. A adaptação MFA dos 25 testes originais tem rodada separada; nesta composição permanece a fixture anterior.

A coleta encontrou 174 declarações lexicais de rotas em 33 módulos: 149 humanas operacionais, um stream humano, 17 de bootstrap/recuperação, três públicas e quatro de serviço/dispositivo. **Isso não significa 174 rotas inseguras.** Registros dinâmicos podem estar ausentes.

A revisão manual conferiu a ordem dos mounts em `app.ts` e as rotas exatas de autenticação: domínios humanos seguem `authenticate`; eventos autenticam sua própria conexão; broker/totem usam credenciais independentes. Essa revisão da entrada não fecha a autoridade de cada operação SQL. Sinais de helpers/tabelas estão associados ao arquivo inteiro, não ao fluxo de cada handler.

## Matriz dos 33 módulos

Os grupos são próximos recortes de revisão, não aprovações de endpoints.

| Módulo | Grupo | Declarações | Classes de entrada |
| --- | --- | ---: | --- |
| access | E | 12 | human, service |
| alert-rules | B | 4 | human |
| alerts | C | 3 | human |
| api-infrastructure | G | 1 | public |
| assets | D | 5 | human |
| audit | C | 1 | human |
| auth | G | 21 | bootstrap, human |
| authorization | A | 2 | human |
| automations | D | 7 | human |
| building-events | D | 6 | human |
| buildings | A | 4 | human |
| common-areas | D | 3 | human |
| demo | B | 3 | human |
| devices | B | 5 | human |
| events | F | 1 | human-stream |
| features | B | 5 | human |
| finance | C | 4 | human |
| gateways | B | 4 | human |
| health.ts | G | 2 | public |
| monitoring | C | 6 | human |
| mqtt | G | 2 | service |
| notices | D | 4 | human |
| occurrences | D | 7 | human |
| organizations | A | 3 | human |
| overview | C | 3 | human |
| parking | E | 4 | human |
| reservations | D | 7 | human |
| support | A | 4 | human |
| support-access | A | 7 | human |
| telemetry | C | 2 | human |
| tenancy | A | 22 | human |
| users | A | 4 | human |
| work-orders | D | 6 | human |

## Sete recortes finitos

| Grupo | Recorte | Próxima decisão |
| --- | --- | --- |
| A | Administração, organizações, prédios, usuários, tenancy, autorização e suporte | Separar envelopes existentes de SD/descobertas e mutações restantes; tratar vazio/no-match sem ampliar suporte. |
| B | Dispositivos, gateways, regras, funcionalidades e demo | Separar inventário de configuração/transições; preservar VOLATILE, locks e escopo. |
| C | HTTP privado de telemetria, alertas, overview, monitoramento, auditoria e finanças | Revisar callers HTTP/SD; aprovação dos projectors SSE não se transfere a eles. |
| D | Avisos, ocorrências, áreas, reservas, ordens, ativos, eventos e automações | Reads/mutations por domínio; preservar conflitos, atribuição e escopo de moradores. |
| E | Acesso físico e estacionamento | Autorização e efeito coerentes, sem replay; preservar identidades de dispositivo/totem e workers sem SID humano. |
| F | SSE restante: gateway e heartbeat | Dois recortes curtos; preservar expiração, filas/intervalos e ausência de escrita após fechar. Não exigir freshness indevida. |
| G | Bootstrap, público e serviço | Revisar exceções explícitas sem bloquear enrollment, recuperação, logout ou revogação. `055.verified_at` não é MFA. |

Cada fechamento exige identificar pool/role efetivo, SID/capacidade, dependências SD, snapshot/locks, efeitos/DTO e erro inclusive sem correspondência. Testes devem controlar interleavings reais e manter controles não-admin, MFA satisfeita e serviço. Ausência estática de guard não demonstra bypass; erro de fixture ou contrato SQL ausente não demonstra vazamento.

## Proteções existentes e limites

A candidata tem políticas restritivas em seis tabelas: `organizations`, `support_hosts`, `support_requests`, `devices`, `gateways` e `device_metrics`. RLS pode filtrar zero linhas sem produzir erro MFA e não protege automaticamente helpers SECURITY DEFINER executados como owner ou outras tabelas.

Há envelopes específicos para listas de organizações/dispositivos/gateways, duas projeções de autorização, duas de saúde da plataforma e projectors SSE de funcionalidades/telemetria/alertas/dispositivos. Device-status mantém dois snapshots intencionais, contexto e autoridade final, não linearização até a escrita na rede. A desativação MFA já reúne autoridade+DELETE na mesma operação candidata. Gateway/heartbeat permanecem recortes separados.

`mfaQueryProjection` adapta DTO/decoders, não aplica guard. `inTenantContext` transporta identidade/SID e trava funcionalidades, mas não injeta MFA em todo statement. Gate HTTP ou `assertCapability` anterior não prova atomicidade com consulta/mutação posterior. [Fronteiras revisadas](reviewed-boundaries.json) registra as exceções e envelopes específicos.

## Dados e método

- [Matriz JSON](module-matrix.json) e [CSV](module-matrix.csv): 33 linhas, sinais por arquivo e próxima ação; [grupos](closure-groups.json).
- [Rotas](routes.json) e [mounts](router-mounts.json): método, caminho e localização.
- [Callsites SQL](sql-helper-callsites.json), [callers SD](security-definer-callsites.json) e [definições históricas](sql-function-definitions.json): 174 callsites lexicais, 161 associados a SD por nome (102 nomes distintos), 256 definições históricas.
- [Sinais de tabelas](table-access-signals.json) e [sinais por arquivo](file-signals.json): 497 sinais, 366 mapeados a nomes de tabelas via schema Drizzle/CREATE TABLE. Os demais conservam incerteza explícita.
- [Resumo da geração](generation-summary.json) e [hashes da fonte](source-hashes.json): 128 arquivos TypeScript e 68 migrations, 196 hashes iguais antes/depois da coleta.

O scanner usa regex, não AST, catálogo SQL executado ou callgraph completo. Pode incluir comentários, aliases, CTEs e expressões dinâmicas. Resolução pelo último nome histórico de função é aproximada e não resolve todos os overloads. `HEURISTIC` e `ENTRY_MOUNT_REVIEWED` não significam operação SQL aprovada.

A coleta lexical foi gerada por script local. Mapeamento adicional de tabelas, matriz, grupos e decisões receberam enriquecimento manual. **Este pacote é snapshot auditável, não regeneração integral automática.** O gerador dependente da estrutura de QA não é distribuído como ferramenta portátil. Para atualizar, partir da composição identificada, conferir hashes e rever os enriquecimentos; não substituir os dados somente por nova passagem de regex.

Dados preservados com transporte LF e sem caminhos absolutos da máquina. A preparação não executou Node, testes, banco ou serviços, não aplicou migrations nem alterou produto. MFA obrigatória continua candidata; este documento não aprova produção.
