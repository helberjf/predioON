# Sessões Android com API real

O workflow [android-auth.yml](../../.github/workflows/android-auth.yml) acrescenta autenticação real à verificação dos dois aplicativos. O [smoke de inicialização](../android-smoke/README.md) permanece separado. A existência deste código não comprova aprovação no emulador: é necessário conferir o job e o `result.json` do commit executado.

## Ambiente e fronteiras

O job cria PostgreSQL descartável, aplica o bootstrap e o runner de migrations duas vezes, provisiona os três papéis restritos e inicia a API real. Duas contas sem membership legado recebem concessões locais `RESIDENT` e `MAINTENANCE`, cada uma em seu condomínio próprio. As fixtures usam IDs aleatórios; sua remoção alcança somente esses registros. O CLI recusa execução sem confirmação explícita de banco descartável em loopback. Nenhuma migration, rota ou configuração de autorização é substituída para atender ao teste.

Um proxy local serve HTTPS em `https://10.0.2.2:3443`, o endereço do host acessível pelo emulador. O proxy aceita somente as rotas de sessão, perfil, descoberta de condomínios e health; não encaminha comandos de portão. O backend é sempre `127.0.0.1:3000`, sem destino arbitrário. Não há broker nem equipamento real conectado.

O CI gera uma CA e um certificado válidos por um dia, com SAN para os IPs `10.0.2.2` e `127.0.0.1`. Somente os APKs de verificação recebem a CA e uma Network Security Configuration que proíbe tráfego HTTP e confia nessa CA. O adaptador exige `CI=true`, recusa configuração de rede já existente e atua somente no checkout descartável. Não altera o trust store do sistema, não instala CA no Windows ou em aparelho físico, não usa `trust-all` e não remove a verificação de hostname. Os APKs são assinados com chaves efêmeras próprias de teste e não são publicados. Os arquivos nativos e a URL de produção versionados permanecem inalterados.

