import React, { useLayoutEffect, useRef, type ReactNode } from "react";
import { Platform, ScrollView, View } from "react-native";
import { styles } from "./ui.tsx";

/** Own the scroll container for one selected building domain. */
export function BuildingScreen({
  screen,
  children,
}: {
  screen: string | null;
  children: ReactNode;
}) {
  const scroll = useRef<React.ElementRef<typeof ScrollView>>(null);
  const android = Platform.OS === "android";
  const domain = screen ?? "permissions";
  useLayoutEffect(() => {
    if (android) scroll.current?.scrollTo({ x: 0, y: 0, animated: false });
  }, [android, domain]);
  return (
    <ScrollView
      // Keep the Android Fabric scroll host alive across domain transitions.
      // BuildingApp's user/building key still replaces the whole scope.
      key={android ? "building-scroll" : domain}
      ref={android ? scroll : undefined}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={android ? undefined : styles.page}
    >
      {android ? (
        // Keep the native parent stable while replacing the React domain,
        // including its pollers and form state, at the keyed fragment.
        <View collapsable={false} style={styles.page}>
          <React.Fragment key={domain}>{children}</React.Fragment>
        </View>
      ) : children}
    </ScrollView>
  );
}
