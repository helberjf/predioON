export * from "./native-screen-host.mjs";
import { events, resetHost as resetNativeHost } from "./native-screen-host.mjs";

export const KeyboardAvoidingView = "NativeKeyboardAvoidingView";
export const StatusBar = "NativeStatusBar";
export const SafeAreaProvider = "NativeSafeAreaProvider";
export const SafeAreaView = "NativeSafeAreaView";
export const Alert = { alert() { throw new Error("Unexpected native alert in read-only consumption"); } };
export const Linking = { openURL() { throw new Error("Unexpected native link in read-only consumption"); } };
// Native adapters are only imported by the app; BuildingApp never calls these.
export const ACCESSIBLE = { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "fixture" };
const listeners = new Set();
let nextListener = 0;
export const AppState = {
  currentState: "active",
  addEventListener(_event, listener) {
    const instance = ++nextListener;
    listeners.add(listener);
    events.push({ kind: "listener-add", instance });
    return { remove() {
      if (listeners.delete(listener)) events.push({ kind: "listener-remove", instance });
    } };
  },
};
export function changeAppState(state) {
  AppState.currentState = state;
  for (const listener of listeners) listener(state);
}
export function listenerCount() { return listeners.size; }
export function resetHost(os) {
  resetNativeHost(os);
  listeners.clear();
  nextListener = 0;
  AppState.currentState = "active";
}
