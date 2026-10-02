# Navegação móvel por recurso e resumo de chamados — 02/10/2026

## Objetivo e limite

Corrigir a experiência de Operação para concessões válidas restritas a recursos, usando os contratos e endpoints já existentes. Incluir no resumo a contagem de chamados da migration 031, distinguindo universo inteiro, próprios chamados, recursos específicos, zero autorizado e indisponibilidade. O recorte está implementado e validado em helpers, tipos, bundle e API real conforme as evidências abaixo; sua execução visual nativa continua pendente.

Não criar novos domínios, regras de autorização no cliente, workers ou integrações de push. O Morador conserva sua audiência; a ampliação posterior de navegação por recursos de avisos/financeiro exige suas próprias consultas, pois esses domínios não estão presentes no overview.

## Evidência de partida

- `BuildingApp` exige uma resposta de `/v1/authorization?buildingId=...` para montar qualquer tela. Uma concessão somente em recurso não aparece nesse escopo e pode produzir 403 mesmo quando a descoberta e as APIs de domínio autorizam a leitura.
- `/overview/building` já devolve cobertura atual por domínio e `occurrenceVisibility`. Essas informações podem descobrir telas de leitura, mas não concedem `manage`, `acknowledge` ou `resolve`.
- A tela móvel de resumo ainda não apresenta `counts.open_occurrences`, `coverage.occurrences` nem `occurrenceVisibility`.
- Ações em alertas e chamados atualmente usam as capacidades consultadas para o condomínio inteiro. Uma permissão sobre um recurso não deve ser promovida para todos os itens da lista.

## Decisões

1. Usar o overview da API como evidência de leitura para Operação, respeitando o `buildingId` da resposta. `none`, erro, ausência ou resposta de outro condomínio não abrem telas. Um zero autorizado permite a tela vazia.
2. Manter separadas capacidades inteiras, cobertura de leitura e autorização de uma ação no recurso selecionado. Nenhuma cobertura parcial será convertida em uma capacidade de gestão.
3. Revalidar as consultas no primeiro plano e na cadência existente. Limpar dados ao entrar em segundo plano, mudar condomínio ou falhar a leitura; descartar respostas de gerações anteriores. Não repetir mutações ao retomar o app.
4. Antes de mostrar ações do item selecionado, consultar `/v1/authorization` com seu tipo/ID. Para alertas, a API permite concessão no alerta ou no dispositivo que a resposta atual associa a ele; qualquer união de capacidades deve conservar esses vínculos exatos. Uma concessão para outro dispositivo não serve para esse alerta. A API continua verificando o relacionamento e a permissão ao executar a ação.
5. Em chamados, gestão exata vale somente para a conversa correspondente. Criação depende da capacidade inteira `occurrences:create-own`; leitura parcial não cria essa capacidade. O Morador continua filtrando autoria e não ganha controles operacionais por usar uma conta com permissões maiores.
6. Apresentar o contador com texto explícito para `all`, `own` e `scoped`. `null` ou cobertura indisponível nunca aparece como zero nem como estado saudável.

## Testes antes da implementação

- [x] Reproduzir navegação bloqueada com resposta de overview parcial e autorização inteira vazia.
- [x] Contagem somente de chamados permite resumo mesmo sem telemetria/dispositivos/alertas; validar `own`, `scoped`, `all`, zero e indisponível.
- [x] Resposta de outro condomínio ou antiga não preserva telas; pausar TICKETS remove a navegação correspondente.
- [x] Permissão de ação de um alerta/dispositivo não afeta seus vizinhos; erro ou revogação remove os controles.
- [x] Chamado com gestão exata abre controles apenas da conversa selecionada; não habilita criação global.
- [x] Testar gerações de leitura e mutação: atraso de resposta, background e retorno não entregam resultado anterior nem reenviam comandos. A integração visual dos hooks no emulador é uma validação adicional ainda pendente.

## Validação e entrega

Executar testes mobile e do cliente, tipos dos dois apps e biblioteca, bundles Metro, fronteiras e `git diff --check`. Validar consultas e ações contra API/PostgreSQL isolados; testes de helper com respostas fictícias não serão descritos como evidência de backend. Registrar o commit e resultado de runtime quando a CI executar a nova fonte: o smoke de autenticação de outro commit não aprova estas telas.

