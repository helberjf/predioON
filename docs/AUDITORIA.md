# Histórico de atividades e auditoria

Este documento descreve a implementação 036. O estado de publicação, resultados completos e pendências do produto ficam em [CONTINUIDADE.md](CONTINUIDADE.md).

## Usar a tela

Na administração ou no portal do condomínio, abra **Histórico de atividades**. No portal do condomínio, a seleção de Condomínio em uso determina o filtro. A administração mostra a união dos escopos explicitamente concedidos à conta.

A tela apresenta até 25 registros por página, do mais recente ao mais antigo. **Página anterior** e **Próxima página** consultam outras páginas; **Atualizar histórico** volta à primeira página. A consulta também é atualizada ao retornar à janela e a cada 30 segundos. Atualizações simultâneas são agrupadas, sem descartar uma consulta lenta.

Carregamento, erro e ausência de registros têm estados distintos. **Tentar novamente** consulta o servidor outra vez. Um 403 significa ausência da capacidade de consultar aquele escopo; não significa que o histórico inteiro está vazio. A troca de conta ou condomínio desmonta a lista anterior. Respostas atrasadas não podem preencher a lista da nova identidade.

## Quem pode consultar

| Concessão vigente | Leitura permitida |
| --- | --- |
| `audit:read-platform` global | Registros classificados como PLATFORM. Não inclui automaticamente os registros privados dos condomínios. |
| `audit:read` amplo no condomínio | Histórico associado ao tenant original autorizado, incluindo o evento global que o provisionou. |
| `audit:read` em recurso exato | Registros do recurso concreto, ainda existente e pertencente àquele condomínio. Não inclui vizinhos nem recursos removidos. |
| Permissões operacionais sem auditoria | Não permitem consultar auditoria por inferência. |

Na primeira instalação, o catálogo concede a leitura local a BUILDING_ADMIN e a global a PLATFORM_ADMIN. O catálogo pode ser alterado ou desativado depois; reaplicar a migration não recria permissões/grants removidos nem os reativa. Suporte diagnóstico e morador não recebem leitura de auditoria implicitamente.

Concessões pessoais/equipes, vigência, revogação, conta, papel, permissão, organização e condomínio são avaliados no banco. A leitura pelo mesmo token deixa de funcionar após uma revogação aplicável. Um papel enviado no contexto ou uma informação antiga de membership no token não substitui a autoridade vigente. Para navegar pelo seletor do portal, a conta também precisa conseguir descobrir o condomínio por uma concessão adequada de `buildings:read`; a descoberta não concede auditoria.

## Contrato HTTP

`GET /audit` exige uma sessão autenticada e autoridade atual. Parâmetros:

| Parâmetro | Regra |
| --- | --- |
| `buildingId` | Opcional; texto não vazio, até 128 caracteres; filtra o tenant original. |
| `limit` | Inteiro de 1 a 200; padrão 50. A interface usa 25. |
| `offset` | Inteiro não negativo; padrão 0. |

Exemplo de consulta: `/audit?buildingId=bld_demo&limit=25&offset=0`.

```json
{
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "buildingId": "bld_demo",
      "scopeKind": "BUILDING",
      "userId": "user_demo",
      "actorType": "USER",
      "action": "DEVICE_UPDATED",
      "resourceType": "device",
      "resourceId": "device_demo",
      "createdAt": "2026-10-03T12:00:00.000Z"
    }
  ],
  "limit": 25,
  "offset": 0
}
```

O DTO tem somente os nove campos do exemplo. `buildingId`, `userId` e `resourceId` podem ser NULL; `actorType` também admite SYSTEM e GATEWAY. A projeção não contém metadata, IP ou user-agent. As respostas aprovadas têm `Cache-Control: no-store`. A consulta rejeita parâmetros inválidos com 400 e falta de capacidade com 403; uma consulta autorizada sem registros retorna 200 com `items: []`.

A ordenação é `created_at DESC, id DESC`, garantindo desempate estável entre timestamps iguais. A paginação poroffset conserva o contrato existente; inserções concorrentes podem mudar a posição entre consultas. Para percorrer um histórico que mudou, use Atualizar histórico. Esta implementação não fornece um snapshot imutável nem um cursor de exportação.

## Escopo persistido e privacidade

`scope_kind` distingue PLATFORM, BUILDING eLEGACY_UNKNOWN. `scope_building_id` guarda o tenant original semFK. O banco deriva os dois campos na inserção e impede sua alteração posterior. A remoção da FK de apresentação `building_id` não transforma um evento local em global nem apaga seu tenant original.

Registros antigos sem tenant comprovado ficam LEGACY_UNKNOWN e não aparecem na projeção. A migration não reconstrói autoridade a partir de metadata ou da identidade de um administrador. Recursos removidos podem conservar histórico para leitores amplos de um condomínio ainda autorizado; a remoção do próprio condomínio não cria uma nova concessão para consultar seus registros.

A API restringe candidatos pelos grants atuais e o PostgreSQL aplica RLS a cada linha, incluindo o recurso exato. O runtime pode selecionar somente as colunas públicas; SELECT direto dos campos privados e UPDATE/DELETE são negados. Payloads antigos continuam armazenados para o proprietário administrativo. Um futuro detalhamento precisa de política própria de campos por ação.

## Escrita e revogação

Leitura de auditoria não concede escrita. Produtores migrados conservam suas provas específicas, incluindo acesso físico 034. O fallback legado aceita somente os pares finitos de ação/recurso definidos na migration, com autoridade vigente e entidade real no mesmo tenant. Uma policy restritiva adicional comprova os produtores globais. A matriz completa está no [plano036](superpowers/plans/2026-10-02-audit-capabilities.md).

Na revogação do próprio último vínculo administrativo legado, o registro é inserido antes de remover a autoridade, dentro da mesma transação. `UPDATE ... RETURNING` deve confirmar uma alteração. Se o banco recusar silenciosamente a mutação, a API retorna 409 e reverte o registro; falhas na auditoria ou na mutação revertem ambas. O registro não pode declarar uma revogação que não ocorreu.

## Instalação e verificação

Use o runner de [migrations](MIGRATIONS.md) e as credenciais restritas, sem seed/reset em dados reais. Depois da instalação, confira ledger/checksums com `pnpm db:infra --check`. O ensaio de [backup/restauração](BACKUP_E_RESTAURACAO.md) verifica o histórico 036, policies, ACLs de coluna, helpers, revogação, campos privados e retenção do escopo depois de remover aFK.

Os casos HTTP/RLS estão em `apps/api/test/audit-capabilities.test.ts`; os cinco cenários do consumidor estão em `e2e/audit.spec.ts`. Execute-os somente em banco descartável preparado. A suíte Playwright usa API real, três motores e bundles compilados; confira os resultados exatos em Continuidade. O processamento durável, outros administrativos legados, apps nativos e os vídeos completos continuam sujeitos às etapas restantes do produto.
