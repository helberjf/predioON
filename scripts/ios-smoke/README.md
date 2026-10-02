# Capturas de execução iOS

O job [ios.yml](../../.github/workflows/ios.yml) compila os dois apps em Release unsigned e executa o próprio `.app` no simulador do runner macOS. A captura usa o `simctl`, ferramenta da Apple apresentada em [Become a Simulator expert](https://developer.apple.com/videos/play/wwdc2020/10647/).

O script escolhe uma combinação iPhone/runtime já disponível no Xcode, cria um dispositivo novo e instala o build. Confere que o processo permanece vivo durante 15 segundos, captura a tela, encerra somente esse processo e repete com um processo novo. No fim remove apenas o simulador criado pelo script. Não reinicia o computador, não usa aparelho pessoal e não autentica contas.

Cada artefato contém duas imagens PNG, log do processo e `result.json` com commit, runtime, produto, fases e hashes SHA-256 do executável e das imagens. A aprovação do processo não prova que o formulário está correto: é necessário inspecionar as imagens. Um splash, tela vazia ou erro deve ser registrado como problema, mesmo que o processo tenha sobrevivido.

O escopo atual não cobre login, backend, interação, notificações, segundo plano, acessibilidade, dispositivo físico ou distribuição pela App Store. Não confundir capturas de inicialização com homologação completa do iOS. A primeira execução real desse novo passo ainda precisa ser conferida.
