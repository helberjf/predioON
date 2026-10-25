# Entrada pública, validação Playwright e implantação VPS

**Objetivo:** oferecer uma entrada mobile com Login e Conheça a plataforma, manter o formulário desktop e publicar na main uma entrega Docker reproduzível após testes.

**Base:** origin/main c53117d6. A pasta original estava 292 commits atrás; seu conteúdo foi preservado. Integração parte da main atual para conservar autenticação com cookies/MFA, permissões e a suíte E2E existente.

**Design:** reutilizar a identidade azul/verde e a imagem local do edifício. A raiz mobile apresenta marca, proposta e duas ações. `/login` abre a autenticação existente. `/conheca` apresenta o texto comercial de `docs/marketing/APRESENTACAO_COMERCIAL.md`, recursos, exemplo ilustrativo de consumo e benefícios por perfil. Desktop conserva o formulário e recebe o link de apresentação. Recuperação de senha, convites e sessão existente continuam usando os fluxos atuais.

**Arquitetura:** componentes públicos compartilhados em packages/ui, integrados nos três Apps. Sem novos serviços web, cadastro comercial ou dependência externa. Docker mantém os três portais e os serviços atuais.

- [x] Registrar testes de entrada, apresentação, navegação mobile e desktop, estados de autenticação e layout antes de implementar.
- [x] Implementar os componentes compartilhados e integrar os três portais.
- [x] Gravar navegação pública com o gravador do Playwright e revisar o resultado em teste estável.
- [x] Auditar APIs e testar a main atual, aproveitando a cobertura existente e acrescentando lacunas reais.
- [x] Completar Compose, Dockerfiles, configuração e guia para VPS; validar configuração, imagens e preparação de banco isolado.
- [x] Executar tipos, verificações, testes e revisão. Conferir diff/segredos e integrar todas as mudanças pertinentes à main com push sem força.
