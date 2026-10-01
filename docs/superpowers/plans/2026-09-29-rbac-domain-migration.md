# Migração dos módulos para capacidades — etapa 2B.3

Detalhamento da arquitetura aprovada e do [tracker de execução](2026-09-27-product-execution.md). Esta sequência não altera o escopo do produto e não significa que os módulos abaixo já foram migrados.

## Sequência

1. **Condomínios e funcionalidades:** seleção de escopo a partir das concessões atuais; cadastro e edição com capacidades explícitas; acesso de manutenção e suporte às informações básicas e ao estado das funcionalidades do escopo autorizado.
2. **Leitura operacional:** [equipamentos e gateways](2026-09-30-equipment-capabilities.md), telemetria, alertas, monitoramento e dashboards com autorização por recurso. Moradores recebem somente as projeções autorizadas, sem herdar leitura técnica completa.
3. **Comunicação e atendimento:** avisos publicados, próprios chamados, agrupamento e administração; reservas e áreas comuns; financeiro publicado e gestão separados por capacidade.
4. **Configuração e atuação:** regras, provisionamento, estacionamento e comandos. Preservar concessões específicas, revalidação no despacho e a proibição de replay de comandos físicos.
5. **Administração e eventos:** usuários/vínculos legados, organizações, auditoria, suporte e SSE. Eventos consultam as capacidades vigentes do recurso antes de entregar cada mensagem. Encerrar os bypasses e comparações ordinais somente após migrar seus consumidores.

Cada subentrega recebe migration aditiva, testes negativos de HTTP e RLS, revisão de conformidade e revisão de qualidade. Não aplicar seed, recriar schema ou converter manutenção em um papel legado mais poderoso.

Na migração dos dashboards e dos consumidores web, distinguir contador sem concessão de contador zero. O painel administrativo atual deriva alertas de consultas sujeitas à RLS e exibe zero como ausência de problemas; isso precisa ser adaptado junto de uma projeção global explícita de saúde, antes do aceite integrado. Uma projeção global de saúde não pode liberar mensagens, leituras ou configurações privadas dos condomínios.

O [recorte corretivo de descoberta básica](2026-09-30-building-discovery-resource-validation.md) foi concluído com 019. A versão inicial de 016 consultava somente o escopo declarado; agora recursos inexistentes ou estrangeiros não permitem descobrir cadastro/estado básico. As policies de identidade/broker e capacidades operacionais foram preservadas. Recursos sem entidade concreta permanecem negados até suas migrations definirem o pertencimento.

## Primeiro recorte: condomínios e funcionalidades

- Preservar caminhos e formatos das rotas `/buildings` e `/features`; retirar desses handlers a decisão baseada no maior papel legado do usuário.
- Completar o catálogo com `buildings:read`, `buildings:manage`, `buildings:provision` e `features:manage`. Leitura básica pertence aos quatro papéis do condomínio; gestão do cadastro pertence ao síndico. A plataforma recebe capacidades globais explícitas de cadastro/provisionamento e funcionalidades. Essas capacidades não concedem leitura de conteúdo privado nem atuação física.
- A descoberta de um condomínio respeita conta, organização, condomínio, vínculo, equipe e vigência. Uma concessão limitada a recurso pode revelar o cadastro básico do condomínio necessário para selecioná-lo, sem ser promovida a uma concessão operacional para o condomínio inteiro.
- Suporte descobre somente condomínios com concessão diagnóstica válida, incluindo escopo de recurso e prazo. Revogar a concessão ou o papel de suporte retira imediatamente essa descoberta.
- Separar as políticas de leitura, inserção e atualização de `buildings`; manter políticas específicas de identidade e broker. Concessões de leitura nunca autorizam alteração. Administração global pode consultar cadastros desativados para reativá-los; operação local exige escopo ativo.
- O estado das funcionalidades é informação do escopo descoberto. Lê-lo não autoriza usar nem configurar o domínio correspondente. A edição das funcionalidades continua global e exige `features:manage`, inclusive na função privilegiada que aplica as transições.
- Para os módulos ainda não migrados, manter os guards legados isolados e documentados. Não ampliar um helper legado compartilhado para conceder acesso a todos os domínios por efeito colateral.
- Preservar auditoria transacional, controle de versão, locks de funcionalidades e cancelamento de comandos pendentes na pausa. Nenhuma nova configuração de funcionalidade pode elevar permissões.

## Aceite do primeiro recorte

- Usuário somente com role binding de manutenção consegue selecionar seu condomínio e consultar funcionalidades; não consegue editar cadastro nem funcionalidades.
- Acesso por equipe e por recurso funciona sem membership legado; expiração, revogação e equipe inativa retiram o acesso.
- Suporte sem concessão, com concessão expirada/revogada ou sem papel global vigente não descobre o condomínio. Uma concessão válida não abre outro condomínio.
- Síndico no A e morador no B só edita A. Revogar seu vínculo impede a próxima alteração mesmo com o mesmo access token.
- Plataforma com concessão global explícita consegue provisionar/configurar; conta desativada, papel revogado e contexto `app.role` forjado não autorizam a operação.
- Consultas PostgreSQL sem filtro não retornam condomínios alheios; INSERT/UPDATE diretos falham fora da capacidade. As credenciais identity/broker continuam operando com os privilégios do slice 2B.2.
- Testes anteriores de pausa/retomada, auditoria e controle de versão continuam válidos. API, tipos e consumidores web permanecem compatíveis.

## Estado

2B.2 e o primeiro recorte 2B.3 concluídos em 30/09/2026, com revisões de conformidade/qualidade aprovadas e API 176/176, sem testes ignorados. Telemetria HTTP/RLS e seus eventos SSE também concluídos: regressão API 210/210 e duas revisões por subentrega. Detalhes nos planos de [telemetria](2026-09-30-telemetry-capabilities.md) e [eventos](2026-09-30-telemetry-events-capabilities.md).

Os recortes [alertas HTTP/RLS](2026-09-30-alert-capabilities.md) e [eventos SSE de alertas](2026-09-30-alert-events-capabilities.md) estão concluídos e aprovados nas duas revisões. Regressão conjunta API 248/248, 30 suites, sem skips/cancelamentos; dez typechecks e fronteiras passaram. A correção de descoberta básica 019 também foi aprovada nas duas revisões; API integral 266/266. Equipamentos/gateways HTTP/RLS 020 concluídos e aprovados no escopo ampliado, preservando disponibilidade/abertura residencial por projeção mínima: API integral 288/288, 32 suites, sem skips/cancelamentos; tipos da API e fronteiras passaram. O corretivo de [vigência após espera 021](2026-09-30-authorization-time-windows.md) está concluído e aprovado nas duas revisões: API integral 316/316, 33 suites, sem skips/cancelamentos; tipos da API e fronteiras passaram. Também preserva avaliação única do escopo de telemetria em múltiplos chunks. Os próximos recortes são [eventos de equipamentos/funcionalidades 022](2026-09-30-equipment-events-capabilities.md) e [monitoramento/consumo 023](2026-09-30-monitoring-capabilities.md). Os demais domínios continuam pendentes; 2B.3 permanece aberta.
