# Ativos

Um ativo é uma coisa física que a manutenção cuida: uma bomba, um elevador, um gerador, um portão. O cadastro responde a duas perguntas que antes não tinham onde morar: **quais equipamentos monitorados vigiam este ativo** e **o que já foi feito nele**.

## Relação com o resto

| Conceito | O que é | Relação |
| --- | --- | --- |
| Equipamento (`devices`) | Sensor ou atuador ligado a um gateway | Um ativo pode ter vários equipamentos monitorando-o |
| Ativo (`assets`) | O bem físico | Cadastro manual, por condomínio |
| Ordem de serviço | Trabalho de manutenção | Pode apontar para um ativo; o conjunto forma o histórico dele |

## Permissões

Não há permissão nova. O cadastro segue as de equipamentos, que já existiam:

| Permissão | Papéis | Permite |
| --- | --- | --- |
| `devices:read` | Síndico, gestor de manutenção, manutenção | Consultar ativos **em uso**, seus equipamentos e o histórico que a pessoa pode ver |
| `devices:configure` | Síndico | Cadastrar, editar, desativar/reativar, vincular equipamentos e ver inativos |

O histórico de manutenção de um ativo mostra só as ordens de serviço que o solicitante já poderia ver: quem distribui vê todas, o técnico vê as dele e as da equipe.

## API

Em `/v1/assets`, com `Cache-Control: no-store`.

| Rota | Uso |
| --- | --- |
| `GET /?buildingId=&includeInactive=&after=&limit=` | Lista por nome. `canManage` informa se os controles de gestão se aplicam. Inativos exigem `devices:configure` |
| `POST /` | Cadastra |
| `GET /:id` | Ativo, equipamentos vinculados e até 50 ordens de serviço visíveis |
| `PATCH /:id` | Edita dados ou o estado ativo. Exige `version`; valor desatualizado responde 409 |
| `PUT /:id/devices` | Substitui o conjunto de equipamentos vinculados |

Nas ordens de serviço, `assetId` é aceito na abertura e na edição por quem distribui.

## Regras garantidas no banco (migration 044)

- **Condomínio do vínculo:** um equipamento de outro condomínio não pode ser vinculado, mesmo por `INSERT` direto. A tabela de equipamentos não tem chave composta com o condomínio, então a conferência é feita por gatilho.
- **Ativo na ordem de serviço:** só um ativo em uso do mesmo condomínio, e só por quem pode consultá-lo. Quem executa a ordem não troca nem remove o ativo.
- **Ativo desativado:** some das listas e não pode receber novas ordens; as ordens antigas continuam apontando para ele.
- **Sem exclusão:** a role da API não apaga ativos. Desativa-se.
- **Edição concorrente:** toda alteração incrementa `version`; uma alteração sem isso é recusada.

A 044 substitui a função `app_work_order_guard` criada na 043 para incluir o ativo. Por isso reaplicar a 043 deixou de ser invariante, e a prova de reaplicação passou para o teste da 044.

## Limites atuais

- Tela no portal de operação web (`/ativos`). Não há tela de ativos nos apps; a ordem de serviço no app Operação ainda não mostra o ativo.
- Sem fotos, documentos, plano de manutenção preventiva ou leitura dos sensores na ficha do ativo.
- Categorias fixas: bomba, elevador, gerador, portão, climatização, combate a incêndio, elétrica, hidráulica e outro.
