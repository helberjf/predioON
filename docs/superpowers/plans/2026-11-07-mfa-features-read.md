# MFA nas consultas de funcionalidades

**Implementado no candidato e validado em 07/11:** [22 TAP dirigidos e 259 de regressão](../../evidencias/mfa-features-read-2026-11-07.json). O plano abaixo conserva o desenho original e seus limites; não é aceite integrado de produção. Retomar pela [continuidade](../../CONTINUIDADE.md) e pelo checkpoint restaurável atual. O incremento de suporte está validado em seleção isolada; a obrigação MFA global continua candidata.

## Incremento 2: três GETs features, uma leitura de dados por resposta

apps/api/src/modules/features/routes.ts:32 /catalog retorna FEATURE_CATALOG estático após assertAdmin. Não inventar tabela nem envelopar catálogo como dados de banco. Dentro da transação, combinar a decisão features:manage com app_require_session_mfa em um SELECT explicitamente de autorização; resultado aprovado libera a constante original. Se conservar o assert anterior para erro compatível, a decisão final deve revalidar a capability na mesma operação da guarda. O catálogo não oferece promessa contra mudança posterior ao snapshot.

Linha36 /global: globalView (linha22) é usado também pelas mutações. Criar caminho GET exclusivo: uma SELECT guardada de global_feature_settings (key,enabled,version), seguida do resolveFeatures(global, [], 'global') original e override version=globalVersion original. Não alterar globalView compartilhado nem update.

Linha39 /buildings/:buildingId: assertBuilding (linha17) contém discovery e SELECT de existência separados. Para cobrir missing/empty sem 404 mascarando MFA, o caminho GET deve manter discovery e trazer existência de prédio junto ao envelope final guardado; somente depois decidir404. Não reutilizar assertBuilding se ele encerrar antes da guarda. Não mudar o helper compartilhado usado por PUT.

Uma projeção escalar guardada pode retornar `{exists,global,local,runtime}`: EXISTS do prédio sob RLS e três subconsultas agregadas, cada array coalesce[]; local/runtime filtrados pelo mesmo buildingId parametrizado. Todos no mesmo statement/snapshot. Usar readMfaRows existente sobre SELECT escalar com uma chave estática de ordenação, sem inventar campo no DTOHTTP, ou pequeno envelope GET dedicado equivalente. Decodificar key/boolean|null/version e resumedAt string|null; aplicar resolveFeatures e normalizar resumedAt com Date.toISOString exatamente como packages/db/src/features.ts:13–18. Não chamar readFeatures depois: ele faz três SELECTs separados. Não alterar readFeatures compartilhado por mutações nem locks/transições.

Preservar packages/shared/src/features.ts:42–54: ordem topológica FEATURE_CATALOG, teto global, intenção local nullable, opt-in, blockedBy, version/localVersion original e globalVersion; estados finais oito campos. Arrays SQL vazios continuam gerar defaults completos, não lista HTTP vazia. Não adicionar campos updatedAt dos registros à resposta.

Testes agrupados: PMF01/02 nos três GETs e no missing building, após última autorização observável; controles catálogo exato, defaults sem registros, combinações global/local nullable+versões+dependências/opt-in, runtime null/ISO, scope/discovery real, missing404 com MFA satisfeito. Para alegar atomicidade entre global/local/runtime, além da inspeção do SQL usar contador delegado da operação final e teste de concorrência controlado que observe resposta inteiramente anterior ou posterior; não dizer que simples barreira antes SELECT prova interleaving interno. Nenhum SD/customVOLATILE neste desenho.

## Regressões e limites

features-config.test.ts e building-feature-capabilities.test.ts têm atores ADMIN/flag; antes de executar selecionar só os atores HTTP que precisam cerimônia MFA real no mesmo bearer/SID, com helpers locais. Não adaptar automaticamente SQL withUserContext sem SID nem mascarar testes de ACL. features-unit, lifecycle e enforcement exigem inventário de seus acessos antes de selecionar regressão: esta nota não promete que estejam prontos.

O suporte já passou na seleção isolada, incluindo a ordenação DESC e as duas exceções do relógio nativo. Os três GETs de funcionalidades foram implementados no candidato; não se repete a guarda para cada uma das 24 chaves. Mutações e concessões POST/DELETE continuam fora deste lote. A seleção executada passou nos 22 TAP dirigidos e nos 259 de regressão. A prova interna de concorrência entre subconsultas continua pendente e não foi inferida do teste HTTP.


## Conferência adicional em 07/11: coordenação já existente

`inTenantContext` mantém `lockFeatures` compartilhado durante a leitura; o caminho de alteração toma `lockFeatureChanges` exclusivo. Preservar ambos. As três consultas atuais de `readFeatures` não demonstram, por si só, uma resposta incoerente durante uma alteração normal pela API. O objetivo da projeção única é vincular a verificação MFA aos dados dessa resposta e tratar existência/vazio no mesmo envelope.

O teste de concorrência deve distinguir o fluxo HTTP normal, que respeita esse bloqueio, de escrita direta pela conexão owner da fixture. Se usar um bloqueio de tabela para interromper a leitura e uma escrita owner para verificar o snapshot único, registrar que a escrita contorna deliberadamente o protocolo consultivo da API; não apresentá-la como reprodução de falha do fluxo normal. Incluir controle de serialização pela API e contagem delegada das consultas reais. Os testes de ausência de fator ou prova podem remover esses dados após a autorização real, sem alterar o mecanismo de funcionalidades.

## Fixtures identificadas para a próxima seleção

- `features-config.test.ts`: o ator HTTP `adminId` usa a flag administrativa e precisa completar cadastro/confirmação TOTP real depois do login; o gestor local continua sem obrigação adicional.
- `building-feature-capabilities.test.ts`: completar a cerimônia apenas nos atores HTTP `platform` (atribuição administrativa) e `legacy` (flag), preservando os outros cinco atores e as asserções de escopo/capacidade.
- As chamadas diretas `withUserContext`, inclusive as que fornecem um papel artificial para provar que o banco o ignora, não devem receber uma sessão inventada nem sofrer adaptação indiscriminada.
- `users-runtime-acl.test.ts` continua separado: revisar os dois casos HTTP administrativos pendentes, mantendo intactas as provas de privilégios por coluna, papéis e reexecução de migration. A inclusão nesta lista não significa que já foi adaptado ou executado com MFA.

As três consultas de funcionalidades concluíram a seleção de validação. O suporte foi validado no lote anterior, com os limites e achados posteriores registrados na continuidade. Investigar separadamente a latência observada na lista pessoal; não reutilizar resultados históricos como aceite das próximas alterações.


A prova de concorrência executada usa o PUT HTTP normal e o advisory lock existente. Não foi executado um teste de pausa dentro do statement final. A próxima fila está no [inventário de comandos](2026-11-07-mfa-proximos-comandos.md).
