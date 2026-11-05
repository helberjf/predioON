# P0: snapshot da desativação MFA — candidato externo

**Autoria somente. Nenhum Node, tipo, teste, SQL ou banco executado.**
O before é o arquivo restaurado exato
`work/mfa-portable-published-restored-20261105/apps/api/src/auth/mfa.ts`, SHA
`3ffe785e821a708e7254abb21d88ac29b4e9ebbdc3398a85970295154962988b`.
Não foi alterado. O patch contém uma fonte candidata e um teste novo; não muda
main, SQL068, migrations antigas, ACL ou componentes consumidores.

## Alteração proposta

Mantém senha verificada, consumo de código, locks account → family → factor,
negação antecipada e comparação de geração. Só o DELETE do fator passa a uma CTE
com decisão de obrigação e resultado explícito:

- `authority AS MATERIALIZED` consulta o helper identity-only existente;
- o DELETE da mesma geração só pode ocorrer se `required IS FALSE`;
- o SELECT externo retorna a decisão e a existência de uma linha removida;
- decisão ausente/null/true nega403 com o motivo atual `MFA_REQUIRED`;
- required=false com delete ausente/anômalo produz o409 de fator alterado.

Não há nova consulta posterior para reinterpretar a obrigação. O helper é chamado
pelo pool identity já autorizado; parâmetros de usuário/geração continuam ligados
ao contexto autenticado e ao fator travado. Não há nova permissão de app.

O PostgreSQL16 documenta snapshot comum entre o comando e as CTEs modificadoras e
o uso de RETURNING para comunicar seu resultado. **Inferência a validar:** a
obrigação capturada e a decisão de excluir pertencem à mesma observação SQL, sem
que uma revogação posterior converta uma negativa em sucesso. Não é promessa de
bloquear commits de promoção depois do início desse statement nem política global
para outros mutadores. [Referência primária](https://www.postgresql.org/docs/16/queries-with.html#QUERIES-WITH-MODIFYING).

## Cinco casos novos, sem execução

O teste usa app/rotas/cripto/recovery reais; somente o despacho da transação identity
recebe um proxy de teste, no padrão de testes existentes de capability. Nenhum hook
foi adicionado ao produto. A barreira reconhece o DELETE real (direto ou na CTE),
pausa antes de executá-lo, e só libera depois do commit owner controlado.

| Caso | Expectativa dirigida |
| --- | --- |
| Binding ADMIN inativo ativado depois do último gate, antes do DELETE |403 `MFA_REQUIRED`; fator e recuperação iguais ao snapshot **após** consumo; código gasto não é reutilizável |
| Binding ADMIN continua inativo |204; fator e códigos removidos normalmente |
| Conta comum sem binding global |204; comportamento opcional preservado |
| ADMIN já ativo antes da chamada |403 antecipado; nenhum recovery code consumido |
| Binding SUPPORT ativado na barreira |204; SUPPORT sozinho não vira obrigação ADMIN |

O binding é criado inativo **antes** do request. A promoção faz UPDATE active do
registro existente, não INSERT nem UPDATE users enquanto o lock da conta está
preso. Usa oracle de obrigação real, timeout SQL owner2s/3s e barreiras5s existentes;
sem sleep, retries ou mudanças de prazo do produto. Se o request termina antes da
barreira, o teste observa a resposta e falha como preparo/comportamento, sem
fabricar um RED por timeout silencioso.

O recovery usado no disable já foi consumido em transação anterior. O snapshot de
comparação ocorre depois disso: espera dez linhas, uma usada, nove disponíveis.
A negativa não restaura esse código; um `/auth/verify` com o mesmo código espera400.
Rows sensíveis ficam em memória e só a igualdade booleana de fingerprints é
assertada, evitando imprimir ciphertext, códigos ou hashes nos logs.

## Ensaio futuro e limites

Baseline deste recorte é a composição restaurada com068 V3 e API candidata **antes
deste patch**, não a API publicada067. Em cópias isoladas, usar o mesmo teste novo
primeiro com before e depois com after, em UUID oficial nova para cada ensaio.
Expectativa ainda não observada: baseline4 controles PASS +1 falha de status204vs403;
after5PASS. Preservar logs/bytes/exit e classificar qualquer falha de fixture antes
de editar. A raiz e o peer precisam revisar e autorizar a execução com guard fresh.

O branch idempotente `!current && !factor` continua retornando sem mutação e sem
a CTE; ele não ganha uma nova garantia de snapshot. Expiração durante lock,
triggers adversariais/readback, zero-delete anômalo, outros mutadores e SD/SSE são
pendências separadas. Nenhum desses cinco casos autoriza afirmar cobertura global
ou transferir PASS dos nove/onze testes anteriores.

Cleanup libera barreiras, observa o request/dispatch, restaura o método original e
remove só o usuário sintético (cascade de bindings/sessões/fatores/códigos). A suíte
fecha apenas seu listener e usa os hooks existentes para pools identity/broker.
Não há novo runner, dependência, env, restart ou mudança de runtime publicado.
