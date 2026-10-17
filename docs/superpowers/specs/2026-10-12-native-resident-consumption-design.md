# Consumo publicado no app Morador

## Contexto e escopo aprovado

Continuação das etapas 2C/5 da arquitetura aprovada. A main `6989248` contém a decisão do proprietário na 051: o morador não lê nível da caixa d'água; água e energia diárias só aparecem quando o síndico libera, com a liberação desligada por padrão. A web já tem a projeção. Esta meta acrescenta seu consumidor no app Morador Android/iOS em React Native sem Expo, conservando a mesma API, as mesmas permissões e as bibliotecas atuais.

Mostrar consumo agregado do condomínio, nunca consumo individual do apartamento, custo, tarifa, limites, bomba, medidores, nível/volume de reservatório ou configuração. O app Operação conserva sua navegação. Nenhuma migration ou mudança de backend é necessária.

## Desenho escolhido

Uma leitura compartilhada entre navegação e conteúdo, no nível de BuildingApp, reutiliza `useReadResource`/`createResourcePoller`. Comparada a um probe separado da tela, evita dois GETs por ciclo e mantém a disponibilidade ligada ao mesmo resultado que será mostrado. Uma camada nova de controllers não acrescenta garantia útil para este domínio somente de leitura.

Iniciar a leitura apenas para produto Morador, capacidade atual `monitoring:read-published` e uma das funcionalidades `ENERGY_CONSUMPTION`/`WATER_CONSUMPTION`. A rota real é `/monitoring/published?buildingId=...`, sem `/v1`. O cliente usa a origem validada e seu transporte autenticado existente; não chama inventário, resumo de operação ou painel privado.

O menu inclui Consumo somente depois de uma resposta autorizada validado do condomínio atual, com ao menos um item compatível com as funcionalidades atuais. PUMP, WATER_TANK, permissões técnicas ou gestão do prédio não concedem essa navegação. A evidência no Scope fica vinculada ao buildingId; ela não concede ações nem dispensa autorização no servidor.

## Contrato e estados

Resposta real: `{ buildingId, day, items: [{ kind, unit, today, history: [{ day, quantity, incomplete }] }] }`. `kind` é ENERGY/WATER; unidades são kWh/m³; `today` é número ou null, e o histórico tem no máximo sete dias. O leitor valida identidade, dias civis reais, duplicatas, quantidade finita não negativa, unidades e booleanos; copia somente esses campos e recusa respostas inconsistentes com erro genérico.

Somente ApiError 403 vira estado tipado de indisponibilidade. Rede, sessão, 5xx ou resposta inválida continuam erro, sem refletir corpo privado. `items: []` retira o destino: nenhum módulo aplicável foi publicado. Item com `today: null` e `history: []` significa ausência de medição, não zero.

Título Consumo do condomínio, Últimos 7 dias, cards Energia das áreas comuns e Água do condomínio. Exibir hoje e lista diária; dias ausentes ficam Sem medição, quantidade 0 vira 0,0 e amostra incompleta fica Parcial. Usar Card/Text/Badge/Refresh/ErrorMessage atuais, sem gráfico novo, ícones ou outro ScrollView. Formatar dia civil como DD/MM sem fuso do aparelho; derivar a janela em UTC e formatar quantidade pt-BR com uma casa decimal e fallback determinístico.

## Lifecycle e retirada de acesso

A chave do recurso inclui condomínio e revisão relevante das duas funcionalidades, incluindo version/globalVersion/resumedAt quando presentes. Alterar capacidade/funcionalidade invalida sincronicamente a projeção anterior; desativar e reativar com versão nova exige outro GET. O reader deve ter identidade estável entre renderizações ordinárias.

Background limpa o recurso; foreground exige leitura nova. Troca de condomínio/usuário/sessão e respostas tardias seguem gerações e controles existentes. 403 observado limpa quantidades, retira Consumo e usa o fallback de navegação; rede/servidor apresenta erro e retry no contexto do prédio, sem afirmar falta de liberação ou expor destino antes de primeiro sucesso. O View estável de BuildingScreen e seu fragmento de domínio Android permanecem intactos.

Uma decisão remota é observada no próximo polling existente, 15 segundos mais a duração do pedido, limitado pelo transporte atual. Não há promessa de retirada instantânea remota ou push nesta meta.

## Arquivos e aceite

Acrescentar `resident-consumption.ts` para DTO/leitor/projeção/formatação e `resident-consumption-screen.tsx` para apresentação. Adaptar somente `app.tsx` e `scope.ts`, com testes de leitor, navegação e componente/lifecycle renderizados. Features podem receber metadados opcionais já entregues pela API, sem novo contrato de servidor.

RED antes da funcionalidade; testar ausência inicial/403, liberação, energia/água, recusa de PUMP/WATER_TANK/Operação, condomínio divergente, null/zero/lacunas/parcial, mês/ano/bissexto, erro distinto de recusa, mudança de contexto e retorno tardio nas variantes Android/iOS. Verificar um GET compartilhado por ciclo, cleanup de listeners e StrictMode. Integrais mobile/cliente/UI, tipos, fronteiras, quatro bundles JS e revisões independentes precedem commit/push.

Os testes de host/bundles não aceitam Fabric, aparelho, Hermes real, Apple/XCTest ou produção. A API 051 e suas negativas têm provas próprias; este recorte não enfraquece essas regras nem recria capacidade de ler reservatório.
