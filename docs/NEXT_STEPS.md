# Estado da entrega — Prédio ON

O escopo funcional da entrega de 23/09/2026 foi implementado no código local, com disjuntor/extintor fora do escopo. A matriz e as evidências estão em [REVISAO_FUNCIONALIDADES.md](REVISAO_FUNCIONALIDADES.md). A proposta ampliada de 27/09/2026 está na [arquitetura de produto](superpowers/specs/2026-09-27-arquitetura-produto-design.md) e ainda requer implementação; os resultados anteriores não validam essa nova arquitetura.

## Validação local concluída em 23/09/2026

- Banco e broker ativos, com migrações adicionais 010 (suporte) e 011 (gestão e contas) aplicadas sem reset; o complemento do seed da entrega anterior permanece disponível.
- Validação ampliada: 144 testes passaram, sem falhas ou testes pulados (API 77, ingestão 50, interface 17), com tipos e build aprovados. Evidências em [Revisão de funcionalidades](REVISAO_FUNCIONALIDADES.md).
- Fluxo real de API → EMQX → controlador simulado → ACK → banco confirmado para garagem e pedestre, sem repetir o acionamento ao reenviar o mesmo pedido.
- Navegação autenticada e leituras do simulador conferidas; detalhes na matriz de funcionalidades.

Tipos e geração dos painéis/serviços passaram. Esses resultados validam o software local e os simuladores; o comissionamento físico depende da instalação real.

## Instalar no imóvel

- Definir sensores, medidores, mapa Modbus, entradas e firmware do gateway.
- Configurar as métricas de [sensores](SENSORES.md), tarifas e limites de [consumo](CONSUMO_E_ANALISE.md).
- Integrar controladores de [acessos](ACESSOS.md), com confirmação, expiração, deduplicação e teste físico antes de habilitar.
- Definir capacidade e origem da ocupação de [vagas](VAGAS_AVISOS.md).
- Configurar domínio, servidor, certificados, segredos, backup e restauração conforme [DEPLOY.md](DEPLOY.md).
- Conectar o provedor de WhatsApp/e-mail ao webhook caso esses canais sejam contratados.
- Cadastrar usuários e permissões e validar os equipamentos no local.

## Evoluções futuras

A direção atual é entregar **App Morador** e **App Operação (síndico/equipe de manutenção)** em React Native sem Expo, além dos painéis web de síndico e plataforma. Ambos os apps usam o mesmo backend e banco. A [sequência de evolução](superpowers/specs/2026-09-27-arquitetura-produto-design.md) inclui RBAC por capacidade, sessões, equipes/unidades, inbox/outbox, workers separados, manutenção, automações versionadas, planos/assinaturas e operação em uma VPS preparada para extração de cargas.

A integração de [suporte remoto com AnyDesk](SUPORTE_REMOTO.md) foi acrescentada ao painel administrativo: cadastro do computador por condomínio, preparação de acesso e registro manual do resultado, com autorização atual e auditoria. Instalar/configurar o AnyDesk e testar o computador real continua sendo etapa de campo.

No [plano de primeira instalação e heartbeat](superpowers/plans/2026-09-23-suporte-remoto-e-heartbeat.md), continuam pendentes a cadência independente de 60 s no equipamento homologado, diagnóstico da configuração, atualização automática da tela Gateways, tratamento de mensagens antigas e melhorias de queda/recuperação. A integração AnyDesk não altera o monitoramento do gateway.

A [gestão transparente](GESTAO_TRANSPARENTE.md) está implementada: chamados nos dois perfis, três gravidades, histórico com justificativas, agrupamento confirmado, atualizações públicas e prestação de contas mensal com revisões preservadas. O financeiro atual publica os valores informados; conciliação bancária, cobranças e pagamentos permanecem evoluções futuras.

Aplicativos nativos, fluxo dedicado de técnico, fotos, CFTV, armazenamento de arquivos, mTLS individual e modelos preditivos mais amplos permanecem evoluções futuras. O módulo atual de análise aprende uma referência estatística de consumo/tempo de bomba; não prevê falhas nem identifica automaticamente a causa.

Os [materiais de marketing](marketing/APRESENTACAO_COMERCIAL.md) e [exemplos de uso](marketing/CASOS_DE_USO_E_EVOLUCOES.md) descrevem as funções e suas condições de instalação.
