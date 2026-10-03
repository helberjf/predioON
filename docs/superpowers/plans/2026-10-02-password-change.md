# Troca da própria senha e serialização de credenciais

Recorte da identidade 2C implementado e revisado em 03/10/2026, com integrais locais aprovadas. A migration 037 implementa a troca; 036 pertence à auditoria. Publicação e CI de cada componente são registrados em [CONTINUIDADE.md](../../CONTINUIDADE.md). O comportamento e a implantação estão documentados em [TROCA_DE_SENHA.md](../../TROCA_DE_SENHA.md).

## Estado de validação

- API/autenticação: 63/63 dirigidos, incluindo corridas observadas por locks, efeitos de triggers imediatos, rollback e cookies. Cliente HTTP: 59/59, incluindo falha de armazenamento após204 e identidade substituída. As duas leituras independentes não encontraram bloqueador remanescente nessas fontes.
- Banco: 26/26, sem skips, com dump/restauração real de44 tabelas e37 migrations; ACLs/helper e revogação no destino não alteram a origem.
- Regressão API final:697/697,52 suítes, zero falhas/cancelamentos/skips,26min24s, snapshot17 arquivos SHA-256 `3f2987d330e5ce83f824fd5322c3cabc95b9125b1e105332d120a2859befe186`. Windows691/695 e Linux694/695 e694/696 continuam como execuções falhas históricas. O teste SSE passou a limitar observações sem incluir preparação SQL entre elas;25/25 dirigidos verificam também marcador ausente e resultado tardio.
- Web: UI89/89;33/33 dirigidos e integral final222/222 em27,2min, três motores e zero retries. O botão de dispensar erro recebeu type=button explícito; envio indevido não foi reproduzido antes da correção, e o teste de regressão confirma ausência de POST ao dispensar. Ponteiro/teclado em320 e390px passaram nos três motores. A rodada anterior221/222 teve JWT da fixture expirado após salto confirmado de77min22s no relógio; a nova integral monitorada não alterou TTL nem repetiu mutações. Inspeção manual dos três portais compilados passou no recorte de login/sessões/formulário vazio/cancelamento, sem erros de console.
- Mobile: 72/72, tipos dos dois apps e quatro bundles Android/iOS. Novo verificador Android: 16/16 em Linux com TLS real; execução dos APKs da senha ainda pendente. Bundles e unitários não equivalem a runtime nativo.

MFA, recuperação, convites, runtime iOS autenticado e o plano integral do produto continuam abertos. Resultados e próximos passos atuais estão em [CONTINUIDADE.md](../../CONTINUIDADE.md).

## Comportamento

Uma pessoa autenticada poderá trocar a própria senha confirmando a senha atual. O servidor obtém conta e sessão da autenticação, nunca de campos escolhidos no corpo. A troca bem-sucedida altera somente a credencial da conta e revoga atomicamente todas as suas famílias de sessão, inclusive a atual. Uma nova entrada é necessária. Senha incorreta, sessão expirada/revogada, conta inativa, falha de persistência ou corrida perdida não alteram a senha nem revogam parcialmente sessões.

O corpo terá validação estrita e tamanho limitado antes de Argon2. A nova senha terá pelo menos 15 caracteres Unicode e no máximo 1024 bytes UTF-8; espaços são preservados e não haverá regras artificiais de composição. Senhas antigas continuam verificáveis para permitir atualização. Repetição da senha atual será recusada. Verificações de MFA, recuperação e convite permanecem recortes separados e explícitos do plano maior.

## Concorrência e limites

- Argon2 ocorre antes de adquirir locks de negócio. A transação confere novamente o hash observado e a identidade atual antes de gravar.
- Login, refresh e troca passam a usar uma ordem uniforme: conta, família, geração do refresh. Um login que verificou uma senha anterior à troca não poderá criar família depois da alteração. Nenhuma renovação poderá reabrir uma família revogada.
- Login revalida conta ativa e igualdade do hash sob lock. Refresh revalida o vínculo entre geração, família e conta e usa tempo do banco após esperar locks.
- A operação HTTP autenticada compartilha a admissão persistente por conta/rede com o login, usando o e-mail autenticado. Não aceita e-mail fornecido no corpo. A admissão termina antes do KDF e não é revertida por senha incorreta.
- A credencial de identidade não recebe UPDATE livre em users. Um helper SQL privado de alteração compara o hash anterior, confirma a sessão atual e revoga as famílias na mesma transação. ACLs, owner e search_path serão verificados.
- Eventos de segurança da própria conta não podem ser expostos como auditoria global da plataforma. Definir armazenamento e acesso específico antes de introduzir um evento novo.

## Sequência de aceite

1. Reproduzir RED: endpoint ausente, login antigo aceito depois de mudança concorrente e ordem de locks incompatível com revogação de credencial.
2. Implementar API/SQL com testes HTTP, PostgreSQL e corridas determinísticas (bloqueio observado, não apenas sleeps).
3. Provar sessão própria, token estrangeiro/revogado, conta inativa, senha literal, corpo inválido, limitação429, rollback de falha de persistência e negação de UPDATE direto/runtime indevido.
4. Revisar independentemente, executar regressão de sessões/cookies/limites e ensaio de migrations/restauração. Publicar incremento de API somente após essas provas.
5. Integrar formulário nos três portais e dois apps. Limpar campos ao sair, preservar geração de identidade e encerrar a sessão somente após sucesso confirmado. Verificar Playwright e jornada Android separadamente, sem apresentar contrato HTTP como teste visual.

Referências de projeto: [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) para confirmação da senha e nova autenticação; [PostgreSQL 16 — locks explícitos](https://www.postgresql.org/docs/16/explicit-locking.html) para aquisição consistente e revalidação após espera. Essas referências orientam o desenho; aprovação depende dos testes do projeto.
