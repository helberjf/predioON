import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import type { ApiClient } from "@predioon/api-client";
import type { BuildingOverview } from "@predioon/contracts";
import type { Scope } from "./scope.ts";
import type { AlertRow, List, Reading } from "./models.ts";
import { useResource } from "./resource.ts";
import { useMutation } from "./mutation.ts";
import {
  Badge,
  Button,
  Card,
  dateTime,
  ErrorMessage,
  Feedback,
  Pages,
  Refresh,
  styles,
} from "./ui.tsx";

type Props = { api: ApiClient; buildingId: string };
export function Overview({ api, buildingId }: Props) {
  const resource = useResource<BuildingOverview>(
    api,
    `/overview/building?buildingId=${encodeURIComponent(buildingId)}`,
  );
  const data = resource.data;
  return (
    <>
      <Refresh resource={resource} />
      <Feedback resource={resource} />
      {data && (
        <>
          <Card>
            <Text style={styles.subtitle}>Situação do condomínio</Text>
            {(
              [
                [
                  "Equipamentos conectados",
                  data.counts.devices_online,
                  data.counts.devices,
                  data.coverage.devices,
                ],
                [
                  "Gateways conectados",
                  data.counts.gateways_online,
                  data.counts.gateways,
                  data.coverage.gateways,
                ],
                [
                  "Alertas em aberto",
                  data.counts.open_alerts,
                  null,
                  data.coverage.alerts,
                ],
              ] as const
            ).map(([title, value, total, coverage]) => (
              <View key={title}>
                <Text style={styles.muted}>{title}</Text>
                <Text style={styles.title}>
                  {value === null
                    ? "Indisponível"
                    : `${value}${total === null ? "" : ` / ${total}`}`}
                </Text>
                {coverage === "partial" && (
                  <Text style={styles.muted}>
                    Visão parcial conforme suas permissões.
                  </Text>
                )}
              </View>
            ))}
          </Card>
          <Text style={styles.subtitle}>Alertas recentes</Text>
          {data.latestAlerts.length === 0 && (
            <Text style={styles.muted}>Nenhum alerta no seu escopo.</Text>
          )}
          {data.latestAlerts.map((alert) => (
            <Card key={alert.id}>
              <Badge value={alert.severity} />
              <Text style={styles.text}>{alert.message}</Text>
              <Text style={styles.muted}>{dateTime(alert.triggered_at)}</Text>
            </Card>
          ))}
          <Text style={styles.subtitle}>Conectividade</Text>
          {data.gateways.map((gateway) => (
            <Card key={gateway.id}>
              <Text style={styles.subtitle}>{gateway.name}</Text>
              <Badge value={gateway.status} />
              <Text style={styles.muted}>
                {gateway.last_seen_at
                  ? `Último contato: ${dateTime(gateway.last_seen_at)}`
                  : "Sem contato registrado"}
              </Text>
            </Card>
          ))}
        </>
      )}
    </>
  );
}

export function Alerts({ api, buildingId, scope }: Props & { scope: Scope }) {
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("OPEN");
  const resource = useResource<List<AlertRow>>(
    api,
    `/alerts?buildingId=${encodeURIComponent(buildingId)}&limit=50&offset=${offset}&status=${status}`,
  );
  const mutation = useMutation();
  function transition(id: string, action: "acknowledge" | "resolve") {
    void mutation.run(
      async () => {
        await api.post(`/alerts/${encodeURIComponent(id)}/${action}`);
        resource.reload();
      },
      action === "resolve" ? "Alerta resolvido." : "Alerta reconhecido.",
    );
  }
  return (
    <>
      <View style={styles.row}>
        {[
          ["OPEN", "Abertos"],
          ["ACKNOWLEDGED", "Reconhecidos"],
          ["RESOLVED", "Resolvidos"],
        ].map(([value, title]) => (
          <Button
            key={value}
            label={title!}
            secondary={status !== value}
            onPress={() => {
              setStatus(value!);
              setOffset(0);
            }}
          />
        ))}
      </View>
      <Refresh resource={resource} />
      <Feedback
        resource={resource}
        empty={resource.data?.items.length === 0}
        emptyMessage="Nenhum alerta nesta situação."
      />
      {mutation.error && <ErrorMessage message={mutation.error} />}
      {mutation.success && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {mutation.success}
        </Text>
      )}
      {resource.data?.items.map((alert) => (
        <Card key={alert.id}>
          <View style={styles.row}>
            <Badge value={alert.severity} />
            <Badge value={alert.status} />
          </View>
          <Text style={styles.text}>{alert.message}</Text>
          <Text style={styles.muted}>{dateTime(alert.triggeredAt)}</Text>
          <View style={styles.row}>
            {alert.status === "OPEN" &&
              scope.capabilities.includes("alerts:acknowledge") && (
                <Button
                  label="Reconhecer"
                  disabled={mutation.pending}
                  onPress={() => transition(alert.id, "acknowledge")}
                />
              )}
            {alert.status !== "RESOLVED" &&
              scope.capabilities.includes("alerts:resolve") && (
                <Button
                  label="Resolver"
                  secondary
                  disabled={mutation.pending}
                  onPress={() =>
                    Alert.alert(
                      "Resolver alerta?",
                      "Confirme que a condição foi verificada pela equipe.",
                      [
                        { text: "Voltar", style: "cancel" },
                        {
                          text: "Resolver",
                          onPress: () => transition(alert.id, "resolve"),
                        },
                      ],
                    )
                  }
                />
              )}
          </View>
        </Card>
      ))}
      {resource.data && (
        <Pages
          offset={offset}
          count={resource.data.items.length}
          setOffset={setOffset}
        />
      )}
    </>
  );
}

export function Readings({ api, buildingId }: Props) {
  const resource = useResource<List<Reading>>(
    api,
    `/telemetry/latest?buildingId=${encodeURIComponent(buildingId)}`,
  );
  return (
    <>
      <Text style={styles.muted}>
        Últimas leituras autorizadas. O horário da leitura e sua qualidade
        indicam o frescor do dado.
      </Text>
      <Refresh resource={resource} />
      <Feedback
        resource={resource}
        empty={resource.data?.items.length === 0}
        emptyMessage="Nenhuma leitura recente disponível."
      />
      {resource.data?.items.map((reading) => (
        <Card key={`${reading.device_id}:${reading.metric}`}>
          <Text style={styles.subtitle}>{reading.device_name}</Text>
          <Text style={styles.muted}>{reading.metric}</Text>
          <Text style={styles.title}>
            {String(reading.numeric_value ?? reading.value)}{" "}
            {reading.unit ?? ""}
          </Text>
          <Text style={styles.muted}>
            Qualidade: {reading.quality} • {dateTime(reading.time)}
          </Text>
        </Card>
      ))}
    </>
  );
}
