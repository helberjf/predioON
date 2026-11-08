# Situação de validação das concessões

Registro de 08/11/2026. **Tipos e restauração passaram; testes funcionais ainda não começaram.** O [pacote](README.md) contém os dois payloads e o inventário completo. A [prova de restauração](../../evidencias/mfa-tenancy-grants-restore-2026-11-08.json) confirma 1.036 arquivos e a preservação do pai; ela não é um teste funcional.

O [registro do ambiente](../../evidencias/mfa-tenancy-grants-environment-2026-11-08.json) preserva os impedimentos: o Docker estava fechado; depois de abri-lo, o contêiner antigo foi inicialmente visto parado e em consulta posterior deixou de existir no ambiente ativo. A causa dessa indisponibilidade não foi estabelecida. A tentativa de iniciar o contêiner antigo foi recusada pela conferência de identidade e nenhum start dele ocorreu.

Foi criado um banco de QA exclusivo novo, com volume próprio, porta 5468 apenas em loopback, 384 MiB e uma CPU. Sua identificação é nova, registrada na evidência; não reutilizar a atestação de 03/11. O computador não foi reiniciado. O segundo launcher parou no limite de memória, antes de controller, fixture, migrations ou testes. Não foi reduzido o limite de 1.536 MiB.

Após liberar memória, criar uma pasta de evidências nova usando os controles revisados do novo cluster. As fontes baseline/fixed continuam em `work/mfa-tenancy-grants-{baseline,fixed}-qa-20261108`, com tipos aprovados. O executor dirigido exige `ExpectedHead` da fonte canônica `53c4c70dcd24f1045fad420fbce36757fd3753a2`; o HEAD corrente é registrado separadamente. Revisar os seis erros específicos 201 versus 403 do baseline, com oráculos de dados e auditoria; somente então executar fixed e regressão serial. Preservar todos os logs e pós-checks.

Contagens planejadas: 17 dirigidos (baseline esperado 11 PASS/6 FAIL específicas), depois 130 TAP em nove regressões. Ainda não são resultados aprovados. Os resultados aceitos de criação e revogação anteriores continuam válidos para suas próprias fontes e execuções, sem transferir aceite para estas concessões. A política MFA obrigatória segue candidata; Android/iOS, restante do web e operação não estão encerrados.
