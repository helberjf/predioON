# MFA: checkpoint separado da proteção ao desativar o fator

Este diretório preserva um **candidato P0**, ainda não aplicado ao produto. O recorte já está incluído no conjunto ativo de 50 arquivos candidatos do [checkpoint de integração](../2026-11-05-mfa-integracao/README.md); este diretório conserva o antes/depois histórico, e seu patch não deve ser reaplicado ao conjunto atual. O patch depende da composição candidata restaurada com SQL 068; não deve ser aplicado isoladamente à API publicada com SQL 067.

## Estado das verificações

- Revisão estática independente: sem bloqueador identificado para o recorte descrito.
- Tipos da versão corrigida: PASS, 18.707 ms, processo encerrado antes da conferência final; hashes e junctions preservados.
- Resolução de arquivos da baseline: PASS, 2.553 ms; inclui a fonte MFA e o teste selecionado, sem importar fontes do checkout original. Resolução não é verificação semântica de tipos.
- Tipos da baseline: PASS, 17.878 ms; hashes e junctions preservados.
- Primeira tentativa de tipos da versão corrigida: timeout após 378.934 ms, SIGTERM, stdout/stderr vazios. **Causa desconhecida**; a tentativa posterior bem-sucedida não explica nem apaga esse registro.
- Banco, baseline na segunda tentativa: RED observado, quatro casos PASS e uma falha de asserção (HTTP 204 recebido; 403 esperado após promoção ADMIN antes do DELETE), 10.263,5642 ms, sem cancelamentos ou skips. A falha ocorre antes das asserções posteriores de preservação do fator.

- Banco, versão corrigida: cinco casos PASS, 10.535,618 ms, sem falhas, cancelamentos ou skips. Hashes e cleanup passaram em ambas as execuções: seis roles restauradas, zero bancos temporários e clientes restantes.
- A primeira preparação da baseline falhou no seed: zero testes, exit 0 acompanhado de timeout e falha de taskkill; causa desconhecida. A segunda tentativa preserva a primeira e separa observação de saída de processo e drenagem dos pipes, mantendo os prazos e a fonte.
- A evidência compacta está em [evidence/directed-red-green.json](evidence/directed-red-green.json). Esses resultados dirigidos não autorizam implantação nem comprovam MFA global.

## Bytes e dependências preservados

`raw/manifest.json` lista a fonte antes/depois e o teste. `raw/delta.patch` mantém o patch original; os arquivos `.ts.txt` preservam fonte sem entrar nos globs automáticos. `raw/handoff-v1.json` e `raw/README-original.md` são o freeze de autoria, cujo status histórico não é reescrito pelo resultado posterior de tipos. `evidence/` contém resultados separados, sem credenciais.

| Arquivo | SHA-256 |
| --- | --- |
| MFA antes | `3ffe785e821a708e7254abb21d88ac29b4e9ebbdc3398a85970295154962988b` |
| MFA depois | `7e8eabbf250ed010daa5c496b5ca2ae14a7d4a08333484b9f6e1a7816977babd` |
| Teste de cinco casos | `3306d7a8e703c996ba62f51814017e5b5576021e1251511aa3af5e706ca8d19e` |
| Patch | `bf060362ebccca62576995a8b4ce112618263c877273ad768cb125a61bc6d355` |

A base publicada da QA é `53c4c70dcd24f1045fad420fbce36757fd3753a2`. Os freezes compostos são `e907aa78e3442739dfcb5e8e74bda1e6041bc329f3e5d0f4889f4694a792c3b4` para baseline e `bf2f059fe62568999fb6c52512c38ada82aefe4a34d1ad193333585a8d12c332` para corrigida. Cada QA tem 994 arquivos-base e 1.012 arquivos compostos. Os runners e credenciais locais não integram este pacote.

## Recorte e limites

A proposta coloca a decisão de obrigação MFA e a exclusão da geração atual do fator na mesma instrução SQL. Obrigação verdadeira, nula ou ausente retorna 403 `MFA_REQUIRED`; obrigação falsa com exclusão ausente retorna 409. Mantém senha, consumo anterior do código e ordem de locks conta → família → fator.

O código de recuperação já consumido antes da promoção continua gasto se a exclusão for negada. O teste compara o fator e os códigos com o estado após esse consumo, sem imprimir segredos. Os controles cobrem ADMIN inativo, usuário comum, ADMIN já obrigatório e promoção SUPPORT sem obrigação ADMIN.

A garantia pretendida é o snapshot da instrução de exclusão. Não inclui promoção que comite depois de seu início, expiração durante espera por lock, triggers adversariais, outros mutadores ou proteção global. O ramo sem fator continua idempotente e sem mutação. As execuções usaram fixture UUID oficial e serialização, guard de memória, prazo externo e cleanup. As falhas de preparação foram classificadas separadamente das asserções de produto.

Para recuperar o recorte, restaure primeiro a composição candidata compatível em diretório novo, confira o hash **antes**, copie os dois arquivos de `raw/after/` removendo apenas o sufixo `.txt` e confira os hashes **depois**. Não execute automaticamente SQL, testes ou serviços durante a recuperação.
