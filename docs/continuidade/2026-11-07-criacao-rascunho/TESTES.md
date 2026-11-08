# Teste comum das três criações de estrutura

**Autoria congelada, revisada estaticamente e sem execução.** Novo arquivo `apps/api/test/platform-mfa-tenancy-create.test.ts`, a ser idêntico no baseline e fixed. Nenhum Node, tipo, banco, serviço, browser ou teste foi executado pelo autor; main e fontes congeladas não foram editadas.

Base examinada: fixed revocation c2bb641f60ff44d847f4b34cf472cddcf235e0897c93659767eab514816a3c25, 1.034 arquivos. Somente POST `/v1/tenancy/blocks`, `/units` e `/teams`. O produto é autoria separada; este teste usa apenas helpers já existentes na base.

## Matriz fechada

17 testes independentes, uma suite describe, zero grupos agregadores/subtestes:

- Seis negativos: três POSTs vezes perda de fator/prova da família, depois da capacidade real.
- Seis positivos: três POSTs vezes gestor opcional/ADMIN satisfeito.
- Quatro contratos: escopo/permissões nas três rotas; FK composta de units e null explícito; duplicate de blocks/units; input strict, tipos e limites.
- Um negativo: criação de teams com trigger estreito de auditoria que remove a prova da própria família.

Expectativas estáticas: baseline10PASS/7FAIL, fixed17PASS. Os sete REDs precisam produzir o diagnóstico **Baseline201** somente depois de provar DTO, linha e auditoria reais; o trigger também precisa testemunha de execução e prova efetivamente removida. Falhas de setup,429/500, deadline, SQL ou tipos não satisfazem esse RED. O controller terminar sem falha não substitui a classificação TAP.

## Oráculos e MFA

Cada administrador faz login, enrollment e confirmação TOTP HTTP reais no mesmo bearer/SID. O teste confere dez códigos únicos, fator confirmado, geração correspondente e perfil satisfeito. Negativos usam atores distintos: a fixture remove fator ou prova, mas nunca fabrica/restaura aprovação SQL. Um controle de criação permitido antecede cada negativo; ele permanece no banco e faz parte do snapshot de referência.

O proxy delega SQL ao banco real. Só pausa depois do SELECT separado de assertCapability, com parâmetros esperados e allowed=true; não confunde um CTE que contém a mesma função com esse ponto. A transação HTTP preserva o contexto real e as policies restritas.

A comparação usa o DTO integral original do POST, sem projetá-lo no DTO menor do GET/PATCH: blocks tem sete campos; units nove; teams oito. Confere linha owner completa, UUID gerado, trims, active, defaults, metadata={} somente em units/teams, campos nulos e auditoria exata com ator USER. Datas PostgreSQL são convertidas por Date→ISO, como o ORM; nenhuma string de microsegundos é comparada diretamente com a string HTTP de milissegundos.

**Correção de leitura do plano:** floor de CreateUnit aceita ausência e null explícito. Há positivos para ausência, inteiro-1 e null explícito; string, fração e301 continuam inválidos. blockId também aceita ausência/null e rejeita UUID inválido. O erro do PLAN original está preservado com ERRATA em `work/mfa-next-tenancy-writes-20261107/ERRATA.md`; não há mudança de schema para acomodar teste.

O controle de escopo verifica gestor em prédio estrangeiro, usuário sem gestão e ADMIN global satisfeito sem vínculo local em todas as três rotas. Flags globais não devem fabricar gestão local. A FK verifica bloco inexistente e bloco de outro prédio; duplicate conserva409 e não cria linha/auditoria extra.

## Trigger e limpeza

O trigger é exclusivo da fixture: nome UUID, AFTER INSERT em audit_logs, security definer com search_path fixo e EXECUTE público revogado. Predicado exige ator, prédio, ação TEAM_CREATED, resource_type team, SID e correspondência com a nova equipe de nome único. Só limpa mfa_verified_at/mfa_factor_generation daquela família. Uma sequence é testemunha não transacional: deve registrar uma execução mesmo no rollback.

No baseline201, confere criação/auditoria e prova removida. Na recusa403, exige snapshot de estrutura/auditoria idêntico e prova igual à original por rollback, incluindo mfa_verified_at::text exato (preserva micros), geração e indicador de presença. Remove trigger/função/sequence e compara catálogo; não restaura prova artificialmente. Código, token, segredo e recovery codes não são diagnosticados.

Listener loopback; HTTP/barreiras/settle/cleanup limitados a cinco segundos; SQL de trigger/limpeza usa lock timeout2s e statement timeout3s. Todas as transações app são acompanhadas e o proxy liberado/restaurado em finally. Cleanup fecha listener, drena transações, remove objetos/dados apenas desta fixture e encerra pools; helpers existentes fecham identity/broker. Falha ou deadline bloqueia aceite, não é escondida.

## Limites

Não induz espera real em row lock, promoção concorrente, perda de capacidade durante espera, INSERT de retorno vazio ou exceção genérica de trigger. Só um trigger pós-auditoria em teams; não é matriz cartesiana de todos os interleavings. Não cobre concessões, convites, outros domínios, regressão integrada, browsers, Android/iOS, performance ou produção. Não contar loops de assertivas como novos casos TAP.

Root fará tipos e execução serial nas fixtures UUID oficiais após freeze/revisão. Regressões propostas ficam separadas: os sete arquivos do lote anterior92 TAP mais revocations21, total113 TAP em oito arquivos (103 independentes e dez grupos); não são resultados executados deste pacote.
