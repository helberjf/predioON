# Execução da arquitetura de produto — Prédio ON

Base aprovada: [arquitetura](../specs/2026-09-27-arquitetura-produto-design.md). Execução em `codex/product-platform`, preservando o estado local anterior em cópia de trabalho isolada. Esta lista registra progresso real, sem considerar código não verificado como entregue.

## Sequência e aceite

- [x] 1. Contratos e cliente HTTP: separar DTOs e cliente portátil da UI, preservar consumidores web, testar renovação concorrente, troca de sessão, falhas de rede e fronteiras entre pacotes.
- [ ] 2. Identidade e RBAC: políticas por capacidade/condomínio; sessões com rotação atômica/revogação; migrations e RLS; vínculos/equipes; adaptação de consumidores e testes negativos de autorização.
- [ ] 3. Processamento durável: inbox/outbox, reserva/lease, workers por carga, recuperação após falhas, deduplicação e preservação da política de comandos físicos.
- [ ] 4. Domínios de produto: ativos e ordens de serviço, automações versionadas, planos/assinaturas e suporte com concessão explícita; API e gestão web integradas.
- [ ] 5. Aplicativos Morador/Operação: React Native sem Expo, armazenamento seguro, telas próprias por público, chamadas à API real, notificações e configurações nativas Android/iOS.
- [ ] 6. Implantação e operação: Compose, migrations registradas, credenciais restritas, backup/restauração, observabilidade, verificação de builds, regressão e documentação das dependências externas.

## Regras de execução

1. Reutilizar o banco, a API e os contratos existentes. Não reiniciar schema nem usar seed sobre dados reais.
2. Validar banco em container próprio de teste, porta local 5436, sem usar o banco de outros projetos.
3. Escrever testes de comportamento antes de mudanças de autenticação, autorização, filas e comandos; executar verificações apropriadas após cada integração.
4. Revisar conformidade com a especificação e qualidade do código; corrigir resultados relevantes antes de encerrar a etapa.
5. Novos papéis não podem receber acesso via comparação ordinal; ações continuam condicionadas ao condomínio/recurso e à política atual no servidor.
6. Não reenviar comandos físicos por políticas genéricas de retry. Chamadas a provedores não mantêm transações de jobs abertas.
7. Preservar os projetos web e compatibilidade de rotas durante a migração; nenhum aplicativo acessa diretamente banco/MQTT.
8. O aceite final distingue testes locais de builds móveis e integrações externas que exigem macOS, certificados, contas ou hardware.

## Registro inicial

- 27/09/2026: 159 arquivos alterados/novos anteriores foram copiados para a worktree; origem preservada.
- Verificação de tipos inicial dos oito pacotes executáveis existentes passou.
- Docker disponível. Ambiente Android/iOS e provedores externos serão verificados nas respectivas etapas.

## Evidências durante a execução

