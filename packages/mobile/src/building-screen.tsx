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
        // Replace the domain, including its pollers/form state, without
        // flattening that boundary into the stable native scroll container.
        <View key={domain} collapsable={false} style={styles.page}>
          {children}
        </View>
      ) : children}
    </ScrollView>
  );
}
