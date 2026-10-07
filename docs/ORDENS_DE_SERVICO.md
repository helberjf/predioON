# Ordens de serviço

Primeiro domínio novo da etapa 4 da [arquitetura](superpowers/specs/2026-09-27-arquitetura-produto-design.md). Uma ordem de serviço é um trabalho de manutenção distribuído pela gestão e executado por uma pessoa ou equipe. **Não é um chamado de morador**: pode apontar para um chamado, mas tem ciclo, responsáveis e permissões próprios.

## Quem faz o quê

As três permissões existem no catálogo desde a migration 014; a 043 passou a usá-las.

| Permissão | Papéis que a recebem | O que permite |
| --- | --- | --- |
| `work-orders:assign` | Síndico, gestor de manutenção | Abrir, editar, atribuir, cancelar e ver todas as ordens do condomínio |
| `work-orders:read-assigned` | Síndico, gestor de manutenção, manutenção | Ver as ordens atribuídas a si ou a uma equipe da qual participa agora |
| `work-orders:update-assigned` | Os mesmos | Iniciar, pausar, concluir e anotar nessas ordens |

Morador não tem nenhuma das três. Quem executa não edita título, prioridade, prazo ou responsável, e não cancela.

## Estados

```
OPEN ──iniciar──▶ IN_PROGRESS ──concluir──▶ DONE
  ▲                  │
  └────pausar────────┘
OPEN ou IN_PROGRESS ──cancelar (só quem distribui)──▶ CANCELLED
```

`DONE` e `CANCELLED` são finais: uma ordem encerrada não reabre nem é editada. Abre-se outra.

## API

Todas em `/v1/work-orders`, com `Cache-Control: no-store`.

| Rota | Uso |
| --- | --- |
| `GET /?buildingId=&status=&after=&limit=` | Lista o que o solicitante pode ver, da mais recente para a mais antiga. `canDistribute` informa se os controles de gestão se aplicam. 403 para quem não tem nenhuma das permissões |
| `POST /` | Abre a ordem. Responsável opcional: `assignedUserId` **ou** `assignedTeamId` |
| `GET /:id` | Ordem com o histórico |
| `PATCH /:id` | Edita dados ou responsável. Exige `version` |
| `POST /:id/status` | Muda o estado, com anotação opcional. Exige `version` |
| `POST /:id/notes` | Acrescenta uma anotação ao histórico |

Uma ordem fora da visão do solicitante responde 404, igual a uma inexistente. `version` desatualizada responde 409: a tela recarrega em vez de sobrescrever o trabalho de outra pessoa.

## Por que as regras estão no banco

| Decisão | Motivo |
| --- | --- |
| Visibilidade por RLS (`app_work_order_access`) | A API usa a role não-dona; uma consulta sem filtro não devolve ordens de outro condomínio nem de outro executor. |
| Campos e transições num gatilho (`app_work_order_guard`) | RLS decide linhas, não colunas. Gestor e executor atualizam a mesma linha com direitos diferentes; o gatilho recusa edição pelo executor, salto de estado e alteração de ordem encerrada, mesmo num `UPDATE` direto. |
| Atribuição a equipe usa a equipe **ativa** e a participação **vigente** | Desativar a equipe, encerrar a participação ou revogar o papel retira a ordem da visão do executor na próxima requisição, sem tocar na ordem. |
| Responsável precisa ter vínculo atual com o condomínio | Evita atribuir a uma conta de fora. O que a pessoa enxerga depois continua dependendo das permissões dela. |
| Um responsável por ordem, em colunas da própria ordem | A arquitetura previa uma tabela de atribuições; com um único responsável ela só acrescentaria uma junção. As trocas ficam em `work_order_events`. Se surgirem vários responsáveis simultâneos, essa tabela entra numa migration própria. |
| Histórico (`work_order_events`) e auditoria (`audit_logs`) separados | O histórico é o que a equipe lê na ordem; a auditoria é o registro de quem agiu, com a mesma prova de autoridade dos outros domínios. Ambos confirmam na transação da mudança. |

## Limites atuais

- Portal de operação web (`/ordens-servico`): distribuição e execução completas.
- App Operação (Android/iOS): aba **Ordens de serviço**, aberta por `work-orders:assign` ou `work-orders:read-assigned`, independente do resumo do condomínio. Permite iniciar, pausar, concluir (com confirmação), ver o histórico e anotar. Abrir, editar, atribuir e cancelar ficam no portal web. **Sem execução nativa verificada**: ver [CONTINUIDADE.md](CONTINUIDADE.md).
- Sem anexos, checklists, notificações push ou criação automática por alerta/automação. O vínculo com ativo existe desde a 044: ver [ATIVOS.md](ATIVOS.md).
- O vínculo com chamado existe na API (`occurrenceId`, exige `occurrences:manage`), sem controle na tela.
- A lista traz até 100 ordens por página; a tela ainda não pagina além disso.
- Não há chave de funcionalidade por condomínio para este módulo: quem tem a permissão vê o item de menu.
