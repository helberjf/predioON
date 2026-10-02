# Reservas nativas do Morador com API real

Estado em **02/10/2026**: roteiro implementado, testes do harness e contrato local aprovados; **execução Android deste roteiro ainda pendente**. Não transferir a aprovação dos fluxos de entrada/autenticação para estas telas. O workflow `.github/workflows/android-reservations.yml` produz um APK release x86_64 de verificação do Morador e usa PostgreSQL/API reais isolados.

## Contrato e isolamento

O conjunto reutiliza o cliente, as rotas e as migrations de produção. A fixture cria sua própria organização, dois prédios, dois usuários e papéis temporários. O morador possui somente descoberta do prédio, leitura de áreas e leitura/criação/cancelamento das próprias reservas. Dois bindings de recurso `common_area` concedem consulta do calendário das áreas de teste; não há membership legado, administração ou permissão para decidir aprovação. Uma reserva confirmada de vizinho contém unidade/anotações privadas; outra reserva pertence ao prédio estrangeiro.

Uma área confirma automaticamente; a outra gera `PENDING`. Ambas funcionam de 00:00 a 23:59, evitando dependência acidental do horário comercial. O prédio usa UTC, o processo de CI declara `TZ=UTC`, o emulador recebe `-timezone Etc/UTC` e o harness exige offset `+0000` antes de instalar o APK. A [opção oficial de fuso do emulador](https://developer.android.com/studio/run/emulator-commandline#common) evita herdar implicitamente o fuso do runner. A fixture usa uma data três dias à frente e intervalo de 19:00 a 20:00; `timezone.json` registra esses parâmetros. Isso verifica o contrato de horário do aparelho em UTC; casos de mudança de offset/dia de 23 ou 25 horas permanecem nos testes do adaptador, não são comprovados por este emulador.

O calendário existe dentro do formulário de criação atual. Não é uma nova tela para perfis que tenham apenas leitura de calendário. A consulta de disponibilidade expõe somente início/fim; nomes, unidades, anotações e identificadores de reserva do vizinho não fazem parte do DTO.

## Percurso observado

1. Recusar aparelho físico, boot incompleto ou fuso divergente; exigir HOME disponível e diagnósticos obrigatórios. Instalar somente o APK de verificação e autenticar a conta fictícia.
2. Abrir Reservas, selecionar a área automática e informar a data pela UI. Exigir o intervalo ocupado 19:00–20:00 e ausência dos dados privados. Trocar para a outra área deve mostrar calendário vazio; voltar deve recuperar a ocupação original.
3. Enviar uma única solicitação no intervalo ocupado. Exigir erro de conflito e snapshot com zero reservas/auditorias criadas pelo morador.
4. O ator externo da fixture cancela explicitamente a reserva do vizinho. Atualizar horários pela UI, verificar o intervalo livre e enviar uma nova solicitação explícita. Exigir `CONFIRMED` na API/banco e “Confirmada” na UI.
5. Abrir a confirmação nativa de cancelamento e escolher “Voltar”: nenhuma mudança no banco. Abrir novamente e confirmar: exatamente uma transição para `CANCELLED` e uma auditoria de cancelamento. Consultar novamente a área e exigir calendário vazio.
6. Solicitar a área que exige aprovação. Exigir `PENDING`/“Aguardando aprovação”, sem promover o resultado a confirmação. A prova local também confirma que o morador não pode chamar a rota de decisão.
7. Abrir o calendário, revogar somente seus dois bindings no host e realizar Home/retomada. Exigir mensagem de ausência de permissão, distinta de calendário vazio. A leitura das próprias reservas continua autorizada; a reserva estrangeira permanece intacta.
8. Sair e conferir formulário vazio, processo vivo e ausência de crash/ANR.

Os gestos de criação/cancelamento são únicos; observações de UI e snapshots podem esperar dentro de prazo, mas não reenviam mutações. A caixa de confirmação é reconhecida pelo título, mensagem e IDs dos botões nativos. Um diálogo de sistema/ANR não é tratado como confirmação de reserva. Rolagens apenas localizam controles reais; coordenadas vêm da árvore atual. Nenhuma tela é pré-programada e nenhum POST do host substitui as ações previstas no app.

## Transporte, limpeza e artefatos

TLS, CA temporária, assinatura, adaptação da URL, coleta e sanitização vêm do conjunto autenticado. A CA só entra no checkout descartável dos apps; o workflow compila apenas Morador. Não altera certificados de produção ou proteção do Windows. O proxy adicional aceita leituras de áreas/reservas/calendário/autorização, login/refresh/logout, criação de reserva e DELETE de UUID de reserva. A API continua decidindo a propriedade e autorização desse DELETE. A política padrão de autenticação continua recusando DELETE; rotas de decisão, administração e comando físico são negadas em ambas as políticas.

O snapshot exporta apenas contagens/estados: reservas próprias por estado, auditorias de criação/cancelamento, estado das duas reservas de fixture e quantidade de bindings de calendário ativos. Não contém tokens, senha ou dados de ocupantes. `create` é transacional, e `cleanup` exige banco descartável em loopback e identidades consistentes da fixture. A criação que falhe ao salvar o arquivo também limpa seus dados; o workflow executa limpeza com `always()`.

O upload contém `build.json`, `result.json`, XML/PNG das fases, snapshots, fuso e diagnósticos sanitizados. Exclui APK, arquivo de fixture, senha, tokens, certificados privados e chaves. Retenção de sete dias. A cada falha, preservar o artefato e distinguir ambiente, harness, contrato ou produto antes de corrigir. Screenshots não representam gravação: os vídeos solicitados continuam no [roteiro próprio](../android-auth-smoke/README.md#gravações-completas-ao-concluir-o-plano).

## Validação executada

O primeiro RED Python registrou o módulo de assertions ainda inexistente. O teste de transporte DELETE reproduziu depois `501` antes de implementar esse método no proxy comum. Após implementação, **oito testes Python passaram em Linux**, incluindo HTTPS real com CA, recusa de DELETE pela fábrica padrão, encaminhamento permitido sem aceitar comando físico, intervalos/vazio/negado distintos, confirmação nativa, persistência/duplicação, recusa de aparelho/fuso e falha terminal de privacidade. Passaram também oito testes autenticados e nove de domínios que usam o transporte compartilhado.

O teste de contrato real passou **1/1** em PostgreSQL isolado local (porta 5440). Verificou descoberta, catálogo próprio, DTO mínimo, recusa de reserva alheia, conflito sem escrita, cancelamento do vizinho pelo ator de fixture, criação confirmada, cancelamento próprio, criação pendente, recusa de decisão, revogação e persistência final exata. O typecheck Node desse conjunto também passou. Essas provas não executam os seletores no emulador.

```bash
python3 -m unittest discover -s scripts/android-reservation-smoke -p 'test_*.py' -v
python3 -m unittest discover -s scripts/android-auth-smoke -p 'test_*.py' -v
python3 -m unittest discover -s scripts/android-domain-smoke -p 'test_*.py' -v
pnpm --filter @predioon/api exec tsc --project ../../scripts/android-reservation-smoke/tsconfig.json
ANDROID_RESERVATION_DISPOSABLE_DB=1 pnpm --filter @predioon/api exec tsx --test ../../scripts/android-reservation-smoke/test_fixture.mts
```

O teste TLS exige OpenSSL; um resultado com esse caso ignorado não aprova o transporte. Antes do contrato real, configurar as quatro URLs de banco e aplicar bootstrap, migrations e papéis conforme `docs/MIGRATIONS.md`. O workflow executa `db:infra` duas vezes para também verificar a reexecução sem reaplicar migrations.

Limites restantes: primeira execução nativa, aprovação por administrador em outro produto, edição de regras, falha de conexão durante a ação, iOS, aparelho físico, acessibilidade/tamanhos/orientação, notificações e distribuição. Este roteiro não publica apps nem se conecta a equipamentos.
