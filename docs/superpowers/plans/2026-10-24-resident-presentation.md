# Apresentação pública própria do morador

**Base:** main `a5ffcc32`, reaproveitando o worktree isolado e limpo da entrega anterior.

**Objetivo:** a página `/conheca` do portal/app web do morador apresentar a rotina de quem mora, distinguindo-se da página de gestão do síndico visível na entrega anterior.

**Design:** identidade azul/verde existente, hero dedicado “Seu condomínio mais perto de você.” e ilustração em HTML da experiência no celular, identificada como exemplo. Seis recursos: avisos, reservas, chamados próprios, contas publicadas, acessos autorizados e consumo quando disponibilizado pela gestão. Seção com passos de acesso e convite. A entrada mobile também usa texto e destaques de morador. Nenhum link de loja, número de usuários, economia ou funcionalidade inexistente é inventado.

**Arquitetura:** novo `ResidentPresentation` em `packages/ui`, selecionado explicitamente por `apps/resident-web/src/App.tsx`; `PublicEntry` recebe a variante de público. A página atual `PlatformPresentation` continua servindo administração/síndico. Login e convite usam as rotas existentes; nenhuma mudança de banco, API ou app nativo.

**Alternativas avaliadas:** trocar somente o texto manteria a mesma apresentação de gestão; parametrizar todo o componente atual misturaria dois layouts. Um componente próprio mantém cada público e sua navegação claros, compartilhando marca e primitives existentes.

- [x] Ajustar a suíte pública para exigir títulos, recursos e entrada de cada público; observar a falha no portal do morador.
- [x] Implementar apresentação própria e integrar entrada, login e convite.
- [x] Atualizar o fluxo Codegen e validar os três portais com Playwright, responsividade e axe; conferir tipos.
- [x] Conferir capturas mobile/desktop, registrar evidências e publicar na main.
