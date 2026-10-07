# Automações

Uma automação diz: **quando chegar um alerta assim, abra uma ordem de serviço assim**. É o terceiro domínio da etapa 4 da [arquitetura](superpowers/specs/2026-09-27-arquitetura-produto-design.md).

## O que uma automação pode e não pode fazer

- **Pode:** abrir uma ordem de serviço, com título, prioridade, equipe e ativo definidos na regra. A descrição da ordem é a mensagem do alerta.
- **Não pode:** acionar portão, bomba ou qualquer equipamento. Não existe ação de comando no contrato nem no banco; um corpo que tente declarar outra ação é recusado. Comando físico continua exigindo uma pessoa, pelo módulo de acessos.

## Versões, publicação e ativação

| Estado | Significado |
| --- | --- |
| Rascunho | Regra criada, nenhuma versão publicada. Não reage a nada |
| Desativada | Há versão publicada, mas a regra está desligada |
| Ativa | A versão publicada reage aos alertas novos |

Cada alteração do conteúdo cria uma **versão nova, numerada e imutável**. Publicar escolhe qual versão vale. Assim o histórico de execuções sempre aponta para uma definição que não muda depois do fato. Toda regra nasce desativada.

**Simulação:** antes de publicar, qualquer versão pode ser testada contra os alertas dos últimos 30 dias. A simulação usa a mesma função do gatilho real, então não há como divergirem; e não cria nem registra nada.

**Pausa (cooldown):** depois de abrir uma ordem, a regra ignora novos alertas pelo tempo configurado, para um sensor oscilando não abrir dezenas de ordens. O alerta ignorado fica registrado como "em pausa".

## Permissões

| Permissão | Papéis | Permite |
| --- | --- | --- |
| `automations:read` | Síndico, gestor de manutenção, manutenção | Consultar regras, versões, execuções e simular (a simulação também exige `alerts:read`) |
| `automations:manage` + `work-orders:assign` | Síndico | Criar, versionar, publicar, ativar e desativar |

Criar uma versão exige também poder distribuir ordens de serviço, porque a regra passa a abrir ordens em nome de quem a criou.

## API

Em `/v1/automations`, com `Cache-Control: no-store`.

| Rota | Uso |
| --- | --- |
| `GET /?buildingId=` | Lista com estado, versão publicada e quantas ordens já abriu |
| `POST /` | Cria a regra com a versão 1, como rascunho |
| `GET /:id` | Regra, versões e as 20 execuções mais recentes |
| `POST /:id/versions` | Acrescenta uma versão. Exige `version` da regra |
| `POST /:id/publish` | Publica uma versão existente |
| `POST /:id/state` | Ativa ou desativa. Ativar sem versão publicada responde 409 |
| `POST /:id/simulate` | Simula uma versão |

## Por que a execução fica no banco

A arquitetura previa um worker de automações. Para a única ação que existe hoje, um gatilho na tabela de alertas é mais simples e mais seguro:

| Propriedade | Como é obtida |
| --- | --- |
| Alerta e ordem nascem juntos ou não nascem | O gatilho roda na transação que grava o alerta |
| O mesmo alerta nunca abre duas ordens | Chave única (regra, alerta) em `automation_runs` |
| Uma automação com defeito não perde o alerta | Cada regra roda isolada; a falha vira uma execução `FAILED` e as demais regras seguem |
| Sem processo novo para operar | Nada a implantar, monitorar ou reiniciar |

O limite dessa escolha é conhecido: se um dia houver ações lentas ou externas (notificar por push, chamar um serviço), elas **não** devem entrar nesse gatilho; aí sim vão para a fila durável (outbox) e um worker. Abrir uma linha na mesma base não justifica esse custo.

## Defeitos encontrados pelos testes antes da publicação

- Um alerta **sem equipamento** disparava regra restrita a um equipamento: a comparação com valor nulo resultava em "desconhecido" e não em "falso".
- A trava de imutabilidade das versões impedia apagar um condomínio em cascata e limpar a referência quando uma equipe, ativo ou equipamento é removido.

Os dois estão cobertos por teste.

## Limites atuais

- Uma única ação (abrir ordem de serviço) e um único gatilho (alerta novo em aberto).
- Tela no portal de operação web (`/automacoes`); não há tela nos apps.
- Os tipos de alerta são digitados como texto; não há lista de tipos conhecidos na tela.
- A simulação olha no máximo 50 alertas dos últimos 30 dias.