- Banco isolado `predioon-product-test`, porta 5436: schema atual, 12 scripts de infraestrutura e seed aplicados somente nesse ambiente.
- Regressão inicial: UI 23/23; API 102/103; ingestão 61/61. A falha da API era uma fixture dependente de telemetria prévia, ausente em um seed novo. O teste agora cria e limpa sua própria leitura; arquivo de segurança passou 10/10 após a correção.
- Snapshot SQL inicial gerado em `packages/db/drizzle/0000_baseline.sql` para preparar migrações controladas; ainda não substitui o fluxo de implantação e não foi aplicado em produção.
- Ambiente local sem Java, Android SDK ou ferramentas Apple detectáveis. Compilação nativa ainda não verificada; testes TypeScript não substituem builds Android/iOS.
- 28/09/2026: regressão da API passou 103/103 após corrigir a fixture. Os três painéis web compilaram; permanecem avisos de tamanho dos bundles, sem erro de compilação.
- Cliente compartilhado passou 25/25 testes e UI 28/28; revisão de conformidade aprovada após corrigir falha de rede durante leitura do corpo da resposta. Revisão de qualidade em andamento.
- Revisão final da etapa 1 aprovada: cliente 28/28, UI 28/28, fronteiras e seis verificações de tipos passaram. Correções adicionais impedem requisições antigas antes do envio após logout e bloqueiam imports de módulos nativos Node nos clientes. Nenhuma pendência nas duas revisões dessa etapa.
- Diagnóstico da autenticação atual confirmou duas renovações simultâneas aceitas para o mesmo refresh token em quatro de cinco tentativas. Falha corrigida na etapa 2A conforme evidências abaixo.
- 28/09/2026: migration `013-sessions.sql` aplicada no banco de teste isolado. Rotação concorrente, replay, logout por token consumido, revogação de todas as sessões, SSE revogado já aberto, conta inativa, expiração absoluta, isolamento por usuário e vínculos com janela de validade passaram em 9/9 testes. JWT EdDSA com `kid`, emissor/audience, rotação de chave pública e rejeição de HS/claims inválidos passaram em 4/4. API completa passou em 116/116; typecheck de API/DB passou.
- 28/09/2026: runner de migrations controlado passou em 5/5, incluindo lock concorrente, checksum, histórico divergente e rollback transacional.
- 28/09/2026: cliente SSE web passou a fechar a conexão ao erro, renovar a sessão pelo cliente HTTP e reconectar com o token atual; evita reconexão automática com JWT expirado. UI continuou em 28/28 e typecheck passou.
- 29/09/2026: fundação RBAC/tenancy aplicada no banco isolado via migration `014-rbac-tenancy.sql`, com reaplicação idempotente. Inclui catálogo explícito, blocos/unidades, equipes, concessões vigentes, suporte temporário e chaves compostas por condomínio. Novas APIs `/v1/tenancy` e `/v1/authorization` usam capacidades dentro da transação e auditoria atômica.
- 29/09/2026: regressão completa da API passou em **149/149**, sem testes ignorados, com `RUN_ACCESS_DB_TESTS=1` e `RUN_RBAC_DB_TESTS=1`. Inclui 17 testes PostgreSQL de RBAC, 9 do modelo compartilhado e 7 HTTP de tenancy. Foram reproduzidas e corrigidas a readmissão de integrantes revogados/expirados e a autorrevogação da concessão administrativa.
- 29/09/2026: UI passou em **32/32**, incluindo renovação/reconexão SSE, cancelamento ao desmontar, descarte de eventos antigos e backoff. Typechecks da API/UI e fronteiras de pacotes passaram. Revisões de conformidade e qualidade da fundação 2B aprovadas, sem achados pendentes no escopo.

## Divisão da etapa de identidade

- [x] 2A. Sessões e famílias de refresh: consumo atômico, detecção de reutilização, revogação imediata, listagem de sessões, JWT assimétrico e verificação de conta/vínculos atuais.
- [ ] 2B. RBAC e tenancy: catálogo de capacidades, concessões por condomínio/recurso, unidades/equipes, políticas RLS e credenciais de runtime restritas.
- [ ] 2C. Fluxos de identidade: cookies web/CSRF, MFA e verificação adicional para ações privilegiadas, convites/recuperação, limites de tentativas e adaptação dos clientes.

### Subentregas da etapa 2B

- [x] 2B.1. Fundação e API de tenancy: implementação, testes e revisões de conformidade/qualidade concluídos.
- [ ] 2B.2. Credenciais da API: separar identidade e autorização do broker, retirar importação/conexão proprietária dos processos HTTP, manter verificações negativas de privilégios e fluxo de sessões.
- [ ] 2B.3. Migração dos módulos existentes: aplicar capacidades e RLS por domínio, incluindo seleção de condomínios, funcionalidades e eventos; manter testes de revogação, suporte e acesso a recursos próprios.
- [ ] 2B.4. Gestão web integrada: cadastros de unidades/equipes/vínculos e seleção de escopo autorizada pelo servidor.
- [ ] 2B.5. Credenciais de ingestão e workers: conceder somente as operações de cada carga, junto da separação durável da etapa 3.
