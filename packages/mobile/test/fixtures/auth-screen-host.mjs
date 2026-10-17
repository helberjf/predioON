export * from "./native-screen-host.mjs";
import { resetHost as resetNativeHost } from "./native-screen-host.mjs";
export const KeyboardAvoidingView = "NativeKeyboardAvoidingView";
const listeners = new Set();
export const AppState = {
  currentState: "active",
  addEventListener(_event, listener) {
    listeners.add(listener);
    return { remove() { listeners.delete(listener); } };
  },
};
export function changeAppState(state) {
  AppState.currentState = state;
  for (const listener of listeners) listener(state);
}
export function resetHost(os) {
  resetNativeHost(os);
  listeners.clear();
  AppState.currentState = "active";
}
