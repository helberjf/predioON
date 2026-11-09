# Configurações globais e por condomínio: resultado de 09/11/2026

**72 casos dirigidos e quatro arquivos de regressão aprovados no candidato.** A composição tem 1.045 fontes. As execuções aceitas somam **120 TAP: 117 casos independentes e três grupos agregadores**, sem adicionar baseline, V1 ou resultados históricos. Zero falhas, cancelamentos, skips ou TODO na rodada corrigida. [Prova conferida caso a caso](../../evidencias/mfa-feature-commands-2026-11-09.json). Isso não representa homologação de produção, desempenho, navegador ou aparelho.

## Mudança e contrato

As rotas `PUT /features/global/:key` e `PUT /features/buildings/:buildingId/:key` continuam usando o mesmo comando. A operação exige MFA e a capacidade global real, mantém a trava exclusiva e protege a escrita por decisão materializada, ligada ao `INSERT ... SELECT ... ON CONFLICT ... RETURNING`. Confere resultado persistido, revalida após espera no registro e trata supressão de gravação como erro opaco. Não cria auditoria ou notificação de uma alteração inexistente.

As leituras de estado, alvo, versão anterior e resultado usam envelopes guardados e decodificação explícita. A projeção de condomínio existente foi extraída sem mudar seu SQL ou seus decoders. As transições permanecem dentro da transação, com o helper SQL VOLATILE original e sua ordem de efeitos. A revalidação ao retornar de cada transição permite desfazer o conjunto se a identidade perder validade durante a função. Auditoria, NOTIFY e resposta têm checagem final. NOTIFY só é entregue se a transação confirmar.

Permanecem: ordem do catálogo, 24 funcionalidades, oito campos públicos, versões otimistas, configuração global como teto, intenção local nullable, dependências de chamados, timestamps, gerações, número de condomínios afetados e metadados de auditoria. Schemas, políticas, migrations e helper SQL de transição conservam seus bytes. O runtime da main continua em 001–067; MFA obrigatória 068 permanece candidata e não deve ser ativada parcialmente.

## Prova antes e depois

Mesmas fontes de teste V2 nas duas versões, sobre o pai de 1.044 fontes. A diferença de produto é somente o router de funcionalidades. As três execuções aceitas observaram o commit `378114f3a4648c848ad89d373b6efec5194aa190` antes e depois; não houve edição entre as rodadas.

| Rodada V2 | Início UTC | Fim UTC | Resultado | Memória inicial MiB |
| --- | --- | --- | --- | --- |
| Baseline | 2026-11-09T04:32:11.685Z | 2026-11-09T04:34:50.690Z | 27 PASS /45 FAIL previstos | 3875 |
| Candidato | 2026-11-09T04:35:18.950Z | 2026-11-09T04:37:09.689Z | 72/72 | 3828 |
| Regressões | 2026-11-09T04:38:15.281Z | 2026-11-09T04:39:56.296Z | 48/48 TAP | 3960 |

Na baseline V2, 27 casos passaram e 45 falharam pelas razões esperadas. Cada falha foi classificada pelo nome, status, asserção e diagnóstico de verificações anteriores:

- 36 respostas 200 após retirada de fator/prova, quando se exigia 403.
- Oito conflitos 409 retornados após retirada de fator/prova, quando se exigia 403.
- Uma resposta 200 local com gravação suprimida, seguida de auditoria e aviso indevidos, quando se exigia erro 500 e reversão.

O caso global de gravação suprimida já falhava fechado na baseline. O candidato mantém essa recusa e passa a conferir diretamente o resultado de ambos os upserts.

Os casos novos usam login, inscrição, confirmação TOTP e o mesmo bearer/SID reais. A conexão dona prepara dados fictícios e mudanças negativas explícitas; não fabrica provas positivas de MFA.

## Cobertura dirigida

| Família | Casos | Evidência exigida |
| --- | ---: | --- |
| Retirada depois da autorização global real | 16 | Flag/vínculo global, escopo global/local, versão atual/obsoleta, fator/prova; erro e ausência de efeitos |
| Espera real no banco | 16 | Conexão restrita bloqueada pelo PID dono exato em trava advisory ou registro; estatísticas atualizadas; retirada e liberação confirmadas juntas |
| Retirada depois do NOTIFY real | 4 | Chamada SQL concluída dentro da transação; cliente recebe erro; alterações, auditoria e entrega da notificação revertidas |
| Triggers de retirada de prova ou exceção | 16 | INSERT, UPDATE, runtime e auditoria nos dois escopos; testemunha de sequência; efeitos e prova com data/geração restaurados; catálogo de triggers preservado |
| INSERT suprimido | 2 | Nenhuma alteração, auditoria ou aviso de sucesso; falha opaca |
| Positivos completos | 8 | Flag/vínculo, global/local, chamados/vagas; primeira gravação, desativação, reativação/herança e efeitos exatos |
| Síndico/morador sem capacidade global | 4 | Negação em ambos os escopos, sem ampliar autoridade |
| Concorrência, autoridade parcial e validação | 6 | Duas requisições na mesma versão resultam em 200/409; outra capacidade global não substitui features:manage; entrada inválida sem efeitos |

