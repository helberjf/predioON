# Disponibilidade e reservas no Morador nativo — 02/10/2026

Estado: helper, tela e integração local implementados; roteiro no emulador ainda a implementar/executar. Nenhum resultado deste plano deve ser apresentado como execução nativa aprovada antes do respectivo artefato de CI.

## Escopo baseado no produto existente

O plano de arquitetura atribui reservas ao Morador. A tela React Native atual seleciona área, recebe data/horário do aparelho, cria reserva e cancela reservas próprias após confirmação. A API029 já oferece ocupação privada em `GET /reservations/availability`, contendo somente `startsAt` e `endsAt`; o portal web já a consome. O novo recorte acrescenta essa consulta à tela nativa e prova criação/conflito/cancelamento usando o backend existente. Não altera API, SQL, política de aprovação ou distribuição dos produtos. Aprovação de reservas no Operação não está incluída neste recorte: o plano descreve outro conjunto operacional e sua UI atual não tem essa função.

## Contrato e autorização antes da tela

1. Reutilizar `ReservationAvailabilityQuery`, `ReservationAvailabilityResponse` e `reservationAvailabilityPath` dos pacotes portáteis. Não importar componentes ou estado do pacote web.
2. Converter o dia civil escolhido em início desse dia e início do próximo dia, no fuso do aparelho, emitindo instantes ISO explícitos. Não assumir que todo dia tem 24 horas. Testar dias de 23/25 horas, mês/ano bissexto, valores normalizados indevidamente e formato parcial.
3. Antes de buscar ocupação, consultar autorização para o `common_area` selecionado no condomínio atual. Exigir `reservations:read-calendar` desse contexto exato; criação, leitura própria ou gestão não serão tratadas como substitutas automáticas. O helper existente rejeita resposta de autorização de outro tenant/recurso. A própria API continua decidindo a autorização final da ocupação.
4. Sem data válida, área, feature atual ou capacidade pertinente, não iniciar consulta de ocupação. Um erro/403 não deve virar lista vazia ou promessa de horário livre. Nenhum nome, unidade, nota, usuário ou ID de reserva entra na apresentação de ocupação.
5. Troca de data/área/condomínio limpa a resposta anterior; background descarta conteúdo e retoma a consulta atual pelos mecanismos de geração já testados. Após conflito ou cancelamento, consultar novamente os horários sem repetir POST/DELETE.

## Tela nativa

No formulário de reserva, após a escolha de área/data, mostrar “Horários ocupados”, os intervalos e “Atualizar horários”. Explicitar “horário deste aparelho” tanto no formulário quanto na consulta. Estado vazio significa somente ausência de ocupação retornada naquela consulta; aviso permanente informa que o servidor revalida o horário ao enviar. Carregamento, falha de rede, ausência de autorização e data inválida permanecem distintos. A resposta do POST define CONFIRMED/PENDING; não inferir confirmação a partir da política carregada anteriormente na área.

O calendário não escolhe automaticamente uma vaga nem impede o servidor de decidir um conflito. A ação continua explícita e sem reenvio automático. O componente deve desmontar com a seleção e revalidar a autorização atual em cada leitura composta.

Limite atual: a consulta faz parte do formulário de criação, que já exige acesso às áreas, leitura própria e criação de reserva. Não é uma nova tela autônoma para perfis somente de leitura. A permissão de calendário continua independente e é consultada para a área selecionada; ter o formulário não concede automaticamente a leitura dos horários.

## Prova local e integração nativa separada

- Escrever testes de contrato antes do helper/componente: fuso/dia, autorização exata, ausência de query indevida, resposta mínima e erro que não simula vazio. Rodar a suíte mobile, typechecks dos dois apps e bundles Metro Android após a tela.
- Preparar fixture de reserva própria em banco descartável com grants mínimos, vizinho e segundo condomínio. Testar a fixture contra a API real antes de tocar no emulador. Não acrescentar memberships legadas para contornar RBAC.
- Reutilizar preparação, TLS efêmero, assinatura, ADB e sanitização dos harnesses atuais; ampliar só a política necessária para GET de áreas/ocupação/reservas, POST de reserva e DELETE de cancelamento. O proxy padrão de autenticação deve continuar recusando esses métodos/rotas, e comandos físicos permanecem proibidos.
- Fixar e registrar o fuso do emulador de verificação, gerar datas futuras relativas à execução e conferir instantes persistidos. Não fixar uma data que envelheça e torne o teste impossível. Entrada ADB de data/horário deve usar formatos estritos e não aceitar texto arbitrário de shell.
- O roteiro deve usar campos e controles reais, registrar PNG/XML por fase e snapshots mínimos de persistência. Não fazer uma chamada API no host fingir que a UI realizou uma ação. Revogação e mudança externa de disponibilidade pertencem explicitamente à fixture de teste.

