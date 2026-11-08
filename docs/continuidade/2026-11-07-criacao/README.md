# Overlay portátil dos três POSTs de estrutura

Pacote de fontes **sem aceite de execução nesta autoria**. Contém exatamente
dois payloads: o candidato routes.ts e o teste novo platform-mfa-tenancy-create.
O alvo possui1.035 arquivos. A restauração confirma bytes, mas não substitui
tipos, testes dirigidos, regressão ou inspeção da limpeza. Root ainda precisa
classificar as evidências deste incremento antes de declarar GREEN.

## Cadeia de restauração

Restaure os85 payloads/1.028 arquivos do checkpoint, aplique diretamente V4
para1.031, obrigatório por flag para1.032, vínculo global para1.033 e revogações
para1.034. Não aplicar V3 antes da V4. Só então aplicar este pacote em uma
pasta nova cujo diretório pai já exista:

```text
node apply-create.mjs --candidate ../api-revogacoes-1034 --output ../api-criacao-1035
```

Parent: c2bb641f60ff44d847f4b34cf472cddcf235e0897c93659767eab514816a3c25.
Fixed alvo: ce90003f2777c890195c814b6560f0ca26edb2989f1770a2c4aabea8939d54ff.
Os hashes identificam inventários, sem caminhos absolutos de máquina neste
pacote. No computador de autoria, o parent restaurado correspondente fica em
work/mfa-revocation-portable-restored-20261107; isso é referência relativa,
não um destino obrigatório para continuar em outro computador.

O core85 e todos os overlays publicados continuam intactos. São preservados
**cinco casos históricos de browser em quatro arquivos de specs**: três daV4,
um obrigatório por flag e um por vínculo global. Nenhum deles é reexecutado
por este pacote ou representa aceite novo deste lote API.

O aplicador verifica seu pacote, todos os1.034 arquivos do parent e ambos os
payloads antes da primeira escrita. Copia somente esse inventário, substitui
routes e acrescenta o teste. Compara os1.035 arquivos finais e relê o parent
para comprovar preservação. Emite API-CREATE-RESTORE-RECEIPT.json. O arquivo
novo usa beforeSha256:null e beforeBytes:null, normalizando new-test-v1.

Destino existente é recusado, sem sobrescrita de tentativa anterior. Não há
instalação, teste, migration ou serviço executado pelo aplicador. Não copia
dotenv, node_modules, dist, caches, mídia, receipts anteriores ou suportes
separados do checkpoint. Dependências, runner/config de tipos e controladores
de banco são providenciados em etapas separadas.

## Produto e contrato preservado

O único arquivo de produto alterado é apps/api/src/modules/tenancy/routes.ts:
before37754d79→after3f0f4db1. Os handlers modificados são exclusivamente
POST /v1/tenancy/blocks, /units e /teams. O teste novo tem hashd36843c3.

INSERT SELECT e retorno escalar consomem a mesma CTE MFA. A resposta exige
exatamente uma linha com UUID válido antes da auditoria. Depois de auditar,
há nova decisão MFA na mesma transação, destinada a permitir rollback se a
prova for removida durante a auditoria. Não se promete serialização universal
até commit, nem revalidação após toda possível espera de unicidade/FK.

DTOs completos7/9/8 campos, datas convertidas paraDate e serializaçãoISO,
defaults do banco, metadata de units/teams e valores opcionais/null mantêm
o contrato. floor:null explícito continua aceito. Um INSERT inesperadamente
vazio não tem no-op válido: erro interno500 e rollback, nunca201 vazio.

Capacidades locais, schemas, RLS, ACL, constraints, mapeamentos de erros,
eventos/ordem de auditoria, seis PATCHs, três DELETEs, outros handlers,
helpers compartilhados e SQL068 permanecem inalterados. Este pacote não
amplia autoridade de plataforma nem implementa POST de vínculos/convites.

## Expectativas dos ensaios, ainda sem resultados

O mesmo teste comum é usado na baseline e fixed. Planejamento:17 casos
independentes, zero grupos pais, uma suite. Baseline esperado10PASS/7FAIL;
fixed17PASS. Os sete REDs devem ser201 versus403 com Baseline201, DTO,
linha real e auditoria conferidos: seis após assertCapability real e um
após trigger estreito de auditoria com testemunha.500, timeout e falhas de
fixture/fronteira não são RED. O teste não fabrica aprovação MFA positiva.

Há controles de gestor opcional/administrador satisfeito, formato completo,
defaults, escopo, ausência de capacidade, FK composta, null explícito,
duplicidade409 e validações de input. O trigger dirigido pertence à fixture
e não ao produto. INSERTzero forçado, espera real de lock, promoção posterior,
perda de capacidade durante espera e concorrência completa não são cobertos.

Regressão aprovada para execução separada: oito arquivos seriais113TAP,
103 independentes e10 grupos,8suítes. Tipos selecionam31 testes e13 fontes.
17 e113 são expectativas desta autoria; não somar provas históricas nem
converter preparação/restauração em sucesso funcional. Citar depois os
logs reais e a classificação restrita que o root concluir.

## Operação e limites

Resolver dependências conforme lockfile em etapa própria. Bibliotecas do
workspace devem apontar ao src desta árvore, sem dist ou imports do checkout
antigo. Os ensaios API usam configuração própria, sem iniciar configs E2E.
Manter guard1.536MiB, fixture UUID oficial, role restrita e cluster owned já
ligado. Owner é exclusivo de setup/interleaving/inspeção, não de HTTP.

Segredos e e-mail permanecem fora dos artefatos. Não iniciar/reiniciar
computador, Docker ou WSL durante a sessão. Preservar todos os resultados.
Se um filho direto registrado não tiver saída observada, segurar cleanup
de banco/roles e registrar IDs próprios; não fazer DROP FORCE nem encerrar
processos desconhecidos. Após saída confirmada, comprovar base removida,
seis roles/settings restaurados e fontes intactas.

Sem mídias neste pacote. Não há revalidação de Playwright, Android/iOS,
desempenho ou operação. Main001–067 e política068 candidata; integração
final e produção continuam pendentes. O autor não executou este aplicador,
restauração, Node, tipos, banco, testes ou serviços.
