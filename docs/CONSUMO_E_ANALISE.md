# Consumo, custo estimado e análise histórica

## Como configurar

Em **Consumo e análise**, a administração associa um equipamento a Energia, Água ou Bomba. O recurso aparece no painel de operação do administrador, no painel do prédio e na consulta do morador. Água e Energia também exibem os respectivos indicadores nas suas próprias páginas.

- Energia recebe **energy_total_kwh**, acumulador não negativo em kWh.
- Água recebe **water_total_m3**, acumulador não negativo em m³. O volume do reservatório permanece uma informação independente.
- Bomba recebe **pump_running**, booleano do relé/contato auxiliar.

É possível configurar tarifa, limite diário de quantidade, limite de custo estimado, limite contínuo da bomba, intervalo máximo entre amostras e análise histórica. Bomba usa minutos e não aceita tarifa: seu custo pertence ao medidor de energia.

## Cálculo e dados insuficientes

O consumo é a diferença entre acumuladores consecutivos de boa qualidade. A duração da bomba usa o estado anterior até a amostra seguinte. Mensagens repetidas ou anteriores ao último horário processado não aumentam os totais. Queda do acumulador é tratada como reset; o intervalo afetado não recebe consumo negativo.

Lacunas maiores que o intervalo configurado e leituras ruins ficam sem cálculo. O painel mostra cobertura e última leitura, sem converter ausência de dados em consumo zero. Horas/minutos contam apenas intervalos confirmados pelas leituras. Valores que cruzam a meia-noite são divididos proporcionalmente entre os dias do fuso IANA do imóvel.

O custo usa a tarifa válida ao processar o intervalo. Alterações de tarifa valem para os próximos intervalos e não recalculam o histórico. Se parte do período não tem tarifa, o custo total fica desconhecido. A estimativa não calcula a estrutura completa da fatura, impostos, bandeiras ou cobranças fixas.

## Alertas e referência aprendida

O limite diário pode gerar um alerta assim que o acumulado o supera. Para bomba, o limite contínuo é independente do total do dia. Cada tipo de alerta é emitido no máximo uma vez por equipamento e dia; a gravação acompanha a mesma transação da medição.

A análise usa até 28 dias anteriores, com pelo menos 80% de cobertura e sem resets, e exige de 7 a 28 dias válidos conforme configuração. Aprende mediana e desvio absoluto mediano; o aumento deve superar tanto a variação aprendida quanto o percentual mínimo configurado. Dias fora dessa janela não treinam a análise.

O acumulado parcial do dia é comparado com a referência diária completa. Não há previsão do fechamento nem diagnóstico de qual equipamento causou o aumento. Sem histórico suficiente, o painel mostra aprendizado. Leituras antigas podem preencher o histórico, mas não geram aviso sobre incidente antigo.

## Banco, API e demonstração

Aplicar as migrações com **pnpm db:infra**, incluindo 007-monitoring.sql, e executar **pnpm db:seed** para o ambiente de demonstração. Em banco já povoado, o complemento pode ser executado com **pnpm --filter @predioon/db exec tsx src/seed-features.ts**.

A API expõe GET/POST **/monitoring** e PATCH **/monitoring/:profileId**. Moradores consultam os imóveis autorizados; gestores configuram parâmetros. Totais e cursores são gravados pela ingestão, sem permissão de alteração pelo usuário da API. As alterações de parâmetros são auditadas.

O seed usa tarifa ilustrativa de energia e limites de demonstração. Ajuste-os antes de avaliar resultados reais. Os cenários high-energy, high-water-consumption e pump-overrun estão descritos em [Sensores](SENSORES.md).

Os testes de domínio estão em services/ingest/test/usage.test.ts; API, RLS, custo de R$ 50, aumento de 400% e duração da bomba são exercitados em apps/api/test/monitoring.integration.test.ts. Consulte o estado da execução na [matriz de funcionalidades](REVISAO_FUNCIONALIDADES.md).
