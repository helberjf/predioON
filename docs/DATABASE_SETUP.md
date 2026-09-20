# Banco local — Prédio ON

A forma recomendada para desenvolvimento é executar, a partir da raiz do monorepo:

```bash
pnpm install
pnpm setup:local
```

O `setup:local` executa:

1. Docker Compose (`TimescaleDB/PostgreSQL` + `EMQX`)
2. espera o PostgreSQL aceitar conexões
3. `drizzle-kit push`
4. `infrastructure/001-timescale-rls.sql`
5. seed de demonstração

Depois:

```bash
pnpm dev
```

Para gerar telemetria e simular os sensores/gateway:

```bash
pnpm simulate:hardware
```

Veja o `README.md` da raiz para instruções detalhadas de Windows e os endereços dos painéis.
