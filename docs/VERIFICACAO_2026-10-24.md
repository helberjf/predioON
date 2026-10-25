# Entrada pública, testes e infraestrutura — 24/10/2026

Entrega baseada em `origin/main` `c53117d6`, migrations 001–058. O checkout antigo estava 292 commits atrás e continha alterações locais; foi preservado. A implementação foi feita em worktree separado a partir da main atual.

## Interface pública

Os três portais oferecem entrada mobile com **Login** e **Conheça a plataforma**, formulário desktop e a rota pública `/conheca`. Administração/síndico apresentam monitoramento e gestão, adaptando `marketing/APRESENTACAO_COMERCIAL.md`, com exemplo de consumo identificado como ilustrativo. O morador recebe uma página própria, voltada à rotina de quem mora. `/login`, convites, recuperação e MFA conservam os fluxos existentes.

Foram acrescentados 15 cenários de navegador, com a navegação gravada no Codegen e depois revisada: rótulos exatos, URLs de cada portal e asserções após as ações. A revisão visual incluiu 360/390 px e desktop, ausência de overflow e axe WCAG A/AA para problemas sérios/críticos na entrada, apresentação e login. O botão primário recebeu contraste maior.

### Apresentação própria do morador

Após a revisão do proprietário, o portal do morador passou a usar `ResidentPresentation`, com headline “Seu condomínio mais perto de você.”, ilustração HTML da experiência no celular, avisos, reservas, chamados próprios, contas publicadas, acessos autorizados e consumo quando liberado. A entrada mobile também tem texto e destaques próprios. O convite usa a rota existente; a página não inventa links de lojas nem oferece funções de gestão.

O teste novo primeiro falhou no título de morador, enquanto administração e síndico passaram. Após a implementação, a suíte pública passou **16/16** em Chromium, incluindo separação dos públicos, acesso por convite, layout e axe. O percurso foi regravado no Codegen, com **7 ações**. Tipos de UI/três portais e E2E, seletores, limites de módulos e os **115 testes da UI** passaram. A imagem Docker web foi reconstruída com sucesso. Capturas mobile/desktop foram abertas e conferidas, com origem e hashes em `imagens/2026-10-24/README.md`.

## Lacunas e falhas corrigidas

- **API de acesso de suporte:** duas primeiras concessões simultâneas podiam deixar dois grants ativos. A operação agora serializa pela linha autoritativa da equipe de suporte. O teste força concorrência real no PostgreSQL, exige um único grant ativo, confere auditoria e comprova que a revogação retira acesso na mesma sessão/JWT. Reproduzido antes da correção e aprovado depois, 4/4 no módulo.
- **Portal do condomínio:** o menu e a guarda de rotas consultavam somente capacidades amplas para chamados, regras, portões, vagas, auditoria e relatórios financeiros. Passam a considerar a cobertura de ocorrências e as listagens filtradas/autorizadas das próprias APIs. Uma concessão sobre um recurso não libera outras áreas nem concede criação. Dois testes unitários novos e os cenários E2E de concessão/revogação cobrem isso.
- **Expectativas antigas de navegação:** testes que esperavam páginas de regras/alertas/unidades e equipes para moradores sem capacidade, ou um link de chamados para uma conta sem leitura, foram alinhados à guarda de acesso atual. As negativas da API permanecem verificadas; nenhuma permissão foi ampliada para aprovar um teste.
- **Ingestão MQTT:** uma recusa de autenticação durante reinício da API podia impedir reconexão definitiva. O cliente volta a tentar a admissão; o teste real com broker recusa a primeira conexão, aceita a seguinte e recebe telemetria. Os nove testes de entrega passaram, mantendo comandos físicos sem fila offline.
- **VPS:** corrigida a disputa pelo IP reservado ao proxy, separadas credenciais administrativas em serviço transitório, validadas chaves/senhas antes da parada e removida execução de dotenv como shell. Caddy preserva a ordem do bloqueio interno e do streaming SSE.

## Evidências locais

Somente bancos e credenciais sintéticos em loopback; nenhum deploy em VPS foi realizado. Os logs e artefatos de navegador ficam em `.local/`, fora do Git.

| Verificação | Resultado |
|---|---|
| Pacotes da plataforma, última execução de cada suíte | 1.493 aprovados, zero falhas/skips: API 831, ingestão 205, UI 115, mobile 224, cliente 118 |
| UI após os dois testes novos de rotas | 115/115 |
| Entrega MQTT após a correção | 9/9 |
| Ingestão completa após a correção | 205/205, com banco real e as duas identidades restritas |
| Novos cenários públicos Chromium | 15/15 |
| Chromium completo, após as correções funcionais | 181/182; uma falha de transporte `net::ERR_NO_BUFFER_SPACE` ao consultar funcionalidades na página inicial do morador |
| Repetição isolada do cenário com falha de transporte | 1/1, sem alteração de código ou das asserções |
| Mesmo cenário em três execuções consecutivas | 3/3, mantendo validação de erros de rede e da tela |
| Contratos de implantação executados em Linux | 11/11, zero skips |
| Gerador de ambiente | 1/1; chaves correspondentes, segredos distintos e recusa de sobrescrita |
| Proxy em containers próprios | Cabeçalhos forjados substituídos, rotas internas bloqueadas e SSE entregue antes do encerramento da resposta |
| Compose de produção | Cinco imagens construídas; setup repetido sem reaplicar migrations; seis serviços saudáveis |
| TLS em ambiente isolado | HTTPS nos três portais e API, CA/hostname validados; MQTT TLS 1.3 validado |
| Tipos e estrutura | Typecheck dos pacotes, tipos E2E, limites de módulos e seletores verificados |

A regressão integral inicial aprovou 1.490 testes. UI e ingestão foram repetidas após os ajustes finais e os três testes novos, chegando ao total por pacote acima; API, cliente e mobile conservaram os resultados da integral. A regressão da API usa as conexões restritas e cobre identidade/sessões/CSRF/MFA, vínculos e capacidades, isolamento por condomínio/recurso, telemetria/alertas/regras, acessos/vagas, ocorrências, avisos/reservas, contas, ativos/ordens/automações, suporte, funcionalidades e saúde dos serviços. Não foi produzida uma porcentagem de cobertura de código.

A rodada local de navegador usa Chromium. A configuração do CI conserva a matriz Chromium, Firefox e WebKit; os resultados locais aqui não atribuem aprovação aos outros dois navegadores.

Comandos principais: `pnpm test` com as sete URLs do banco descartável e testes de integração habilitados; `pnpm test:e2e:chromium`; `pnpm --filter @predioon/ui test`; `pnpm typecheck:e2e`; `pnpm check:e2e-selectors`; `pnpm check:boundaries`. O guia [DEPLOY.md](DEPLOY.md) descreve os ensaios de infraestrutura e a instalação numa VPS real.
