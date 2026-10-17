import React from "react";
import { Text, View } from "react-native";
import type { Resource } from "./resource.ts";
import {
  consumptionDayLabel,
  consumptionQuantity,
  consumptionRows,
  type ConsumptionItem,
  type ResidentConsumption,
} from "./resident-consumption.ts";
import { Badge, Card, Refresh, styles } from "./ui.tsx";

/** Display exactly the validated response that made this destination available. */
export function ResidentConsumptionScreen({
  resource,
  items,
}: {
  resource: Resource<ResidentConsumption | null>;
  items: readonly ConsumptionItem[];
}) {
  const published = resource.data;
  if (!published) return null;
  return (
    <>
      <Text style={styles.muted}>Últimos 7 dias</Text>
      <Refresh resource={resource} />
      {items.map((item) => (
        <Card key={item.kind}>
          <Text style={styles.subtitle}>
            {item.kind === "ENERGY"
              ? "Energia das áreas comuns"
              : "Água do condomínio"}
          </Text>
          <Text style={styles.muted}>
            Hoje · {consumptionDayLabel(published.day)}
          </Text>
          <Text style={styles.subtitle}>
            {consumptionQuantity(item.today, item.unit)}
          </Text>
          {consumptionRows(published.day, item).map((sample) => (
            <View key={sample.day} style={styles.row}>
              <Text style={styles.muted}>{consumptionDayLabel(sample.day)}</Text>
              <Text style={styles.text}>{consumptionQuantity(sample.quantity, item.unit)}</Text>
              {sample.incomplete && <Badge value="Parcial" />}
            </View>
          ))}
        </Card>
      ))}
    </>
  );
}