## Roteiro de aceite a implementar

1. Login Morador e seleção do condomínio: nenhuma reserva/área/identidade estrangeira aparece.
2. Abrir área e data com ocupação de vizinho. Mostrar apenas intervalo; fixture/API verifica DTO sem IDs ou dados pessoais. Trocar data/área remove os intervalos anteriores enquanto a nova leitura carrega.
3. Solicitar intervalo ocupado uma vez. UI mostra conflito409; banco comprova ausência de reserva/evento novo do morador. O registro vizinho permanece intacto.
4. Fixture realiza mudança externa explícita que libera o horário. Tocar “Atualizar horários”, conferir mudança e efetuar nova ação de reserva. UI e banco confirmam exatamente uma criação com o status realmente retornado.
5. Abrir confirmação de cancelamento, escolher voltar e comprovar que nada mudou. Confirmar em seguida uma única vez; UI/banco mostram CANCELLED e o intervalo fica livre após nova leitura.
6. Solicitar outra área que exige aprovação. Exigir PENDING/“enviada para aprovação”, nunca “confirmada”. Se houver decisão por um ator externo na fixture, documentar que ela foi do host, não uma funcionalidade nativa do Operação.
7. Revogar exclusivamente `reservations:read-calendar` enquanto a consulta está aberta e retomar do background. Ocupação deve desaparecer; nenhuma concessão de criação/leitura própria pode restaurá-la. Negar leitura no backend e preservar dados de vizinhos.
8. Encerrar sessão e confirmar formulário vazio, ausência de crash/ANR, limpeza da fixture e artefatos sem senha, token ou chave.

## Evidências e limites

Os testes foram escritos antes do helper (RED inicial por módulo ainda inexistente). Depois da implementação, a integração real contra API/PostgreSQL isolado revelou um problema concreto: o endpoint SQL retorna timestamps como `2026-10-05 22:00:00+00`, enquanto o app precisa de um instante ISO portável para o parser Hermes. A asserção de integração falhou, e uma regressão unitária adicional reproduziu o formato PostgreSQL. O adapter passou a reconhecer exclusivamente data/hora com timezone explícito, normalizar offsets `+00`/`-0300`, reduzir frações de até seis dígitos à precisão de milissegundos e validar o dia civil antes da conversão. Datas normalizadas indevidamente, horário inválido e ausência de timezone são recusados. A API não foi alterada.

Após o ajuste, passaram 57 testes mobile (seis novos de calendário) e uma integração real no banco descartável da porta 5440. A integração usa concessão de calendário somente em uma área, verifica o DTO privado bruto, recusa outra área/tenant, comprova 409 sem criação/audit, libera uma reserva vizinha por ator externo explicitamente documentado, cria/cancela uma reserva própria e revoga apenas o binding do calendário preservando leitura própria. Os testes de datas incluem ISO com Z, offset com dois-pontos, texto PostgreSQL, microssegundos e dias locais de 23/25 horas. Isso é prova do adapter/API, não da interação nativa por UIAutomator.

O workflow Platform inclui uma etapa explícita após a regressão geral, usando o mesmo PostgreSQL descartável, `RUN_MOBILE_DB_TESTS=1` e `TZ=America/Sao_Paulo`. Essa etapa verifica também `test/tsconfig.integration.json`, pois arquivos `.integration.mts` ficam separados dos globais React Native e não são cobertos pelo typecheck comum do pacote. Comandos reproduzíveis após configurar os DSNs e as duas variáveis:

```bash
pnpm --filter @predioon/mobile exec tsc --project test/tsconfig.integration.json
pnpm --filter @predioon/api exec tsx --test ../../packages/mobile/test/reservation-calendar.integration.mts
```

O primeiro roteiro de domínios ainda está em estabilização de ambiente/harness; a execução `c106a78` parou antes da instalação por transição de HOME. O resultado desse calendário será registrado separadamente por commit/run/artefato e não herdará aprovações históricas de login. Android físico, iOS em runtime, notificações, aprovação nativa do Operação e vídeos completos continuam fora da evidência deste recorte até serem implementados e executados. A gravação futura seguirá o plano do README autenticado, com dados fictícios e proteção de credenciais.
