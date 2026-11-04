# Corrigenda do desenho de MFA obrigatória da plataforma

Estado em04/11: análise estática revisada e dois testes em rascunho **não executados**. Nenhum RED, compilação, migration068 ou implementação foi produzido por este checkpoint. Esta nota corrige as propostas de obrigação e concorrência do [plano inicial](2026-11-04-platform-admin-mfa.md); não declara a entrega da funcionalidade. Código consultado equivalente à14e3008, bases4eb7cab/ee542 com diferenças somente documentais.

## Obrigação e fontes de autoridade

A obrigação deve ser `conta ativa AND (users.is_platform_admin OR app_rbac_platform_role_at(user, 'PLATFORM_ADMIN', instante))`. O ramo do flag legado continua relevante:010-support e as rotas de suporte reconfirmam conta/flag/feature/edifício, sem exigir catálogo de roles ativo; `Identity.role` e app.role também conservam esse caminho. Já021 considera catálogo ativo inclusive para o flag. Portanto, usar somente021 deixaria a MFA facultativa enquanto o suporte legado ainda permitisse privilégios pelo flag. A obrigação não concede capacidade: todas as regras originais continuam necessárias.

PLATFORM_SUPPORT isolado não entra nessa obrigação. Sem flag, binding futuro/expirado/revogado ou catálogo inativo não representa autoridade administrativa vigente. **Com flag e conta ativa, a obrigação persiste** nesses controles. O sexto controle do checkpoint anterior combina flagtrue/catalogoinativo e espera not-required; corrigir explicitamente essa expectativa antes de executá-lo como especificação final. O checkpoint antigo e seus hashes ficam preservados como desenho anterior.

## Autoridade e prova na operação protegida

Pre-gate e post-gate em statements separados não bastam sob READ COMMITTED. Uma conexão pode conceder ADMIN depois do pre-gate, a consulta obter dados com a nova autoridade, e a conexão revogar ADMIN antes do post-gate. Este observaria novamente uma conta comum, deixando passar o dado. Outra lacuna é a promoção entre assertGlobalCapability e o SELECT/UPDATE protegido.

A negativa precisa compartilhar o snapshot da operação que aproveita a autoridade administrativa, comparando família/prova/geração vigente. Um helper concedido somente a identity e chamado por outro pool antes ou depois não fornece esse snapshot. É necessário concretizar a fronteira SQL/ACL: rotina de operação estreita ou guard na autorização/RLS apropriada, com dono/search_path/EXECUTE revisados e sem abrir fatores, bindings ou escrita em sessões à role app. Avaliar expressamente trabalhadores sem sessão humana, caminhos010/021, leitura sem linhas, USING/WITH CHECK, expiração e semântica após espera. Nenhuma dessas alternativas foi implementada ou aceita nesta nota.

O contrato HTTP planejado é403 com `details.reason=MFA_ENROLLMENT_REQUIRED` ou `MFA_VERIFICATION_REQUIRED`, produzido por negativa explícita da mesma observação da operação (retorno discriminado ou erro SQL dedicado precisamente mapeado). Inferir MFA de `rows.length===0` é incorreto: mistura ausência de dados, RLS e autorização. RLS que apenas filtra e retorna200/items=[] não satisfaz esse contrato. Efeitos externos e SSE exigem análise específica; não alegar segurança linearizável global.

## Rascunhos recuperáveis e cobertura pendente

[Novo manifesto](../../continuidade/2026-11-04-mfa-races-manifesto.json) e [patch relativo](../../continuidade/2026-11-04-mfa-races.patch): um arquivo novo, dois casos planejados. Router exclusivo de teste usa authenticate/inTenantContext/assertGlobalCapability e leitura real de organizations sob RLS. Ambos promovem antes do assert; o segundo revoga depois da leitura. Uma implementação que recuse corretamente antes da segunda barreira também é aceita. **Nenhum caso deste lote promove entre assert e SELECT**: esse terceiro cenário continua necessário. Não confundir dois rascunhos com cobertura completa de rotas, SSE ou atomicidade.

A V2 limita espera HTTP, aborta fetch, observa rejeição imediatamente, libera todas as barreiras e encerra somente seu listener/conexões em finally, com tentativa independente de limpeza SQL. Revisão estática aprovou a preservação do draft. Cancelar socket não garante cancelamento de SQL já enviado; cleanup não foi comprovado em execução. A V1 diagnóstica permanece fora do repositório; seu diff absoluto não foi publicado.

Há agora dois checkpoints de um arquivo cada: seis casos do desenho anterior e estes dois, total de oito casos **planejados**, nenhum executado. Ambos ficam fora do glob real81 da API. A restauração comprova bytes somente dos arquivos novos, não de um projeto completo. Retomar em cópia isolada da base exata com fixture UUID oficial/001–067 e recursos coordenados; executar REDs dirigidos, revisar migration/ACL e implementar incrementalmente antes de qualquer aceite. Nunca restaurar .env, segredos, bancos ou chaves privados pelo checkpoint.
