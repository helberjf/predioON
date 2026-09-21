# Prédio ON — interface baseada nas referências

**Objetivo:** aproximar os três webapps das telas fornecidas, preservando dados reais e navegação existente. O pedido explícito de seguir essas referências define a direção visual.

**Referências:** 2 e 6 são o painel do síndico; 4 é a administração da carteira; 3 é o fluxo móvel de atendimento; 5 é o portal do morador. As peças 1 e 7 são anúncios e orientam somente marca/fotografia. Mantém-se a restrição anterior de não abrir portões.

**Arquitetura:** React/Vite, Tailwind e componentes compartilhados existentes. Sem mudança no contrato MQTT. Valores exibidos vêm da API; imagens arquitetônicas são decorativas. Não criar câmeras, clima, consumo, receita ou IA fictícios para preencher cartões.

- [x] Refinar `packages/ui/src/components/primitives.tsx`, a ilustração de reservatório e estilos: marca linear, azul-marinho/verde, cartões claros com menos espaço vazio. Gerar fotografia de fachada e guardar em `packages/ui/src/assets`.
- [x] Refazer shell e dashboard do síndico: cabeçalho com condomínio/perfil/busca de navegação funcional; seis indicadores dos sensores existentes; gráficos compactos de nível e tensão; reservatório; alertas, avisos, atalhos, equipamentos e acompanhamento de ocorrências. Usar nomes corretos para grandezas medidas.
- [x] Refazer `apps/admin-web` (implementação local e revisão independente): composição da imagem 4, indicadores coloridos, carteira, situação dos sensores, alertas e visualizações derivadas dos dados existentes. Filtrar condomínio e navegar funcionalmente.
- [x] Refazer `apps/resident-web` (implementação local e revisão independente): cabeçalho com fachada, atalhos, cartões de avisos/monitoramento, reservas com seleção visual de áreas e formulário funcional, navegação móvel conforme imagem 5.
- [x] Conferir dados ausentes, largura móvel, ações de navegação e formulário. Rodar verificações de tipos e build sequenciais por memória limitada do host; executar testes existentes para regressões dos componentes compartilhados.
- [x] Revisar a comparação com as referências no navegador e registrar a entrega.

**Validação:** inspeção em 1440 px e 390 px, nenhum botão de portão, ações com destino existente, sem números fictícios ou imagens sugerindo CFTV real. Alterações apenas visuais não exigem testes que espelhem classes CSS.
