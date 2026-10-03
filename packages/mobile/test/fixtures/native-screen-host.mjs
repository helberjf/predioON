import React from "react";

export const events = [];
let nextInstance = 0;
export const Platform = { OS: "android" };
export const AppState = {
  currentState: "active",
  addEventListener() { return { remove() {} }; },
};
export function resetHost(os) {
  Platform.OS = os;
  events.length = 0;
  nextInstance = 0;
}
export const ScrollView = React.forwardRef(function InstrumentedScrollView(props, ref) {
  const [instance] = React.useState(() => ++nextInstance);
  React.useImperativeHandle(ref, () => ({
    scrollTo(options) { events.push({ kind: "scrollTo", instance, options }); },
  }), [instance]);
  React.useEffect(() => {
    events.push({ kind: "mount", instance });
    return () => { events.push({ kind: "unmount", instance }); };
  }, [instance]);
  return React.createElement("NativeScrollView", { ...props, instance }, props.children);
});
export const View = "NativeView";
export const Text = "NativeText";
export const Pressable = "NativePressable";
export const TextInput = "NativeTextInput";
export const ActivityIndicator = "NativeActivityIndicator";
export const StyleSheet = { create: value => value };
