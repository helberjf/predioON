# Publicação da demonstração na Vercel e no Neon

**Objetivo:** publicar os três portais e a API com um banco novo e os três usuários fictícios solicitados pelo proprietário.

**Arquitetura:** projetos Vercel independentes para administração, síndico, morador e API. Cada portal encaminha `/api` à API, preservando cookies HTTPS, SameSite e proteção por origem. O Neon recebe a estrutura versionada e credenciais de runtime restritas; o owner é usado somente na preparação. Os serviços permanentes de MQTT e notificações continuam exigindo o Compose/VPS.

## Execução

- [x] Conferir a main e atualizar a cópia isolada sem substituir alterações de outros trabalhos.
- [x] Criar `predioon-demo-db` no Neon Free em São Paulo, sem Neon Auth adicional.
- [x] Preparar entrada Express para Vercel: inicialização compartilhada, recusa de requisições sem roles restritas e bloqueio das rotas internas de MQTT.
- [x] Testar concorrência na inicialização, erro sanitizado, nova tentativa de inicialização e bloqueio das rotas internas.
- [x] Permitir `/api` na coordenação das sessões dos portais e verificar isolamento entre origens.
- [x] Aplicar bootstrap/migrations no banco novo; confirmar compatibilidade real do TimescaleDB fornecido pelo Neon antes de adaptar qualquer SQL.
- [x] Provisionar os três logins restritos usados pela API e inserir uma única vez os usuários de demonstração solicitados. Os serviços permanentes não publicados continuam NOLOGIN. Nunca executar seed numa instalação anterior.
- [x] Publicar API e os três portais com segredos somente na API, validar HTTPS, login, persistência de sessão e páginas autenticadas.
- [x] Registrar links, limites do ambiente gratuito e evidências; verificar diff e publicar alterações na main.

## Validação

Testes Node da entrada Vercel e da sessão web; typechecks da API/UI e builds dos três portais. Na implantação real, verificar `/health/ready`, os três logins, refresh e recarga de página. Nenhum dado de condomínio real será enviado, e nenhuma chave administrativa será incluída nos builds dos portais.
