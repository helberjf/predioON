# Limitação persistente de tentativas de login — desenho para 035

Estado: implementação de035 concluída e validada após a publicação de034 (`1c80551`), aguardando checkpoint próprio. O limitador, segredo HMAC, baldes e topologia concreta do Caddy estão presentes. MFA, convites e recuperação continuam fora deste recorte.

O recorte cobre `/auth/login` e `/auth/web/login` antes da consulta de credencial e do Argon2. Ambos usam o mesmo orçamento persistente, inclusive entre processos da API. Recuperação, convites e MFA continuam em etapas seguintes. A recusa temporária não altera a conta nem invalida sessões já existentes.

## Política proposta

- Dois baldes de fichas: endereço de rede (capacidade300, reposição300 por60segundos) e endereço de conta normalizado (capacidade20, reposição20 por900segundos). Valores iniciais são política operacional, não exigência de OWASP. Revisar cargas reais antes da implantação.
- Consumir rede primeiro; apenas requisição admitida por rede consulta/consome conta. Tentativa com conta temporariamente limitada continua consumindo rede, mas não amplia a espera da conta. Contas ausentes, inativas e existentes seguem o mesmo caminho.
- Contar tentativas admitidas, inclusive as bem-sucedidas; não apagar o limite por um login correto nem permitir que troca de portal reinicie o contador. Reposição contínua evita bloqueio permanente. Não manter transação/lock durante Argon2.
- SQL usa `clock_timestamp()` após adquirir o lock, inclusive se a transação ficou esperando; calcular `Retry-After` inteiro positivo pela próxima ficha. Recusa é429 com texto genérico idêntico para qualquer conta. Falha do armazenamento é503 genérico, sem autenticar nem registrar payloads de credenciais.
- A função retorna a decisão; a API só transforma a recusa em erro429 depois do commit. Lançar exceção dentro da transação devolveria indevidamente a ficha de rede quando a conta estivesse limitada. Testar alternância de várias contas limitadas até esgotar rede.
- Limite de corpo/campos aplicado antes do trabalho criptográfico. Preservar a senha exata e a normalização atual do login (`email.toLowerCase()`); não introduzir trim silencioso de senha nem políticas novas de complexidade nesta etapa.

## Persistência e privacidade

- Migration035 cria tabela própria de baldes com tipo, chave HMAC SHA256, saldo, instante e expiração, índices e restrições de tamanho/valores. Não guardar email, IP, senha, refresh ou User-Agent nesses registros.
- `AUTH_RATE_LIMIT_KEY` é segredo exclusivo do limitador, compartilhado entre réplicas. Em produção é obrigatório e forte; desenvolvimento/teste usa valor explicitamente local. Trocar a chave inicia novos baldes e deve ser operação coordenada e documentada.
- Função `SECURITY DEFINER` de consumo, com search_path fixo/objetos qualificados, exec apenas para `predioon_identity`. Nenhum acesso direto dos três papéis de runtime à tabela; PUBLIC/app/broker não podem chamar consumo nem ler estatística privada.
- Requisições concorrentes sobre chave nova ou existente não excedem a capacidade. Reposição e consumo ocorrem sob lock da própria linha; sem contador em memória como autoridade.
- Expiração com horizonte superior ao tempo de reposição completa. Limpeza limitada por lote e índice, sem varrer tabela por login e sem remover saldo ainda restritivo. Registrar manutenção periódica no procedimento operacional; não prometer proteção contra todo DDoS distribuído.

## Origem de rede

- Por padrão ignorar `X-Forwarded-For`, `Forwarded` e similares e usar o peer real do socket. Somente CIDRs/IPs explicitamente cadastrados em `TRUST_PROXY_CIDRS` podem alterar `req.ip`; recusar booleano verdadeiro, contagem de hops e curingas no parser de configuração.
- Normalizar IPv4/mapeamentoIPv6 e agrupar IPv6 por /64 com biblioteca IP estabelecida. Não usar regex caseira como parser de endereços. Origem inválida não abre balde único por texto arbitrário.
- A entrega deve incluir configuração concreta do proxy padrão de produção: rede/CIDR confiável restrito, API sem porta pública, Caddy sobrescrevendo cabeçalhos encaminhados. Documentar o peer padrão quando executada diretamente e não confiar automaticamente em toda rede privada.

## Aceite antes de publicar

1. RED de unidade: identidade canônica entre portais/case, IP falsificado ignorado, IPv4 mapeado e IPv6 /64 equivalentes, configuração inválida, erro429/503 sem segredo e KDF não iniciado após recusa.
2. RED/integração em banco isolado: capacidade, reposição, clock após espera, concorrência em duas conexões/processos, ausência/inatividade de conta, consumo compartilhado web/nativo e nenhuma sessão criada quando negado. Retomar após reposição sem reiniciar API.
3. ACLs/ownership/exec/RLS da tabela e função; schema/ledger/backup incluem a nova tabela. Limpeza não afeta baldes ativos nem dados do usuário.
4. Testes de origem com proxy confiável e não confiável, incluindo cadeia XFF forjada. Cookies/CSRF continuam validados antes de consumir o balde web.
5. Regressão de autenticação, cookies, sessões e clientes; confirmar que loops de fixtures não mascaram limites. Caso a carga de fixtures necessite configuração ampliada, declará-la somente no teste de regressão e testar política padrão em integração separada.
6. Typecheck, builds, revisão independente e commit/push próprio. Nenhuma alteração no dispatcher nem criação de privilégio de negócio.