Essas decisões seguem as ferramentas oficiais de [configuração de segurança de rede](https://developer.android.com/privacy-and-security/security-config) e [rede do emulador Android](https://developer.android.com/studio/run/emulator-networking). A confiança adicional de CI não constitui teste do certificado/domínio de uma futura API de produção.

## Fluxos observados pelo teste

Os dois APKs release x86_64 são instalados no mesmo emulador API 35. O script verifica `ro.kernel.qemu=1` antes de instalar ou limpar dados e não reinicia o aparelho ou computador.

1. Uma senha incorreta recebe a mensagem da API e não cria sessão no banco.
2. Cada app autentica sua conta fictícia; a UI precisa mostrar produto, nome, e-mail e somente o condomínio esperado. O outro app continua sem sessão até receber seu próprio login.
3. Home/retomada preserva a identidade correta. Encerrar e reabrir o processo restaura o refresh token pelo armazenamento nativo, cria exatamente uma nova geração no backend e conserva a mesma família de sessão.
4. Sair no primeiro app revoga sua família e mantém o segundo app autenticado. Depois de sair nos dois, novo processo deve exibir formulário vazio em ambos.
5. Um novo login cria outra família, seguida de novo logout. O script exige ausência de crash/ANR e coleta a tela final.

O prazo de acesso do backend de CI é 30 minutos para que rotação por expiração não se confunda com a rotação deliberadamente provocada ao encerrar o processo. Os prazos de produção não mudam. Expiração por tempo e concorrência de refresh possuem testes de API/cliente separados; não são demonstradas por este fluxo.

## Evidências e credenciais

O verificador do host consulta apenas contagens por usuário: famílias criadas/ativas, motivo `LOGOUT`, refresh tokens criados/ativos e gerações substituídas. Não consulta nem exporta tokens ou hashes de tokens. O estado esperado distingue login, rotação e revogação:

| Etapa por usuário | Famílias totais/ativas | Refresh tokens totais/ativos | Rotações | Logouts |
| --- | --- | --- | --- | --- |
| Senha inválida | 0/0 | 0/0 | 0 | 0 |
| Primeiro login | 1/1 | 1/1 | 0 | 0 |
| Reabertura do processo | 1/1 | 2/1 | 1 | 0 |
| Logout | 1/0 | 2/0 | 1 | 1 |
| Novo login | 2/1 | 3/1 | 1 | 1 |
| Logout final | 2/0 | 3/0 | 1 | 2 |

O artefato contém `build.json` de cada APK, `result.json`, capturas/XML das fases, snapshots dessas contagens e diagnósticos sanitizados. A senha é aleatória por job e mascarada no GitHub. O coletor remove a senha, JWTs e tokens opacos de textos; se a UI expuser credenciais, o teste falha e omite a captura final insegura. Os logs da API/proxy só entram no artefato depois da sanitização. A lista de upload exclui os APKs, CA privada, chave TLS, chave de assinatura, arquivo de fixture e qualquer arquivo de configuração de credenciais. Retenção: sete dias.

## Validação disponível

Antes da primeira execução nativa, foram verificados localmente:

- dez testes do smoke de inicialização, incluindo a recusa de origens arbitrárias no adaptador de CI;
- oito testes do harness autenticado em Linux, incluindo TLS real com CA correta, rejeição de CA desconhecida/hostname incorreto, recusa da rota de portão, isolamento de identidade, sanitização e omissão de capturas quando credenciais aparecem na UI;
- bootstrap 001–031, segunda execução sem reaplicar migrations e fixture/snapshot em banco isolado;
- API real local para as duas contas: senha inválida, login, perfil, descoberta somente do condomínio próprio, refresh, logout e recusa do acesso revogado; as contagens finais corresponderam a uma família revogada e uma rotação por conta;
- limpeza da fixture no banco isolado seguida de snapshot com zero sessões e refresh tokens para as duas contas.

Esses resultados não incluem ainda a execução autenticada no emulador. Quando ela terminar, registrar o run e o commit exatos; não transferir aprovação automaticamente a alterações posteriores.

## Limites e continuidade

Este fluxo cobre identidade, armazenamento nativo e sessão com API real. Não valida telas internas de módulos, mudanças de concessão durante uma ação, fila offline, transporte de comandos físicos, push, certificados de produção, dispositivos físicos ou runtime iOS. Não representa assinatura ou distribuição em loja. As próximas etapas são os cenários de autorização e falhas descritos no [roteiro nativo](../android-smoke/README.md#próximos-testes-nativos-autenticados), sempre com serviços e identidades isolados.

Para testar o harness sem emulador, usar Python padrão e OpenSSL:

```bash
python3 -m unittest discover -s scripts/android-auth-smoke -p 'test_*.py' -v
```

Sem OpenSSL, o teste de TLS real é marcado como ignorado; isso não deve ser apresentado como aprovação dessa etapa. O workflow exige `openssl version` antes da suíte.

## Gravações completas ao concluir o plano

A gravação demonstrativa dos dois apps ainda será implementada após estabilizar o E2E autenticado. A abordagem prevista usa `adb shell screenrecord` no mesmo emulador descartável, com um roteiro por produto e dados fictícios. A [documentação oficial do ADB](https://developer.android.com/tools/adb#screenrecord) descreve saída MP4, limite de 180 segundos por segmento e ausência de áudio; portanto, um percurso maior precisa de segmentos enumerados e um índice das fases, sem apresentar trechos ausentes como gravação contínua.

Cada roteiro deve começar na entrada e percorrer os módulos efetivamente implementados, mostrar estados de erro/recuperação e encerrar a sessão. A captura precisa identificar commit, APK, usuário fictício e fases cobertas. Manter orientação fixa durante cada segmento e finalizar o processo de gravação antes de copiar o MP4. Senha, teclado de senha e qualquer token devem ser ocultados por uma máscara fixa na região de credenciais antes de admitir o vídeo no diretório de upload; somente vídeos revisados podem virar entrega. Capturas originais temporárias ficam fora da lista de artefatos e são descartadas após a revisão. Nenhum vídeo foi produzido por este workflow até o momento.

Os vídeos complementam os resultados do teste e os snapshots de sessão; não comprovam por si só a autorização do backend. A entrega final deve separar Morador, Operação e cada webapp, com roteiro, cobertura e limitações explícitos. A gravação dos webapps usa a suíte de navegador correspondente, fora deste harness Android.
