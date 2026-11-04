# Retomada do candidato de MFA — 04/11/2026

**INCOMPLETO, SEM TESTES FUNCIONAIS, SEM RED/GREEN E SEM ACEITE PARA PRODUÇÃO.** O código principal continua em migrations001–067; os arquivos desta pasta são documentos de recuperação e não participam do runtime, do glob da API ou do executor de migrations. O guard recusou o ensaio por falta de memória antes de iniciar Node/fixture/testes. A revisão de comportamento foi estática. Depois dela, o typecheck da API com quatro fontes candidatas passou em uma execução de13,962s, sem diagnósticos; [prova e limites](../../evidencias/mfa-family-typecheck-2026-11-04.json). Os dois arquivos de testes não foram compilados/executados nessa fase.

## Conteúdo e estado

- [Manifesto](MANIFESTO.json): base exata, seis fontes, hashes, patches e limites.
- [Testes](testes-red.patch): dois arquivos novos, nove casos planejados. Corrige o controle de catálogo/flag e acrescenta a promoção após uma capacidade local legítima, antes da leitura de devices. Cleanup remove o prédio próprio antes da organização. Os checkpoints anteriores de seis/dois casos ficam históricos; não somar suas contagens.
- [API candidata](prova-por-familia.patch): quatro arquivos auth, com consumo por geração e prova por família, preservando055. Parser e typecheck da API passaram; nenhum teste funcional foi executado.
- [SQL candidato](068-plataforma-mfa.candidata.sql.txt): persistência, helpers, ACL normalizada e primeira fatia de policies/envelope de organizações e suporte. É um documento.txt, não uma migration aplicada ou número reservado.
- [Mapa de integração](MAPA_INTEGRACAO.txt) e [revisão do recorte API](REVISAO_API.md): raciocínio, arquivos e provas futuras. Essa revisão foi escrita antes do typecheck; a prova posterior acima atualiza somente o estado de tipos, sem validar comportamento. A orientação antiga do itemB do mapa, sobre promoção depois de assertGlobalCapability em organizações, foi substituída pelo terceiro caso de capacidade local/devices; um usuário comum não deve ultrapassar um assert global administrativo para fabricar a fixture.

## O que falta implementar

Estado por família no DTO, sessão operacional/bootstrap explícitos, HTTP/SSE/heartbeat, contextoSID e tradução SQLSTATE para403, schema Drizzle, consumidores web/mobile e cobertura finita dos domínios/projeções continuam ausentes. Não aplicar a API candidata ao schema067: ela espera as colunas propostas068. Não aplicar a migration parcial a um backend antigo sem SID/fluxos compatíveis. O cadastro obrigatório ainda não foi entregue.

A corrida de promoção durante disable permanece aberta. A revisão também pede provas de expiração durante espera por lock e persistência após triggers, sem alegar que essas hipóteses foram reproduzidas ou exploradas. A candidata SQL protege somente organizações/suporte; não protege devices nem todos os demais domínios/SSE. Não confundir o relógio055 com prova do fator nem tratar geração antiga como comprovação de fator novo.

O argumento de snapshot é um desenho a validar: funçõesSTABLE usam o snapshot da consulta que as chamou, conforme a [documentação PostgreSQL16](https://www.postgresql.org/docs/16/xfunc-volatility.html). Policies restritivas combinam com as permissivas porAND, mas donos/BYPASSRLS e operações sem linhas exigem tratamento próprio, conforme [segurança por linha](https://www.postgresql.org/docs/16/ddl-rowsecurity.html). Isso não comprova a implementação candidata; funções voláteis, projeções e escritas precisam de revisão específica.

## Como continuar em outro computador

1. Clone a main atual e leia CONTINUIDADE.md, a [corrigenda de política](../../superpowers/plans/2026-11-04-platform-admin-mfa-policy-refinement.md) e este manifesto. Se a funcionalidade já tiver sido publicada, use a nova fonte e não reaplique candidatos antigos.
2. Para reproduzir o baseline, crie uma cópia isolada da baseb259f80b158aff08f255a83f9d8ae551289d5fcf. Configure dependências pelo lockfile e um PostgreSQL/Timescale descartável próprio. Nunca usar instalação existente, .env real, segredo Apple ou credenciais da outra máquina.
3. Confira os hashes e use git apply --check. Aplique **somente testes-red.patch** para o ensaio RED sobre SQL001–067. A API candidata e o SQL candidato ficam fora desse baseline. No Windows, os checks de restauração usaram opções locais core.autocrlf=false/core.eol=lf, sem alterar a configuração global.
4. Use a fixture oficial packages/db/test/fixtures/runtime-services.ts, um banco UUID novo, bootstrap/provisionamento/seed fictício oficiais, seis URLs restritas e owner apenas para arranjo/observação. Recursos: parent256MiB, filhos384MiB, um processo por vez, guard de1536MiB livres antes e depois de iniciar o banco e antes de cada filho. Não baixar o guard para forçar execução.
5. Execute os dois arquivos em processos separados com Node/tsx, reporterTAP e test-concurrency1; imponha prazo externo e encerramento somente dos PIDs próprios. Os seis casos antigos não têm toda espera HTTP limitada internamente. O teste de corrida tem cancelamento/barreiras/cleanup limitados, sem garantia de cancelar SQL já enviado.
6. Classifique cada falha pelo assert e pela fixture. Erro de import, preparação, timeout, OOM ou guard não é RED do produto. Descarte o banco UUID inteiro, restaure roles/credenciais/settings por igualdade privada e confira clients/base/tempDB antes de repetir qualquer etapa. Não copiar a identidade do container desta máquina para outra.
7. Só depois dos REDs, avance a implementação em recortes coerentes, confira disponibilidade do número068 e revise ACLs/contratos/gates. O patch da API é ponto de partida, sem autorização técnica de rollout. Execute tipos, provas de geração/família, regressões, Playwright e aceites nativos antes de integrar/publicar como funcionalidade concluída.

A restauração realizada nesta rodada verifica somente os bytes das seis fontes a partir dos patches, não um projeto completo, banco ou execução. Não reiniciar o computador. Os detalhes da tentativa recusada e da parada exclusiva do banco estão na [evidência de recursos](../../evidencias/mfa-memory-refusal-2026-11-04.json).