## Referências consultadas

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#login-throttling): limites por conta e consideração de abuso por bloqueio. A política numérica acima é decisão deste projeto.
- [Express behind proxies](https://expressjs.com/en/guide/behind-proxies/): correspondência entre a lista de proxies confiáveis e a topologia real; aceitar cabeçalhos de qualquer origem permite falsificar IP.
- [PostgreSQL16 INSERT](https://www.postgresql.org/docs/16/sql-insert.html): operações concorrentes de INSERT/ON CONFLICT para a criação do balde. Locks e testes continuam necessários para o contrato de consumo.

## Fundação entregue antes de035

`TRUST_PROXY_CIDRS` passa por validação antes de iniciar Express. Vazio mantém `trust proxy=false`; valores aceitos são até32 IPs/CIDRs explícitos, com entrada total limitada a2048 caracteres. Booleanos, contagem de hops, nomes de rede, hostnames, zone IDs e faixas universais são recusados. A validação também recusa uma faixa IPv6 que abrangeria todos os endereços IPv4 mapeados. IPv6 é normalizado pelo parser URL do Node antes de chegar à dependência IP do Express, evitando divergência entre formas mistas válidas.

Cinco testes escritos antes da implementação passaram: parser, negações e requisições HTTP reais demonstram que cabeçalhos forjados de peer não confiável são ignorados, a cadeia para no primeiro salto não autorizado e cada proxy adicional exige configuração explícita. Depois da revisão, o caso de representação IPv4-compatible foi normalizado e os cinco testes passaram novamente. Regressão dirigida de senhas, sessões e cookies com banco real passou29/29, sem skips. Tipos da API e do E2E de sessões passaram. Revisão independente não encontrou bloqueador de confiança.

O Compose de produção encaminha a variável opcional e os exemplos explicam seu valor vazio. Este checkpoint não altera a topologia do Caddy, não escolhe uma rede privada como confiável automaticamente e não ativa limites de login. A topologia restrita de produção e o consumo persistente continuam nos critérios de035 acima.

## Implementação e evidências de035

As duas rotas usam schema compartilhado (8 KiB de JSON, 254 bytes de e-mail, 1024 bytes de senha) e admissão antes do serviço de credenciais. A transação tem timeout de statement de dois segundos e termina antes do Argon2. A decisão429 é retornada após commit; erro de armazenamento produz503 sem repassar a causa. A origem web continua validada antes do consumo. O segredo obrigatório em produção é separado das chaves existentes.

O SQL usa UPSERT que adquire a linha existente atomicamente. A revisão independente identificou que `DO NOTHING` seguido de SELECT permitiria à limpeza apagar um registro expirado entre os statements; essa janela foi removida. Reposição usa relógio após aquisição e mantém a observação anterior se o relógio recuar. Limpeza executada depois dos locks remove no máximo32 linhas expiradas com SKIP LOCKED. EXPLAIN/auto_explain capturou o statement interno real entre10 mil registros ativos: dois Index Scan, sem varredura sequencial e com até32 linhas em cada acesso. Reaplicação dupla preservou os saldos e restaurou a autoridade privada das funções.

RED de armazenamento: cinco testes falharam por ausência das funções; RED de chaves: módulo inexistente; RED HTTP: seis testes falharam pelas respostas atuais200/401 em lugar de429/503/400. Após implementação, **24/24 testes próprios** passaram: quatro de identidade HMAC, dois de configuração/schema, onze de concorrência/relógio/limpeza/ACL/reaplicação e sete HTTP/processos. Um processo Node novo observou o limite persistido, retomou após reposição e deixou seu consumo visível ao processo pai. A matriz cobre contas desconhecidas/inativas, senha literal, origem forjada, corpo inválido, CSRF e nenhuma sessão/cookie após recusa.

Regressão com o limitador ativo: **29/29** testes de senhas, lifecycle, cookies e proxies passaram, sem skips. **26/26** testes de banco passaram, incluindo arquivo pg_dump e restauração serial real de **44 tabelas e35 migrations**, dados, ACLs, RLS, helpers de aplicação e identidade. O backup agora compara também as funções `identity_*`.

Compose atribui endereço estático ao Caddy numa rede exclusiva com a API; confiança é somente o endereço/32. Caddy sobrescreve XFF com o peer e remove Forwarded em API/SSE. O teste Docker real passou com cabeçalhos falsificados, rotas internas404 e nenhuma porta pública da API. Adicionado à CI de plataforma. A configuração foi conferida com documentação oficial de [headers no Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers), [IP estático no Compose](https://docs.docker.com/reference/compose-file/services/#ipv4_address-ipv6_address) e [UPSERT do PostgreSQL16](https://www.postgresql.org/docs/16/sql-insert.html).

Revisão independente de SQL/middleware/chaves/configuração/topologia não encontrou bloqueador após a correção do UPSERT. Fixtures de regressão continuam sujeitas à política padrão; contas compartilhadas por muitos cenários podem exigir isolamento de fixture, jamais bypass silencioso do runtime. Ainda não há homologação pública da topologia/TLS nem execução completa de navegador vinculada a035. O guia de operação está em `docs/AUTENTICACAO.md`.
