# Comparação de senha para contas ausentes — 02/10/2026

Recorte corretivo da identidade, independente dos limites de tentativas, MFA e recuperação ainda pendentes.

## Problema observado

`verifyPassword` retornava `false` imediatamente quando a consulta não encontrava um hash. A resposta HTTP já era genérica, mas só contas existentes faziam a comparação Argon2. Isso introduzia uma diferença evitável no trabalho executado antes da resposta. A [orientação de autenticação da OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) descreve esse risco de saída antecipada.

## Correção

- Ausência ou vazio usa uma comparação Argon2id fictícia e aguarda sua conclusão. O resultado desse caminho nunca autentica uma conta.
- Um hash armazenado malformado pode falhar antes do trabalho criptográfico. Nesse caso, uma comparação fictícia adicional é executada e seu resultado também é descartado.
- Falha do provedor criptográfico termina em negação, sem repetição ilimitada.
- Hash válido continua usando os parâmetros gravados no próprio hash e os bytes exatos da senha enviada. Não foram alteradas senhas, parâmetros de geração nem registros existentes.
- O hash fictício foi gerado de bytes aleatórios e não pertence a usuário algum. Seu custo corresponde aos defaults atuais da biblioteca instalada: Argon2id v19, memória 19456 KiB, duas passagens e paralelismo 1. Um teste compara todos os parâmetros com um hash novo para detectar mudanças futuras da política.

## Evidência

A lógica anterior foi extraída sem mudança comportamental para permitir observar a comparação. Antes da correção, três testes falharam: conta ausente não fazia comparação, hash malformado não fazia fallback e falha do provedor nem era consultada para conta ausente. Dois testes de compatibilidade já passavam. Log local de desenvolvimento: `work/passwords-kdf-red.log`, fora do Git.

Depois da correção, **5/5** testes passaram. A prova aguarda uma comparação controlada antes de aceitar a resposta negativa, verifica os parâmetros reais com `parseOptions` e testa o verificador Argon2 real; não usa um limite de milissegundos dependente da carga do runner. Segurança HTTP, cookies web e esses testes passaram juntos em **25/25**; ciclo de sessões passou separadamente em **9/9**, todos sem skips. Typecheck da API passou. Revisão independente não encontrou bypass de autenticação nem regressão de compatibilidade.

Essa alteração remove a saída antecipada identificada; não promete duração idêntica entre todas as contas, hashes históricos, consultas e condições de rede. O limite de tentativas e a política de evolução dos parâmetros exigem recortes próprios.
