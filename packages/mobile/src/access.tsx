import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Alert, AppState, Text } from "react-native";
import type { ApiClient } from "@predioon/api-client";
import type {
  AccessCommandView,
  AccessGateView,
  AccessList,
} from "@predioon/contracts";
import type { Scope } from "./scope.ts";
import {
  commandMessage,
  commandSettled,
  type AccessIntent,
  type AccessIntentStore,
} from "./access-intents.ts";
import { residentGates } from "./resident-services.ts";
import { useResource } from "./resource.ts";
import {
  Button,
  Card,
  dateTime,
  ErrorMessage,
  Feedback,
  Refresh,
  styles,
} from "./ui.tsx";

export function Access({
  api,
  scope,
  intents,
}: {
  api: ApiClient;
  scope: Scope;
  intents: AccessIntentStore;
}) {
  const resource = useResource<AccessList>(
    api,
    `/access?buildingId=${encodeURIComponent(scope.buildingId)}`,
  );
  const state = useSyncExternalStore(intents.subscribe, intents.getSnapshot);
  const gates = residentGates(
    resource.data?.items ?? [],
    scope.buildingId,
    scope.features,
  );
  useEffect(() => {
    for (const gate of resource.data?.items ?? []) {
      if (gate.buildingId === scope.buildingId && gate.latestCommand)
        intents.observe(scope.buildingId, gate.id, gate.latestCommand);
    }
  }, [resource.data, scope.buildingId, intents]);
  return (
    <>
      <Text style={styles.text}>
        Confirme o portão antes de solicitar a abertura. A resposta do
        controlador não informa a posição física do portão.
      </Text>
      <Refresh resource={resource} />
      <Feedback
        resource={resource}
        empty={resource.data !== null && gates.length === 0}
        emptyMessage="Nenhum portão autorizado para moradores neste condomínio."
      />
      {gates.map((gate) => (
        <Gate
          key={gate.id}
          {...{ api, gate, intents }}
          intent={state[intents.key(scope.buildingId, gate.id)]}
          reload={resource.reload}
        />
      ))}
    </>
  );
}

function Gate({
  api,
  gate,
  intent,
  intents,
  reload,
}: {
  api: ApiClient;
  gate: AccessGateView;
  intent?: AccessIntent;
  intents: AccessIntentStore;
  reload(): void;
}) {
  const alive = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const command = intent?.command ?? null;
  const waiting = command !== null && !commandSettled(command);
  const uncertain = Boolean(intent && !intent.command && !intent.pending);
  const status = useResource<AccessCommandView>(
    api,
    waiting ? `/access/commands/${encodeURIComponent(command.id)}` : null,
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (status.data) intents.observe(gate.buildingId, gate.id, status.data);
  }, [status.data, gate.buildingId, gate.id, intents]);
  function confirm() {
    Alert.alert(
      uncertain
        ? `Reenviar solicitação para ${gate.name}?`
        : `Solicitar abertura de ${gate.name}?`,
      uncertain
        ? "A resposta anterior não foi confirmada. Será usada a mesma identificação: se a API já recebeu, apenas consultará o resultado; se não recebeu, poderá enviar a abertura agora. Confirme somente se ainda deseja abrir."
        : "A solicitação será enviada agora. Verifique o local antes de confirmar.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: uncertain ? "Confirmar reenvio" : "Solicitar abertura",
          onPress: () => {
            if (!alive.current || AppState.currentState !== "active") return;
            setError(null);
            void intents
              .submit(gate.buildingId, gate.id, (requestId) =>
                api.post<AccessCommandView>(
                  `/access/${encodeURIComponent(gate.id)}/open`,
                  { requestId },
                ),
              )
              .then(() => {
                if (alive.current) reload();
              })
              .catch((cause) => {
                if (alive.current)
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Não foi possível gerar a solicitação segura.",
                  );
              });
          },
        },
      ],
    );
  }
  return (
    <Card>
      <Text style={styles.subtitle}>{gate.name}</Text>
      <Text style={styles.muted}>
        {gate.kind === "GARAGE" ? "Garagem" : "Pedestres"}
      </Text>
      {!gate.available && (
        <Text style={styles.text}>
          {gate.unavailableReason ?? "Acesso indisponível neste momento."}
        </Text>
      )}
      {command && (
        <>
          <Text accessibilityLiveRegion="polite" style={styles.text}>
            {commandMessage(command)}
          </Text>
          <Text style={styles.muted}>
            Solicitação de {dateTime(command.createdAt)}
          </Text>
          {command.failureReason && (
            <Text style={styles.muted}>{command.failureReason}</Text>
          )}
        </>
      )}
      {waiting && (
        <>
          <Text style={styles.muted}>
            A consulta atualiza o resultado sem enviar outro comando.
          </Text>
          <Refresh resource={status} />
          <Feedback resource={status} />
        </>
      )}
      {uncertain && (
        <Text style={styles.text}>
          Resposta não confirmada. Atualize a lista para consultar antes de
          decidir pelo reenvio da mesma solicitação.
        </Text>
      )}
      {intent?.error && <ErrorMessage message={intent.error} />}
      {error && <ErrorMessage message={error} />}
      <Button
        label={
          intent?.pending
            ? "Enviando solicitação…"
            : waiting
              ? "Aguardando confirmação"
              : uncertain
                ? "Reenviar mesma solicitação"
                : "Solicitar abertura"
        }
        disabled={!gate.available || Boolean(intent?.pending) || waiting}
        onPress={confirm}
      />
    </Card>
  );
}
