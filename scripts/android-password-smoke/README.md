# Jornada Android de troca da própria senha

Este roteiro testa a tela real **Minha conta → Trocar minha senha** dos APKs de distribuição de Morador e Operação, instalados juntos em um emulador descartável. Ele usa a API real por HTTPS e confere metadados das sessões no PostgreSQL. O workflow dedicado é [`android-password.yml`](../../.github/workflows/android-password.yml); a jornada de autenticação anterior não foi alterada.

## Sequência e evidências

1. Confere o emulador, o término do boot e o banco local explicitamente descartável. Exige que as duas contas exclusivas do ensaio ainda não tenham sessões.
2. Instala os dois APKs e entra com as credenciais temporárias de cada conta. O banco deve mostrar uma família ativa por conta.
3. Abre a conta própria e verifica os três campos como entradas protegidas na árvore nativa do Android.
4. Envia uma senha atual incorreta. Exige o erro na tela e comprova que as famílias das duas contas permanecem ativas.
5. Sai da tela, retorna e confere separadamente que os três campos estão vazios, rolando quando necessário.
6. Confirma a troca com a senha atual correta e uma nova senha contendo espaços no início e no fim. Exige o retorno à entrada e a revogação no banco, sem classificar a troca como logout manual.
7. Abre o outro aplicativo e comprova que sua conta continua no estado esperado. Os snapshots sempre incluem as duas contas.
8. Encerra somente o processo do app em teste, abre novamente e exige a entrada vazia; isso verifica a remoção da credencial persistida após a confirmação.
9. Tenta a senha antiga e exige a negativa da API. Em novo processo, entra com a nova senha literal e encerra a sessão normalmente.
10. Repete a troca no segundo app e verifica que o primeiro permanece desconectado.

Cada conta usa cinco admissões: entrada inicial, tentativa de troca incorreta, troca correta, entrada antiga recusada e entrada nova aceita. O limite persistente real é preservado: capacidade de 20 admissões por conta, reposição durante 900 segundos, conforme a migration 035. Nenhum limiar, janela ou desafio é relaxado pelo ensaio.

No final, cada conta deve ter duas famílias criadas, nenhuma ativa, dois refresh tokens, nenhuma rotação e um logout manual. Esta jornada nativa possui uma família ativa por conta antes da troca. A revogação concorrente de várias famílias da mesma conta é responsabilidade dos testes de API e SQL, além desta verificação visual.

## Proteções do ensaio

- O guard de `ro.kernel.qemu` precede instalação, limpeza de dados e leitura de diagnósticos. A fixture também exige `ANDROID_AUTH_DISPOSABLE_DB=1`, banco em loopback e IDs exclusivos validados pelo adaptador existente.
- Se o preflight falhar, o driver publica apenas o resultado sanitizado. Não coleta `logcat`, árvore nativa ou captura de tela de um aparelho recusado.
- Vazamento de credencial, nome/e-mail/condomínio do outro app ou campo de senha desprotegido termina a jornada na primeira observação. Essas falhas não são convertidas em tentativas de renderização. Nenhum dos dois coletores é chamado depois de uma violação, pois os dois produtos compartilham o mesmo serial do emulador.
- Somente falhas transitórias de disponibilidade e XML podem ser observadas novamente, dentro de limites definidos. Uma ação de envio nunca é repetida para esperar sua resposta.
- O proxy acrescenta somente `POST /auth/password` à allowlist de autenticação existente. Abertura de portões, outras alterações de domínio e rotas de recuperação não são permitidas.
- A CA e as chaves são temporárias e só entram nos APKs de verificação do checkout descartável. Os APKs continuam com cleartext negado. Chaves, senhas, tokens, arquivos da fixture e APKs não são publicados como artefatos.

## Executar e interpretar

O workflow cria o banco, as contas, os certificados e os APKs de verificação, inicia API e proxy e executa:

```sh
python3 scripts/android-password-smoke/run_password.py \
  --fixture .local/android-password/fixture.json \
  --apks .local/android-password \
  --artifacts .local/android-password/evidence
```

As credenciais chegam pelas variáveis temporárias `ANDROID_AUTH_PASSWORD` e `ANDROID_PASSWORD_NEW`, mascaradas no GitHub Actions. Não forneça credenciais de produção. O driver exige uma nova senha ASCII distinta com espaços externos; a entrada via ADB usa lotes limitados e nunca tenta reparar ou reaplicar texto perdido.

O artefato `android-password-change-<run_id>` contém identificação e hash dos APKs, `result.json`, fases PNG/XML, snapshots das sessões e diagnósticos sanitizados. Só um `result.json` com `passed: true`, todas as fases e metadados corretos confirma esta jornada. Um build aprovado ou uma captura isolada não substitui a conclusão do roteiro.

Os testes do próprio verificador são executados assim:

```sh
python3 -B -m unittest discover -s scripts/android-password-smoke -p 'test_*.py' -v
```

O teste TLS real exige OpenSSL; sem ele, a suíte registra explicitamente um skip. O workflow Linux instala o ambiente com OpenSSL e exige também os testes compartilhados de autenticação e confiança.

## Limites da prova

Testes unitários do controlador móvel conferem Unicode, limites de bytes, senhas antigas verificáveis, comparação dos bytes equivalentes, literalidade, envio único e isolamento de ciclo de vida. Eles não executam a interface nativa. Esta jornada entra por ADB usando ASCII; a entrada de emoji pelo teclado deve ser homologada separadamente.

Bundles Metro Android/iOS conferem compilação do JavaScript dos dois produtos. Eles não comprovam a execução nativa de Android ou iOS. O resultado desta jornada Android não deve ser apresentado como homologação iOS, assinatura de loja, push APNs/FCM, aparelhos físicos, implantação pública ou conclusão do plano completo.
