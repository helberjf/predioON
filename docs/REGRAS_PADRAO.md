# Regras padrão e regras salvas

A migration `066-default-alert-rules.sql` disponibiliza até 16 regras padrão por condomínio: nível baixo/crítico do reservatório, subtensão/sobretensão/falta de L1/L2/L3, gás, incêndio, vazamentos de água/esgoto e temperatura. Todas começam com `enabled=false`, sem dependência dos dispositivos da demonstração. Regras equivalentes já existentes e suas configurações são preservadas.

Aplicar `pnpm db:infra` com a conexão administrativa antes de iniciar a versão atualizada da API. O executor registra a migration no histórico. O gatilho provisiona novos condomínios; reexecutar o provisionamento não duplica os padrões nem redefine alterações de nome, limite ou estado. O seed usa o mesmo catálogo.

As funções de provisionamento são exclusivas do proprietário administrativo. O gatilho executa apenas para o condomínio recém-inserido após a autorização normal do cadastro. A API não pode executar o provisionamento nem alterar `template_key`; as políticas existentes de leitura e gerenciamento de regras continuam em vigor.

No painel, “Regras ativas” contém regras habilitadas e “Regras salvas” contém desativadas. Ativar/desativar persiste o estado e move a regra entre as abas. A identificação “Padrão” distingue os modelos provisionados. Os limites seguem os valores da demonstração e precisam ser revisados para a instalação antes da ativação.

Validação da interface, com API simulada: `pnpm exec playwright test --config playwright.rules.config.ts`. O workflow de navegador executa esses testes no Chromium. Com as conexões de banco descartável configuradas, executar `pnpm --filter @predioon/api exec node --import tsx --test --test-concurrency=1 test/default-alert-rules.test.ts test/alert-rule-capabilities.test.ts` para validar provisionamento, persistência e permissões reais.
