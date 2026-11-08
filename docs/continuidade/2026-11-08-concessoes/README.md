# Concessões: pacote portátil de fontes

Pacote de 08/11/2026, sobre a composição de [criação com 1.035 arquivos](../2026-11-07-criacao/README.md). Acrescenta o teste de concessões e substitui somente o router tenancy. O destino tem **1.036 arquivos**, conferidos por SHA-256 e tamanho. O runtime principal não recebe ativação parcial da política MFA.

As duas concessões tratadas são POST `/v1/tenancy/unit-memberships` e POST `/v1/tenancy/role-bindings`. Preservam esquemas de entrada, DTOs completos, defaults/nulls, escopo, delegação, auditoria e recência de senha para papéis. O guard MFA é consumido pelo INSERT e pelo envelope escalar; uma nova decisão após auditoria permite rollback. Nenhuma outra rota, helper compartilhado, migration, policy ou ACL foi alterada neste lote.

## Estado na autoria

As quatro fases de resolução/tipos passaram para 32 arquivos de testes e 14 fontes obrigatórias. Os **17 casos funcionais e nove arquivos de regressão ainda aguardavam execução** ao congelar este pacote. A primeira tentativa parou antes do controller porque o Docker estava fechado; depois o cluster anterior deixou de estar disponível. Um novo cluster exclusivo foi criado; a tentativa seguinte foi impedida por memória livre abaixo de 1.536 MiB. Esses impedimentos não são RED de produto. Resultados posteriores devem ficar em RESULTADO.md e nas provas, sem reescrever estes arquivos congelados.

O plano prevê baseline com 11 PASS e seis falhas específicas 201 versus 403, candidato com 17 PASS e regressão com 130 TAP (120 casos independentes e dez grupos). São expectativas, não aceites funcionais deste README. Espera real por lock, promoção, perda de capacidade durante espera, concorrência de constraints, INSERT vazio induzido e exceção genérica de trigger precisam de provas próprias. Renovação de equipe, convites, outros domínios, Playwright, Android/iOS, desempenho e operação permanecem pendentes.

## Restaurar em outro computador

1. Clone a main e leia `docs/CONTINUIDADE.md`.
2. Restaure o checkpoint de 1.028 arquivos, aplique diretamente V4 (sem V3), depois obrigatório por flag, vínculo global, revogações e criação. Cada etapa exige uma pasta nova.
3. Aplique este pacote sobre a pasta final de 1.035 arquivos:

```powershell
node --max-old-space-size=128 docs/continuidade/2026-11-08-concessoes/apply-grants.mjs --candidate CAMINHO_DA_CRIACAO_1035 --output NOVA_PASTA_DAS_CONCESSOES_1036
```

O script valida os seis arquivos internos, o inventário pai e os dois payloads antes de escrever. Não sobrescreve destinos existentes, não instala dependências, não copia credenciais/cache/dist/node_modules, não inicia serviços e não executa testes. Valida novamente todos os arquivos e a preservação do pai ao final. O recibo `API-GRANTS-RESTORE-RECEIPT.json` é de restauração de fontes, não de aprovação funcional.

Instale dependências e prepare a configuração local somente depois, conforme a documentação do projeto. Não copie URLs privadas de banco ou atestações de contêiner entre computadores. A instância local precisa de identificação nova e banco descartável. Não reinicie o computador nesta sessão.

## Identidade das fontes

- Parent preparado: `ce90003f2777c890195c814b6560f0ca26edb2989f1770a2c4aabea8939d54ff`.
- Target preparado: `f701467e1feeb849cd2eaf83aee4d4d91a15574a834bc019c6d26234d30730f9`.
- Produto: `d660a272e2201bd8a8f68096457508ba1b5aca4d3d824e045b75724bf277ca00`.
- Teste comum: `137788364b48047a2ddcb46747e06564ba05873df14e97b00435b4936326c543`.

O conjunto original de 85 payloads e os pacotes anteriores permanecem inalterados. Os cinco casos históricos de navegador em quatro specs são preservados como fontes, sem reexecução ou soma neste pacote. As imagens e vídeos permanecem nos diretórios docs da main; não são copiados para a árvore de código pelo aplicador.
