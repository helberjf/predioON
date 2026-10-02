# Prédio ON Morador

Aplicativo React Native sem Expo, com identidade Android/iOS `com.predioon.resident`. Inclui login, seleção de condomínio, avisos, solicitações próprias e reservas usando a API central.

Consulte [instalação, segurança, testes e limitações](../../packages/mobile/README.md). Configure a URL em `config.ts` antes de compilar. A implementação nativa usa o template oficial 0.87.2; a licença está em `TEMPLATE-LICENSE`.

```sh
pnpm --filter @predioon/resident-mobile start
pnpm --filter @predioon/resident-mobile android --no-packager
```

O segundo comando requer SDK/JDK e um emulador/dispositivo Android. Para iOS, use macOS/Xcode e instale os pods conforme a documentação compartilhada. Testes de TypeScript/Metro não constituem validação em dispositivo ou publicação.
