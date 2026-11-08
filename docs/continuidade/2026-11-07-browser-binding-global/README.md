# Overlay portátil: MFA por vínculo global sem flag legado

Este pacote contém **dois arquivos de QA**: o novo teste
`e2e/specs/auth/platform-mfa-binding.spec.ts` e a seleção desse caso no config.
O produto, helper, teste obrigatório por flag e três casos V4 permanecem iguais
ao parent. A composição passa de 1.032 para 1.033 arquivos. O pacote não
afirma aprovação de navegador, integração ou produção.

## Sequência de restauração

1. Restaure o checkpoint de 85 payloads de MFA/comandos de estrutura: 1.028
   arquivos de fonte e cinco suportes separados.
2. Aplique diretamente o pacote portátil V4 de seis payloads sobre os 1.028
   arquivos para obter 1.031. Não aplique V2/V3 antes da V4.
3. Aplique o pacote obrigatório de dois arquivos de QA sobre V4, obtendo 1.032.
4. Aplique este pacote de vínculo global sobre a etapa obrigatória, para uma
   pasta **nova**, cujo diretório pai já exista:

```text
node apply-browser-qa.mjs --candidate ../qa-browser-mandatory-1032 --output ../qa-browser-global-binding-1033
```

Parent: `2abbf1a7fa9c7d54f6f0a6fc12938b3b14a27fa8da823590e8d9acb71a09087f`.
Alvo: `36e5b4a28d0c9b24d2b7420b9401366dad4d1842c7597238a84e283c958c902e`.
Os pins identificam inventários de fonte; prepared.json e caminhos locais
da máquina original não são copiados. MANIFEST.json contém todos os caminhos
relativos, bytes e hashes do parent e do alvo.

O aplicador verifica o pacote, todos os 1.032 arquivos de entrada e os dois
payloads antes de escrever. Copia só o inventário, aplica os deltas e compara
os 1.033 arquivos finais. beforeBytes é null para o arquivo novo neste esquema;
o manifesto original do teste usa 0 para a mesma ausência. A receipt
`BROWSER-QA-RESTORE-RECEIPT.json` comprova restauração, nunca execução de testes.
Receipts anteriores e os cinco suportes iniciais não são copiados.

Não há sobrescrita, instalação, execução de testes, migrations ou serviços.
O pacote não copia dotenv, node_modules, caches, dist, vídeos ou imagens. Não
inclui credenciais reais, links de dependências ou caminhos absolutos de máquina.
As credenciais fictícias do teste pertencem à fixture de QA.

## Autoridade e contrato do cenário

A seleção executa somente **um caso**. O ator é criado por HTTP com
`isPlatformAdmin: false` e recebe um vínculo local BUILDING_ADMIN por HTTP.
A fixture SQL insere exclusivamente um binding global PLATFORM_ADMIN para esse
ator no banco UUID descartável, com escopo global, ativo e sem datas limitantes.
Essa atribuição inicial é preparo da fixture, não aprovação de uma API pública
de administração RBAC. O readback confere o flag falso, o vínculo local,
a autoridade global e a obrigação de MFA. Não se escrevem fator, sessão,
prova de MFA, flag de usuário ou códigos diretamente.

O contrato de identidade continua sendo **BUILDING_ADMIN** no DTO legado de
login, acknowledgment e após a recusa de desativação. A obrigação MFA deriva
do binding global; não se deve trocar o DTO esperado para PLATFORM_ADMIN para
fazer o teste passar. Login, senha, TOTP, confirmação, domínio e recusa de
desativação usam o backend real. O mesmo bearer da interface fica só em memória.

O novo caso conserva o bloqueio inicial, os dez códigos retidos até confirmação,
as observações de requisições da página e a recusa403/MFA_REQUIRED sem consumo
do código. O limite de rede é page.on(request), sem atribuir ao observador
instrumentação interna dos providers ou atomicidade universal de parsing.
Os quatro casos anteriores ficam presentes, mas não são reexecutados nesta
seleção. Não há baseline RED previsto nem aceite inferido da autoria.

## Execução posterior e limites

Dependências e controller de banco são preparação separada. Use o lockfile e
faça os pacotes de workspace resolverem o src da nova árvore; não use links
de checkout antigo ou dist reaproveitado. Tipos, listagem do único caso e build
novo serial precedem o ensaio. A fixture oficial runtime-services cria banco
UUID descartável no cluster owned; owner fica no setup/teste e a API usa apenas
APP/IDENTITY/BROKER_AUTH. Não habilitar e-mail ou publicar segredos dos logs.

Mantêm-se Chromium, um worker, zero retries, API 4800 e portal 6974 em
127.0.0.1, NODE_ENV=test, E2E_TENANCY_CANDIDATE=1 e E2E_PORT_OFFSET=1700.
Exigir 2.048 MiB livres antes das fases e com API/preview prontos; a matriz
completa requer 4.096 MiB. O guard atual de listeners é Windows; outra
plataforma exige revisão explícita, não sua desativação. Não reiniciar
computador, Docker ou WSL durante a sessão.

Captura e vídeo 1280×800 permanecem ligados, trace desligado. **Não publicar
o vídeo bruto de MFA**, que mostra chave/códigos da fixture. Só uma eventual
captura final sem esses dados, revisada visualmente, pode ser selecionada.
O recorte não é uma demonstração completa dos apps.

Após encerrar filhos diretos registrados e portas dedicadas, conferir remoção
do banco, restauração das seis roles/settings, catálogo e hashes. Isso não é
censo independente de descendentes Chromium. O cenário não cobre promoção
concorrente, suporte, todas as autoridades, outros portais/motores, Android/iOS,
carga ou operação. A política 068 continua candidata; nenhuma ativação de
produção é realizada por este pacote.

A autoria não executou o aplicador, Node, tipos, testes, banco ou serviços.
