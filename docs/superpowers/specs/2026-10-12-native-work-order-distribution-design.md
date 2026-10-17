# Criação e atribuição de ordens no app Operação

## Escopo autorizado

Continuação das etapas 4/5 do produto já aprovado: o síndico e o gestor de manutenção distribuem ordens no app Operação conforme suas capacidades atuais. A API 043 e os contratos atuais já suportam criação e atribuição. Reutilizar essas regras, sem backend, migration, biblioteca, Expo ou permissão nova. Morador permanece sem esse domínio.

A meta entrega título, descrição opcional, prioridade e responsável opcional ao criar; reatribuição ou retirada de responsável de uma ordem aberta/em execução. Prazo, vínculo a ativo/chamado, cancelamento, anexos, checklists, automações e paginação da lista de ordens são recortes seguintes. Preservar a estrutura e as regras existentes de execução/histórico, ajustando somente os controles à autoridade atual, sem acrescentar outro ScrollView.

## Abordagem escolhida

Formulários nativos pequenos com um controller específico de gravação e seletores de diretórios já autorizados. Reutilizar o recurso da lista e os componentes Field/Button/Card; as novas partes são separadas do histórico e execução. Um formulário único genérico de CRUD acrescentaria abstração sem benefício aqui; digitar IDs ou listar `/users` não fornece a origem autorizada necessária para selecionar responsáveis.

O gate de distribuição exige `work-orders:assign` no escopo atual do condomínio e `canDistribute === true` na lista atual válida. Passar a autoridade do BuildingApp à tela para retirar o gate mesmo quando a lista anterior ainda existe. A autorização HTTP continua decisiva. Validar que os itens pertencem ao prédio consultado antes de mostrar controles; erro/403, troca de contexto e background invalidam a evidência.

As ações existentes de execução/anotação também respeitam a autoridade recebida: distribuidor atual ou `work-orders:read-assigned` + `work-orders:update-assigned` junto de `assignedToMe` na ordem atual válida. Um leitor de ordens atribuídas conserva lista/histórico, sem botões de gravação. Não promover grant por recurso a capacidade do condomínio nem alterar a política de status/notas.

## Diretórios e seleção

Pessoas: `/v1/tenancy/people?buildingId=...&limit=100`, somente com `memberships:manage` OU `teams:manage`. Equipes: `/v1/tenancy/teams?buildingId=...&limit=100`, somente com `teams:read`; gestão sem leitura não basta. As duas leituras exigem também distribuição atual e formulário aberto. Usar cursor `after` real para páginas seguintes e acumulá-las sem aceitar cursor repetido, IDs repetidos/divergentes ou respostas tardias de outro contexto. Oferecer carregamento explícito de mais opções, sem loop ilimitado.

O gestor de manutenção atual tem equipes, mas não diretório de pessoas; não ampliar privilégios para preencher o seletor. Sem diretórios autorizados ainda é possível criar sem responsável ou retirar o responsável atual. Não inventar opção Eu sem evidência do diretório, não digitar IDs, não inferir pessoas por team-members e não mostrar e-mail. Equipes precisam ser ativas e do mesmo condomínio; pessoas são cópias locais de id/nome. Um candidato só ligado a unidade pode ser rejeitado pela regra atual de vínculo de ordens: tratar o 400 sem alterar o servidor.

## Gravação e concorrência

Criar com `POST /v1/work-orders`: `{buildingId,title,description,priority,...assignment}`. Trim do título/descrição, título 1–160, descrição até 4000, prioridade LOW/NORMAL/HIGH/URGENT. Atribuir com `PATCH /v1/work-orders/:id`: `{version,...assignment}`, usando a versão atualmente lida. Um usuário ou uma equipe por vez; sem responsável envia ambos null. A seleção precisa continuar presente nas opções atuais no momento de enviar. DONE/CANCELLED não oferecem atribuição.

Controller por contexto controla uma gravação ativa, gerações, estado atual e feedback. Capturar contexto/versão, revalidar antes do envio e antes de atualizar draft/feedback/lista após resposta. Invalidação por troca de API/condomínio, retirada do gate, mudança da versão da ordem, background, unmount e StrictMode impede callbacks antigos de alterar a experiência atual. Isso não desfaz transação já enviada.

Sucesso atual fecha/limpa o formulário e solicita nova leitura da lista. Erros são mensagens fixas, sem corpo privado. 400 permite corrigir dados; 403/404 retira a ação e pede nova leitura; 409 invalida a atribuição até recarregar a versão. Rede/5xx ou resposta de gravação incompatível significam confirmação incerta: não repetir POST/PATCH automaticamente nem manter um botão que repita o mesmo envio. Oferecer conferir a lista e voltar; uma nova tentativa deve ser uma ação explícita após consulta, com versão atual para PATCH. Nenhum retry genérico de gravação é acrescentado.

## Aceite

RED real antes de implementar: gates e privacidade, payloads reais, opção pessoa/equipe/null, versão/conflito, diretórios paginados e negação independente, um envio síncrono por ação, erros sanitizados e resposta incerta, revogação/contexto/versão/background/unmount/StrictMode e callbacks tardios. Host React Android/iOS exercita os componentes reais. Preservar execução/histórico, renderer/container e consumo recém-publicado.

Revisões independentes de conformidade e qualidade, integrais mobile/cliente/UI, quatro tipos, fronteiras e quatro bundles JS de release precedem publicação. Prova de host/empacotamento não aceita aparelho, Fabric/Hermes, APK/Apple, XCTest/Keychain ou produção. A política e os testes de API existentes não são relaxados.
