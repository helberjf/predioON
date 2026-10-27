// The only module that loads the camera. The resident app imports it and hands
// it to the access screen, so the operations app never links or loads it.
import React, { useEffect, useRef, useState } from "react";
import { Linking, PermissionsAndroid, Platform, Text, View } from "react-native";
import { Camera, CameraType } from "react-native-camera-kit";
import { parseGateQr } from "@predioon/contracts/gate-qr";
import type { GateScannerProps } from "./access.tsx";
import { Button, colors, styles } from "./ui.tsx";

type Permission = "asking" | "granted" | "denied";

export function GateScanner({ onCode, onCancel }: GateScannerProps) {
  // iOS asks by itself when the camera starts; Android needs the runtime grant first.
  const [permission, setPermission] = useState<Permission>(
    Platform.OS === "android" ? "asking" : "granted",
  );
  const read = useRef(false);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    let live = true;
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
      title: "Câmera para o QR do portão",
      message: "O Prédio ON usa a câmera só para ler o QR code do portão.",
      buttonPositive: "Permitir",
      buttonNegative: "Agora não",
    })
      .then((result) => {
        if (live) setPermission(result === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied");
      })
      .catch(() => {
        if (live) setPermission("denied");
      });
    return () => {
      live = false;
    };
  }, []);

  if (permission === "asking")
    return <Text style={styles.muted}>Aguardando a permissão da câmera…</Text>;
  if (permission === "denied")
    return (
      <View style={{ gap: 10 }}>
        <Text style={styles.text}>
          Sem acesso à câmera não é possível ler o QR. Libere a câmera para o Prédio ON nos ajustes do aparelho.
        </Text>
        <Button label="Abrir ajustes" onPress={() => void Linking.openSettings()} />
        <Button label="Cancelar" secondary onPress={onCancel} />
      </View>
    );
  return (
    <View style={{ gap: 10 }}>
      <Camera
        style={{ height: 320, borderRadius: 12, overflow: "hidden" }}
        cameraType={CameraType.Back}
        scanBarcode
        allowedBarcodeTypes={["qr"]}
        showFrame
        frameColor={colors.green}
        laserColor={colors.green}
        onReadCode={(event) => {
          const content = event.nativeEvent.codeStringValue;
          // Other QR codes are ignored silently; the first gate QR stops the reading.
          if (read.current || !parseGateQr(content)) return;
          read.current = true;
          onCode(content);
        }}
      />
      {Platform.OS === "ios" && (
        <Text style={styles.muted}>
          Se a imagem ficar preta, libere a câmera para o Prédio ON em Ajustes.
        </Text>
      )}
      <Button label="Cancelar" secondary onPress={onCancel} />
    </View>
  );
}
