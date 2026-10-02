# Capturas de execução iOS

O job [ios.yml](../../.github/workflows/ios.yml) compila os dois apps em Release unsigned e executa o próprio `.app` no simulador do runner macOS. A captura usa o `simctl`, ferramenta da Apple apresentada em [Become a Simulator expert](https://developer.apple.com/videos/play/wwdc2020/10647/).

O script escolhe uma combinação iPhone/runtime já disponível e não mais recente que o SDK do Xcode selecionado, cria um dispositivo novo e instala o build. Confere que o processo permanece vivo durante 15 segundos, captura a tela, exige título do produto e campos do formulário via [OCR Vision da Apple](https://developer.apple.com/documentation/vision/recognizing-text-in-images), encerra somente esse processo e repete com um processo novo. No fim remove apenas o simulador criado pelo script. Não reinicia o computador, não usa aparelho pessoal e não autentica contas.

Antes de compilar, o checkout descartável recebe o endereço reservado `https://smoke-api.invalid`, usando o mesmo adaptador restrito do teste Android. Esse domínio não é um backend e nenhum formulário é enviado. Isso permite verificar o formulário sem configurar nem simular uma implantação real; o `.app` do artefato serve exclusivamente para esse ensaio.

Cada artefato contém duas imagens PNG, os resultados de OCR, log do processo e `result.json` com commit, SDK/runtime, produto, fases e hashes SHA-256 do executável e das imagens. Também é necessário inspecionar as imagens. Um splash, tela vazia ou erro deve ser registrado como problema, mesmo que o processo tenha sobrevivido.

O escopo atual não cobre login, backend, interação, notificações, segundo plano, acessibilidade, dispositivo físico ou distribuição pela App Store. Não confundir capturas de inicialização com homologação completa do iOS.

A [primeira execução, ac28caf](https://github.com/helberjf/predioON/actions/runs/36998776108), abriu Morador em dois processos, mas a inspeção das imagens revelou o aviso de API não configurada. Não foi aprovada como formulário funcional. Operação não chegou a instalar: `simctl install` excedeu 120 segundos, antes de qualquer fase do app. Ambos selecionaram runtime26.2 com Xcode16.4. A preparação passou a usar a origem reservada, selecionar runtime compatível com o SDK e verificar o formulário por OCR. A nova execução real permanece pendente; não se atribui uma causa definitiva ao timeout nem se repete a instalação para mascará-lo.
