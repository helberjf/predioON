# Consumidor web de acesso físico — API 034

Recorte autorizado após o checkpoint de backend 034. Não altera API, SQL nem o transporte MQTT. Consome o `useResource` compartilhado e integra os portais de administração e condomínio.

## Problemas observados

`AccessPanel` usa a prop do portal somada a `AccessList.canManage`, ocultando a configuração de gates concedidos por recurso exato. O editor depende de listas de inventário mesmo para preservar o controlador/gateway já autorizados. `available` vem corretamente da API 034, mas uma ação ainda usa o snapshot da tela sem nova consulta depois da confirmação.

O requestId incerto é guardado num ref do componente e apagado ao trocar de prédio ou desmontar. Voltar à tela após uma resposta perdida pode gerar outra identificação, embora o servidor já tenha recebido a primeira intenção. A nova interface deve preservar o identificador apenas na memória da sessão, nunca disparar POST por montagem, polling, reconexão ou retorno do foco.

## Comportamento proposto

- Ler gates exclusivamente por `/access`; configurar cada gate quando seu `canManage` atual permitir, sem exigir `buildings:manage` ou inventário geral. O campo agregado permite criar somente quando também há um controlador autorizado disponível no seletor.
- O editor conserva o gateway/controlador atual com rótulos mínimos quando não há inventário. Não recebe ID manual nem amplia os direitos para enumerar destinos. Configuração de outro alvo segue limitada aos destinos que a API já disponibiliza; a API continua decidindo no PATCH.
- Todo pedido de abertura exige confirmação explícita do gate e nova leitura da API. Após aguardar essa consulta, o POST só acontece se sessão, prédio, gate e tela continuam atuais e o documento continua visível. Background, navegação ou mudança de identidade invalidam a confirmação pendente.
- Guardar intenção por sessão + prédio + gate em memória no AuthProvider. A mudança de sessão invalida o store anterior imediatamente. Navegação entre telas/prédios preserva o requestId de uma resposta incerta; tentativa manual posterior usa a mesma identificação. Dois cliques não podem enviar duas requisições simultâneas. Polling só consulta.
- A reconciliação de uma intenção aceita apenas commandId/requestId/gate correspondentes, sem substituir a intenção incerta por um comando de outro usuário ou por outro histórico mais recente. Estado confirmado não volta a PENDING por respostas fora de ordem.
- Mostrar claramente resposta incerta, falta de permissão para consultar e execução reconhecida pelo controlador; isso não confirma a posição física do portão. Revogação remove o editor/ações e a API permanece autoridade de cada mutação.

## Provas antes e depois

Testes puros do store/guarda: dupla submissão, resposta perdida preservada entre montagens, reset de sessão descarta conclusão tardia, histórico divergente não substitui intenção, estados não regridem, retorno do foco não revalida uma confirmação antiga. Adaptar os testes de AuthActions para provar a limpeza em login/logout/restore/cancel sem invalidar refresh comum do token.

Playwright com API/PostgreSQL reais e nenhum dispatcher físico:

1. Gestor de gate exato sem inventário configura nome/política; não vê outro gate, não cria outro alvo; revogação fecha editor e impede PATCH posterior.
2. Leitor sem request vê o gate, mas nenhuma abertura é aceita; gate com request exige confirmação, conserva requestId e cria exatamente uma intenção após confirmar.
3. Resposta de POST perdida após o servidor aceitar, navegação SPA e retorno: nada é reenviado automaticamente; tentativa explícita repete exatamente o requestId original, inclusive quando o histórico está revogado e o replay retorna 403.
4. Nova leitura antes do POST retida em rede, seguida de navegação/background/troca de sessão: liberação da resposta não produz POST.

RED usa UI publicada antes deste recorte, backend 034/035 e fixtures isoladas. GREEN roda nos três motores disponíveis; WebKit usa Linux porque AppControl bloqueia suas DLLs no Windows. Não desativar proteção ou reiniciar o computador. Documentar falhas de infraestrutura separadamente de falhas de comportamento. Cleanup usa apenas IDs exatos das fixtures e retém evidência em `.local`, fora do Git.

## Limites

O store não é persistido e não atravessa fechamento completo do portal. A API continua com idempotência, throttle e ausência de replay físico, mas a interface não promete recuperar uma intenção cujo identificador saiu da memória ao fechar a sessão/página. Uma nova sessão limpa a memória anterior deliberadamente. Homologação com controlador real permanece fora da evidência de testes simulados.

## Entrega verificada em 02/10/2026

Implementados editor por gate, confirmação explícita, consulta atual antes de mutar, store por identidade, reconciliação monotônica e cancelamento de confirmações antigas. Os três portais passaram no typecheck/build; a suíte UI passou **83/83**. A API e o banco dos ensaios permanecem na fonte publicada até 035, sem a auditoria 036 em rascunho.

Os sete cenários Playwright passaram em Chromium, Firefox e WebKit: **21/21**, sem retries, com API e PostgreSQL reais e nenhum dispatcher físico. Na rodada anterior, 20/21 passaram; o último teste segurava um poll antes do clique e, por isso, desabilitava Salvar. A barreira agora começa no evento real de submissão, preservando as exigências de cancelamento e ausência de PATCH/POST. A simulação de visibilitychange verifica o contrato do navegador, não suspensão real pelo sistema operacional.

A matriz anterior de 153 combinações aprovou a interface antes deste recorte. Não somar 153+21 como se houvesse uma nova integral de 174; o CI da fonte publicada precisa confirmar essa nova matriz. Logs locais: work/web-access-final.log (20/21) e work/web-access-green.log (21/21); relatórios fora do Git.
