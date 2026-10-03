# Troca da própria senha e encerramento das sessões

Este documento descreve o incremento de identidade037. MFA, recuperação de senha e convites continuam recortes separados do plano do produto. A troca exige uma sessão autenticada atual e confirmação da senha existente; não é um mecanismo de recuperação de conta.

## Comportamento

Uma troca confirmada altera a credencial da própria conta e encerra todas as suas famílias de sessão, inclusive a atual, em uma única transação. Os outros portais, abas e aplicativos precisam entrar novamente. As permissões e os dados do condomínio permanecem associados à conta.

Senha atual incorreta, corpo inválido, falta de autenticação, conta inativa, sessão revogada/expirada, limite de tentativas ou falha de persistência não podem confirmar uma troca parcial. O servidor determina a conta e a família pela autenticação; o corpo não aceita identificadores de usuário, condomínio, e-mail ou sessão.

As senhas são literais: espaços são preservados e não se aplica normalização Unicode nem regra de composição por letras/números/símbolos. A nova senha precisa de pelo menos15 pontos de código Unicode, deve ter Unicode bem formado e pode ocupar até1024 bytes UTF-8. A senha atual precisa ser não vazia e ocupar até1024 bytes; credenciais legadas continuam verificáveis. A comparação de reuso considera os bytes efetivos UTF-8, impedindo substituir a mesma credencial por outra representação de uma string antiga malformada.

## Contrato HTTP

| Cliente | Rota | Requisitos |
| --- | --- | --- |
| Nativo | `POST /auth/password` | Bearer da família atual e JSON estrito. |
| Web | `POST /auth/web/password` | Bearer atual, Origin permitido, `X-Predioon-Web: 1`, Content-Type JSON e política web existente. |

Corpo, com tamanho total limitado a8KiB antes de Argon2:

```json
{
  "currentPassword": "senha atual literal",
  "newPassword": "nova senha literal de pelo menos 15 caracteres"
}
```

| Resposta | Significado |
| --- | --- |
| `204` | Credencial e revogação de todas as famílias confirmadas. Sem corpo nem tokens novos. |
| `400` | Corpo/requisitos inválidos, senha atual incorreta ou reuso de credencial. |
| `401` | Identidade/família deixou de ser válida ou a confirmação perdeu uma corrida. |
| `403` | Política de origem/cabeçalhos do cliente web recusada. |
| `413` | Corpo excede o limite anterior ao KDF. |
| `429` | Admissão persistente por conta/rede esgotada; respeitar Retry-After. |
| `503` | Admissão ou confirmação persistente não pôde ser concluída com segurança. |

O endpoint compartilha a admissão persistente de login035, usando o e-mail autenticado obtido do banco. Tentativa com senha incorreta consome o orçamento; sucesso não zera o consumo. A política não é enfraquecida para fixtures ou apps. A resposta não expõe hash, senha, metadados de sessão ou detalhe interno de falha.

Na rota web, o cookie de refresh só é apagado depois de confirmar a troca. Rejeição de CSRF ou senha incorreta não encerra a sessão por si. Eventos de senha não são enviados à auditoria global da plataforma: o armazenamento de eventos de segurança da própria conta permanece outro recorte explícito.

## Transação e autorização

Argon2 verifica a senha e prepara o novo hash antes de adquirir locks de negócio. A transação compara novamente o hash observado e a conta ativa. Login não pode criar uma família depois de uma troca com uma verificação antiga de senha. Refresh não pode reabrir a família revogada nem conservar uma geração consumida enquanto cria a sucessora.

A ordem das operações que precisam dos três recursos é conta → família → geração de refresh. Famílias de revogação coletiva são travadas em ordem estável por ID. Uma revogação individual não tenta adquirir a conta depois de segurar sua única família. Expiração é reavaliada usando tempo do banco depois de esperar locks.

A migration037 cria o helper privado `identity_replace_password`. O papel de identidade tem EXECUTE nesse helper e continua sem UPDATE direto da credencial em users. Os demais runtimes não recebem essa capacidade. Owner, ACLs e search_path permanecem controlados na aplicação/reaplicação. O helper confere a família própria atual e revalida conta/hash após os locks.

As escritas confirmam valores efetivamente persistidos, além da quantidade de linhas. Ignorar um UPDATE, devolver valores antigos num BEFORE, reescrever num AFTER imediato ou inserir uma família ativa indevida faz a operação falhar e reverter a transação. Refresh e revogações também confirmam suas transições. Triggers de constraint diferidos até o commit não fazem parte das migrations atuais nem do aceite desse mecanismo.

