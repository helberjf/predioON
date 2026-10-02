import "react-native-get-random-values";
import { requestIdFromBytes } from "./access-intents.ts";

export function createNativeRequestId(): string {
  // The dependency's legacy Chrome debugger fallback uses Math.random; reject that mode.
  const native = globalThis as typeof globalThis & {
    RN$Bridgeless?: boolean;
    nativeCallSyncHook?: unknown;
  };
  if (
    __DEV__ &&
    native.RN$Bridgeless !== true &&
    typeof native.nativeCallSyncHook !== "function"
  ) {
    throw new Error(
      "A identificação segura exige o aplicativo no aparelho ou emulador, sem depuração remota legada.",
    );
  }
  return requestIdFromBytes(
    globalThis.crypto.getRandomValues(new Uint8Array(16)),
  );
}