Os positivos verificam cada condomínio e funcionalidade dependente alterados, preservação da intenção no outro escopo, gerações/timestamps e estado das vagas. O condomínio com intenção local explicitamente falsa permanece inalterado. As notificações são observadas por LISTEN real; uma mensagem de controle confirmada após a requisição delimita a coleta. Isso evita tratar uma espera arbitrária como prova de ausência de notificação.

As exceções de trigger não expõem seus detalhes privados ao HTTP. A retirada da prova dentro da própria transação também deve ser revertida: o teste compara data e geração originais. Os dados do cenário são restaurados por igualdade, incluindo timestamps; sequências testemunham triggers executados mesmo quando a transação é desfeita.

## Regressões e tipos

| Arquivo | TAP | Casos independentes | Grupos |
| --- | ---: | ---: | ---: |
| features-config | 6 | 6 | 0 |
| building-feature-capabilities | 13 | 13 | 0 |
| platform-mfa-features-read | 22 | 19 | 3 |
| platform-mfa-feature-events | 7 | 7 | 0 |
| Total da regressão | 48 | 45 | 3 |

As quatro suítes são arquivos do pai, sem alteração. Algumas provas históricas de leitura/eventos usam fixtures SQL de MFA e conservam essa limitação; não são novas inscrições reais. Os 72 dirigidos são independentes, sem grupos adicionais. Resolução/importações e tipos passaram em baseline/candidato: quatro fases, 41 arquivos de teste e 14 fontes obrigatórias. [Tipos V2](../../evidencias/mfa-feature-commands-v2-types-2026-11-09.json). Compilação não substitui execução funcional.

## Tentativa V1 e preservação

A [baseline V1 foi preservada](../../evidencias/mfa-feature-commands-v1-review-2026-11-09.json): 25 PASS/47 FAIL. Foram reproduzidas as mesmas 44 divergências MFA e o sucesso falso local. Os dois erros extras vinham da restauração incompleta de `role_permissions.created_at` na fixture de autoridade parcial. O erro era de comparação exata no cleanup, depois das verificações funcionais. O caso global de INSERT suprimido já passou.

V2 restaura a linha completa do catálogo, inclusive a data, e classifica o caso global como PASS na baseline. Produto, asserções HTTP/efeitos e prazos permanecem iguais. Os payloads/manifestos executados V1 não foram editados. [Checkpoint V1](../2026-11-09-configuracoes-rascunho/README.md) e [checkpoint V2](../2026-11-09-configuracoes-rascunho-v2/README.md) conservam o estado anterior às respectivas execuções.

## Ambiente e recuperação

Cada rodada funcional usou banco UUID novo no contêiner exclusivo já em execução. Fontes, resolução das dependências e identidade do contêiner foram conferidas antes/depois. Bancos temporários e clientes foram removidos; seis papéis, credenciais privadas e configurações foram restaurados; todos os filhos registrados encerraram. Guard mínimo de 1.536 MiB e prazos originais mantidos. Nenhum segredo foi publicado.

Foi solicitado temporariamente que o Windows permanecesse ativo durante cada rodada; todas as solicitações foram retiradas ao terminar. Nenhuma configuração permanente de energia foi alterada. **O computador não foi reiniciado.** Não houve reinício/OOM do contêiner nos controles aceitos.

O [aplicador portátil](README.md) restaurou 1.044 → 1.045 arquivos em pasta nova; [recibo](../../evidencias/mfa-feature-commands-restore-2026-11-09.json). Todos os arquivos restaurados foram comparados com o candidato executado. Essa restauração só verifica fontes e não instala dependências nem repete testes. Imagens e vídeos históricos continuam na main com suas datas.

## O que falta

1. Complementar este comando com alvo ausente, promoção durante operação e retirada de autoridade durante efeitos de consumo, comandos de portão e entrega durável. Adaptar a autenticação de `features-lifecycle` para inscrição/TOTP reais e rodar a suíte e adjacentes de ingestão; seus cenários antigos ainda não foram aceitos nesta composição.
2. Seguir comandos de organizações, condomínios e equipamentos, outros leitores/helpers e domínios; cache privado; concorrências e exceções restantes.
3. Reexecutar regressão integrada de API/ingest, clientes, builds, jornadas Playwright e portais. Validar Android/iOS atuais em ambiente apropriado, inclusive câmera/hardware e distribuição Apple.
4. Concluir operação real, documentação consolidada, abertura dos sistemas e gravações completas de apresentação. CI, performance e produção ainda exigem seus próprios aceites.

Os resultados acima delimitam o recorte observado. Não demonstram ausência universal de corridas nem garantem toda a plataforma em produção.