## Cliente HTTP e formulários

As fachadas web/nativa oferecem `changePassword({currentPassword,newPassword})`. Exigem204 para considerar sucesso. Não repetem a mutação após falha de transporte; uma resposta desconhecida não significa que o servidor desfez a troca. Se a confirmação se perdeu, tentar entrar com a nova senha permite determinar o estado da conta.

Uma401 permite renovar uma credencial expirada e uma única nova tentativa, preservando a geração da identidade. A coordenação web libera o lock de cookies antes da renovação e revalida a conta ao readquirir o lock. Uma resposta antiga da contaA nunca encerra a contaB que entrou depois.

Após204, o cliente bloqueia a identidade local antes de apagar armazenamento. Falha de Keychain/storage não torna os tokens revogados novamente utilizáveis nem converte o sucesso em sugestão de repetir a alteração. A coordenação entre abas mantém o encerramento mesmo se a persistência local da tombstone falhar.

O formulário web fica em Minhas sessões, incluindo Perfil do morador. Os apps compartilham Minha conta → Trocar minha senha. Campos de senha são protegidos; confirmação é validada localmente e não é enviada à API. O envio duplo é bloqueado, mensagens não reproduzem o corpo de erro do servidor e campos são limpos ao enviar/cancelar/sair/trocar identidade. Os apps também limpam campos ao ir para segundo plano. Erros de senha atual/rede/429 preservam a identidade até existir sucesso confirmado ou perda real de autenticação.

## Implantação e testes

O SQL037 é um arquivo novo depois de036. Depois de publicado/aplicado, ele deve permanecer imutável. Não editar checksum nem apagar ledger de um banco real. Bootstrap e seed continuam restritos à instalação descartável documentada em [MIGRATIONS.md](MIGRATIONS.md).

Para implantar esse recorte, coordenar a atualização de todas as instâncias da API: a versão antiga não oferece as revalidações/ordem de locks da037. Pausar o tráfego de identidade, encerrar os workers antigos, aplicar migrations com credencial administrativa e iniciar a release nova completa antes de reabrir o tráfego. Conferir prontidão e smoke de login/refresh/troca. Servir os portais e bundles compatíveis. A migração do schema isoladamente não comprova compatibilidade entre workers antigos e novos.

Regressão integral local da API: **697/697**, 52 suítes, zero falhas/cancelamentos/skips, em26min24s. Fonte congelada de17 arquivos sobre8e8a3ad, tar SHA-256 `3f2987d330e5ce83f824fd5322c3cabc95b9125b1e105332d120a2859befe186`. A matriz web da fonte final passou **222/222**, três motores e nenhum retry, em27,2min; seus23 arquivos do incremento foram comparados com o checkout por SHA-256 LF. Foram execuções concorrentes nesta máquina; os tempos não constituem um orçamento de desempenho de produção.

As execuções anteriores691/695 Windows,694/695 e694/696 Linux e221/222 web permanecem registradas como falhas. O prazo do teste SSE foi corrigido por observação, com25/25 dirigidos e negativos de marcador ausente/resultado tardio. O trace da falha web confirmou um salto de77min22s no relógio entre requisições com o mesmo JWT de cinco minutos; o navegador renovou sua credencial, mas a fixture HTTP conservou o token expirado. As novas integrais não alteraram TTL, política de admissão nem retry de mutações; acompanhamento wallclock/monotônico não registrou outro salto durante os intervalos monitorados.

Evidências complementares:63/63 testes reais dirigidos de autenticação/sessões/cookies,59/59 do cliente e duas revisões independentes dos locks, persistência e falhas de armazenamento. Banco037:26/26 com dump/restauração real de44 tabelas/37 migrations, helpers/ACLs e revogação no destino sem modificar a origem. UI89/89, mobile72/72, tipos e quatro bundles são provas separadas. Playwright dirigido33/33 inclui pointer/teclado em320 e390px; a inspeção manual dos três portais compilados conferiu login, sessões, formulário vazio/cancelamento e ausência de erros de console. **CI da versão publicada e jornadas nativas da senha ainda precisam de conferência; o plano completo do produto permanece aberto.** Resultados atuais ficam em [CONTINUIDADE.md](CONTINUIDADE.md).

O roteiro [Android senha](../scripts/android-password-smoke/README.md) usa APKs release, API/PostgreSQL reais, TLS restrito, emulador descartável, provas de revogação e isolamento entre produtos. Unitários do roteiro não equivalem a executar os APKs. Compilar bundles iOS também não homologa autenticação, Keychain, segundo plano ou uma instalação em aparelho.
