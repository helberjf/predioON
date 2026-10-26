# Novos avisos

**Objetivo:** mostrar a quantidade de avisos ainda não vistos e um alerta ao abrir os portais do morador e do síndico.

**Desenho:** indicador vermelho no canto superior do ícone/atalho de Avisos. Alerta dispensável com “Ver avisos”; dispensar não marca leitura. Abrir a lista marca apenas os avisos carregados e visíveis. Publicações futuras e vencidas não contam. Histórico local por usuário e condomínio, preservado ao recarregar; sincronização entre abas. Sem migração de banco ou alteração de permissões.

**Arquitetura:** funções puras para o histórico e a contagem; contexto React compartilhado para consulta, atualização e persistência; componentes de indicador e alerta usados nos dois portais. Atualizar ao voltar à janela e a cada 30 segundos. Falha na consulta não deve abrir alerta nem usar dados antigos como confirmação de leitura.

- [x] Escrever e executar testes de contagem, datas, persistência inválida e isolamento do histórico.
- [x] Implementar estado/contexto compartilhado e componentes acessíveis.
- [x] Integrar nos shells, atalhos e listas dos dois portais.
- [x] Conferir testes, TypeScript, builds e comportamento no navegador.

Validação: 122 testes de UI aprovados; typechecks de UI, morador, síndico e E2E; builds dos dois portais; fronteiras e diff conferidos. Revisão independente concluída, com correções para filtros e atualização da lista do síndico.

Os 12 cenários Playwright de desktop/celular usam respostas descartáveis de API e não precisam de banco. Para repetir: `pnpm --filter @predioon/resident-web --filter @predioon/building-web build` e `pnpm exec playwright test --config e2e/notice-notifications.config.ts`. Capturas ficam em `.local/notice-notifications-results`.

O histórico é deste navegador; sincronização de leitura entre aparelhos e aplicativos nativos fica fora desta alteração.
