import * as Keychain from "react-native-keychain";
import { createMobileTokenStorage } from "./storage.ts";
import type { Product } from "./scope.ts";

/** Distinct services prevent the two products/environments from sharing credentials. */
export function nativeTokenStorage(product: Product, apiUrl: string) {
  const options = {
    service: `com.predioon.${product}.${apiUrl}`,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  return createMobileTokenStorage({
    async read() {
      const entry = await Keychain.getGenericPassword(options);
      return entry ? entry.password : null;
    },
    async write(refreshToken) {
      if (!await Keychain.setGenericPassword("refresh", refreshToken, options)) {
        throw new Error("Não foi possível salvar a sessão no armazenamento seguro.");
      }
    },
    async remove() {
      const removed = await Keychain.resetGenericPassword(options);
      if (!removed && await Keychain.getGenericPassword(options)) {
        throw new Error("Não foi possível apagar a sessão do armazenamento seguro.");
      }
    },
  });
}
