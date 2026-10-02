# Regressão real dos portais

Os testes usam Chromium, Firefox e WebKit, a API do projeto e os três servidores Vite. Cada cenário é executado nos três navegadores. Não substituem respostas da API e não são ignorados quando falta infraestrutura: o processo falha com diagnóstico.

Prepare um PostgreSQL/TimescaleDB **isolado e descartável**, com bootstrap, todas as migrations, credenciais restritas e seed de demonstração. Por padrão, a suíte usa `localhost:5436/predioon`; as variáveis `DATABASE_URL_APP`, `DATABASE_URL_IDENTITY` e `DATABASE_URL_BROKER_AUTH` podem selecionar outro banco local de teste. A configuração rejeita endereços de banco remotos. Não execute contra dados reais.

```powershell
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

Em runners Linux, use `pnpm exec playwright install --with-deps chromium firefox webkit`. Para investigar um navegador isoladamente, acrescente `--project=chromium`, `--project=firefox` ou `--project=webkit` ao comando de testes. As contas são `sindico@predioon.local`, `morador@predioon.local` e `admin@predioon.local`; a senha acompanha `SEED_PASSWORD`, com o padrão de demonstração `predioon123`.

A configuração inicia a API na porta 3100 e os portais nas portas 5273–5275. Servidores existentes não são reutilizados. O serviço de ingestão não é necessário para estes testes: o dashboard pode mostrar ausência de telemetria, sem inventar leituras.

Os 21 cenários, totalizando 63 execuções, cobrem:

- Login real e inválido, validação HTML, dashboard, contas sem condomínio e recuperação do painel administrativo.
- Criação e persistência de bloco/unidade/equipe/integrante, diretório de pessoas e administrador autorizado exclusivamente por RBAC.
- Troca de condomínio com descarte de rascunhos, persistência da escolha e separação dos registros.
- Concessão e revogação de papel com confirmação cancelável, verificação das capacidades no servidor e formulários ocultos para moradores.
- Publicação, edição, agendamento e remoção de avisos; moradores recebem apenas publicados e a API nega consulta privada e escrita.
- Chamado em tela de 390 px: criação, conversa, andamento pela gestão, cancelamento e privacidade entre moradores.
- Reserva em tela de 390 px: solicitação, aprovação pela gestão, cancelamento e persistência após recarregar.
- Mudança real da exigência de aprovação enquanto o formulário está aberto: mensagem e situação refletem a resposta atual do servidor.
- Calendário diário sem dados pessoais, conflito real de horário e atualização após cancelamento para permitir uma nova reserva.
- Dashboard com contagem de chamados próprios, do condomínio e do recurso autorizado; ausência de permissão e pausa não aparecem como zero, e o resumo nunca inclui o conteúdo privado dos relatos.
- Logout com revogação no servidor, histórico do navegador e nova identidade sem formulários da sessão anterior.

As fixtures criam prédios, pessoas e vínculos pela API autenticada, usando as mesmas políticas de acesso do produto. A conta da plataforma cria o cadastro inicial; a conta do condomínio faz as operações. Os registros recebem nomes únicos e permanecem somente no banco descartável; a suíte não reseta o banco nem apaga registros de outros testes. Os casos que removem avisos ou revogam vínculos atuam apenas sobre registros criados pelo próprio cenário.

O cenário de contador com escopo exato cria dois papéis exclusivos e seus vínculos por SQL, pois a API pública aceita apenas os papéis padrão no condomínio inteiro. Para ele, `DATABASE_URL` precisa apontar para a conexão owner do mesmo banco e porta locais de `DATABASE_URL_APP` (padrão `postgres://predioon:predioon@localhost:5436/predioon`). O helper valida esse isolamento antes de importar a conexão, remove exatamente esses papéis/vínculos em `finally` e fecha o pool; nenhuma permissão de papel padrão é alterada. As consultas e a renderização verificadas continuam usando a API real com credenciais restritas.

Relatório HTML, capturas e traces de falhas ficam em `.local/playwright-report` e `.local/playwright-results`, ignorados pelo Git. As gravações podem conter sessões das contas de demonstração; use apenas o banco descartável preparado para a suíte.
