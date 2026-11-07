# Overlay portátil: navegador com MFA obrigatória

Este pacote acrescenta **dois arquivos de QA**, sem alterar o produto V4:
o novo caso `e2e/specs/auth/platform-mfa.spec.ts` e a seleção desse caso no
config de Playwright. A fonte passa de 1.031 para 1.032 arquivos. Os três
casos anteriores, a fixture, o guard de memória, o entrypoint de QA e o produto
permanecem byte a byte iguais à V4. Esta autoria não afirma PASS do navegador.

## Restauração em outro computador

1. Restaure o checkpoint existente de 85 payloads de MFA/comandos de estrutura,
   que produz o candidato de 1.028 arquivos de fonte e cinco suportes separados.
2. Aplique diretamente o pacote portátil V4 de seis payloads sobre esses 1.028
   arquivos para obter a fonte V4 de 1.031 arquivos. Não é necessário aplicar
   V2 ou V3 antes da V4. O pacote V4 já contém cinco arquivos de QA e a correção
   candidata do login anônimo.
3. Aplique este pacote sobre essa fonte V4 para uma pasta **nova**, cujo pai
   já exista:

```text
node apply-browser-qa.mjs --candidate ../qa-browser-v4-1031 --output ../qa-browser-mandatory-1032
```

O parent deve corresponder ao prepared
`4cc08d2e503a00d14c4a1220b41ad30c7cc07072be5fc9c820bde5065c7e021b`.
O alvo corresponde ao prepared
`2abbf1a7fa9c7d54f6f0a6fc12938b3b14a27fa8da823590e8d9acb71a09087f`.
Esses pins identificam os inventários de fonte; o pacote não copia prepared.json
nem seus caminhos de máquina. MANIFEST.json contém os inventários completos,
com caminhos relativos, bytes e hashes de cada arquivo.

Antes de escrever, o aplicador confere a integridade do pacote, os 1.031
arquivos do parent e os dois payloads. Copia apenas o inventário, aplica o delta
e compara os 1.032 arquivos finais. O campo beforeBytes do arquivo novo é null
para representar ausência, conforme o contrato deste aplicador; o manifesto
original do teste usa 0, sem diferença de conteúdo. A receipt
`BROWSER-QA-RESTORE-RECEIPT.json` registra cópia e comparação, nunca aprovação
de testes. A receipt anterior e os cinco suportes do checkpoint inicial não
são copiados.

O comando não sobrescreve saídas, não instala dependências, não inicia serviços,
não aplica migrations e não executa testes. Nenhum dotenv, node_modules, cache,
dist, captura ou vídeo é distribuído. Não existem credenciais reais ou caminhos
absolutos de máquina no manifesto. Credenciais fictícias usadas pelo teste são
parte da fixture de QA.

## Escopo do caso separado

A seleção contém exatamente **um caso**: um administrador de plataforma novo
com vínculo local explícito conclui o cadastro de MFA pela interface real. O
caso observa a barreira inicial, as recusas da API, a retenção dos dez códigos
até a confirmação de que foram guardados, a abertura posterior do portal e a
recusa de desativar MFA obrigatória. Nenhuma sessão ou prova de MFA é fabricada.
Os três casos anteriores continuam no inventário e não são executados nesta
seleção. O portal administrativo separado não é iniciado por este recorte.

Prepare dependências conforme o lockfile em uma etapa própria. Os pacotes de
workspace devem resolver o src da nova árvore, sem links para checkout antigo
ou dist reaproveitado. A execução exige tipos e listagem do caso, build novo
e serial do portal e a fixture oficial runtime-services com banco UUID
descartável, roles restritas e seed fictício. Owner pertence ao setup; a API
usa APP/IDENTITY/BROKER_AUTH. Manter envio de e-mails desligado e segredos fora
dos logs. A restauração por si só não fornece o controller de banco/execução.

Mantêm-se Chromium com um worker, zero retries, API 4800 e portal 6974 em
127.0.0.1, NODE_ENV=test, E2E_TENANCY_CANDIDATE=1 e E2E_PORT_OFFSET=1700.
O guard exige 2.048 MiB livres antes das fases e com API/preview prontos; a
matriz completa exige 4.096 MiB. O guard de listeners existente usa Windows;
outra plataforma exige revisão explícita, sem desativar a verificação. Não
reiniciar computador, Docker ou WSL durante a sessão.

Screenshot e vídeo 1280×800 ficam ligados, trace desligado. **Nunca publicar o
vídeo bruto deste caso de MFA**, pois mostra chave e códigos de recuperação.
Apenas uma eventual captura final sem esses dados, revisada visualmente, pode
ser selecionada para documentação. Não é uma demonstração completa dos apps.

O encerramento registra filhos diretos conhecidos e portas dedicadas fechadas;
não há censo independente de todos os descendentes Chromium. Depois, conferir
remoção do banco temporário, restauração das seis roles/settings, catálogo e
hashes de fonte. A política 068 continua candidata e este pacote não a ativa
em produção. Android/iOS e aceite operacional permanecem verificações separadas.

A autoria deste pacote não executou o aplicador, Node, testes, banco ou serviços.