Após este recorte, ampliar o E2E nativo de domínios com fixtures separadas: avisos e contas publicados/rascunhos, chamados próprios/vizinhos, revogação durante a sessão, reserva/conflito/cancelamento e conferência da persistência. Comandos físicos continuam fora desse percurso inicial. Vídeos por app devem acompanhar um roteiro explícito e não expor credenciais.

## Evidências de 02/10/2026

- Antes de alterar a produção, os dois casos novos de navegação falharam: 44 testes aprovados e 2 reprovados. A implementação antiga devolvia lista vazia para ambos os perfis. O registro local de desenvolvimento está em `work/mobile-resource-scope-red.log`, fora do repositório.
- Após a implementação, 51/51 testes da biblioteca móvel passaram, incluindo autorização exata por alerta/dispositivo/gateway, isolamento de vizinhos, distinção de erro transitório versus 403, contador próprio/parcial/inteiro/zero, expiração de confirmações e os testes existentes de intents físicas e renovação da sessão. Não houve teste ignorado nessa suíte.
- O ensaio `operations-scope.integration.mts` passou contra API HTTP real e PostgreSQL isolado na porta 5440. Criou usuário sem membership legada, com concessões específicas a um dispositivo e a um chamado. Confirmou descoberta parcial, reconhecimento autorizado persistido, recusa do alerta vizinho, alteração autorizada persistida do chamado, recusa do chamado vizinho e remoção de capacidades/navegação após revogar cada concessão. A tentativa posterior à revogação foi negada sem alterar o estado persistido. A fixture foi removida ao terminar.
- Typechecks da biblioteca, dos dois apps e do teste de integração passaram. O teste de integração tem configuração Node própria: importar o servidor sob tipos globais React Native causava conflito entre as classes `URL`; não foi necessário mudar nem relaxar tipos do servidor.
- Bundles Metro Android de Morador e Operação foram gerados com a fachada móvel atual do cliente compartilhado. Avisos do React Native sobre export interno e de variáveis de cor não impediram a geração. Bundle não equivale a compilação Gradle nem a execução visual.
- A verificação de fronteiras passou; `git diff --check` passou para os arquivos deste recorte.

As confirmações nativas capturam a geração de `useMutation`. Entrar em segundo plano a invalida, inclusive após voltar ao mesmo componente. Trocar condomínio ou identidade desmonta `BuildingApp`, cuja chave contém ambos os IDs, e desativa o runner anterior. O teste de substituição de tela confirma que um callback antigo não passa a usar o runner novo. Essa evidência de unidade não substitui apertar a confirmação no emulador durante essas transições. Toda ação continua sendo autorizada novamente pela API no momento da execução.

### Comandos reproduzíveis

Na raiz do repositório, com pnpm 10.17.1:

```powershell
pnpm --filter @predioon/mobile test
pnpm --filter @predioon/mobile --filter @predioon/resident-mobile --filter @predioon/operations-mobile typecheck
pnpm --filter @predioon/mobile exec tsc --project test/tsconfig.integration.json
node scripts/check-boundaries.mjs
```

Para o ensaio HTTP, provisionar primeiro um banco de testes vazio com `db:infra` e os papéis runtime documentados em `docs/MIGRATIONS.md`. Configurar `DATABASE_URL`, `DATABASE_URL_APP`, `DATABASE_URL_IDENTITY`, `DATABASE_URL_BROKER_AUTH`, `NODE_ENV=test`, segredo JWT exclusivo de teste e demais variáveis obrigatórias do servidor; nunca apontar para produção. O script recusa execução sem opt-in e banco em loopback:

```powershell
$env:RUN_MOBILE_DB_TESTS = '1'
pnpm --filter @predioon/api exec tsx --test ../../packages/mobile/test/operations-scope.integration.mts
```

O smoke Android de autenticação não entra nestas telas de domínio. Seu resultado, mesmo quando aprovado, deverá ser apresentado separadamente dos testes acima. Este recorte não entrega SDK de push, distribuição nas lojas, operação offline ou vídeo demonstrativo.
