import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ActivityIndicator, Alert, AppState, Text } from "react-native";
import type { ApiClient } from "@predioon/api-client";
import type {
  AccessCommandView,
  AccessGateView,
  AccessList,
} from "@predioon/contracts";
import { parseGateQr } from "@predioon/contracts/gate-qr";
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
  colors,
  dateTime,
  ErrorMessage,
  Feedback,
  Refresh,
  styles,
} from "./ui.tsx";

/**
 * The camera lives in gate-scanner.tsx, which only the resident app imports and
 * passes down. This screen, the operations app and the tests never load it.
 */
export type GateScannerProps = { onCode(content: string): void; onCancel(): void };
export type GateScannerComponent = React.ComponentType<GateScannerProps>;

/** Someone standing at the gate waits for the controller's answer. */
const COMMAND_POLL_MS = 3_000;

type QrStep =
  | { stage: "scanning" }
  | { stage: "checking" }
  | { stage: "ready"; content: string; gate: AccessGateView }
  | { stage: "error"; message: string };

export function Access({
  api,
  scope,
  intents,
  scanner,
}: {
  api: ApiClient;
  scope: Scope;
  intents: AccessIntentStore;
  scanner?: GateScannerComponent;
}) {
  const resource = useResource<AccessList>(
    api,
    `/access?buildingId=${encodeURIComponent(scope.buildingId)}`,
  );
  const state = useSyncExternalStore(intents.subscribe, intents.getSnapshot);
  const [qr, setQr] = useState<QrStep | null>(null);
  const attempt = useRef(0);
  const qrEnabled =
    Boolean(scanner) &&
    scope.features.some(
      (feature) => feature.key === "GATE_QR_ACCESS" && feature.enabled,
    );
  const qrGate = qr?.stage === "ready" ? qr.gate : null;
  const gates = residentGates(
    resource.data?.items ?? [],
    scope.buildingId,
    scope.features,
  ).filter((gate) => gate.id !== qrGate?.id);
  useEffect(() => {
    for (const gate of resource.data?.items ?? []) {
      if (gate.buildingId === scope.buildingId && gate.latestCommand)
        intents.observe(scope.buildingId, gate.id, gate.latestCommand);
    }
  }, [resource.data, scope.buildingId, intents]);
  // A QR that was read never outlives the foreground, like the requests themselves.
  useEffect(() => {
    const listener = AppState.addEventListener("change", (next) => {
      if (next !== "active") close();
    });
    return () => {
      attempt.current++;
      listener.remove();
    };
  }, []);
  function close() {
    attempt.current++;
    setQr(null);
  }
  function scanned(content: string) {
    const current = ++attempt.current;
    if (!parseGateQr(content)) {
      setQr({ stage: "error", message: "Este QR não é de um portão do Prédio ON." });
      return;
    }
    setQr({ stage: "checking" });
    // The server checks the hour, the gate and this session before showing it.
    api
      .post<AccessGateView>("/access/qr/resolve", { content })
      .then((gate) => {
        if (current !== attempt.current) return;
        if (gate.buildingId !== scope.buildingId) {
          setQr({
            stage: "error",
            message:
              "Este portão é de outro condomínio. Toque em “Trocar”, escolha o condomínio dele e leia o QR de novo.",
          });
          return;
        }
        if (gate.latestCommand)
          intents.observe(gate.buildingId, gate.id, gate.latestCommand);
        setQr({ stage: "ready", content, gate });
      })
      .catch((cause) => {
        if (current === attempt.current)
          setQr({
            stage: "error",
            message:
              cause instanceof Error
                ? cause.message
                : "Não foi possível conferir o QR.",
          });
      });
  }
  const Scanner = scanner;
  return (
    <>
      <Text style={styles.text}>
        Confirme o portão antes de solicitar a abertura. A resposta do
        controlador não informa a posição física do portão.
      </Text>
      {qrEnabled && !qr && (
        <Button
          label="Ler QR do portão"
          onPress={() => setQr({ stage: "scanning" })}
        />
      )}
      {qr?.stage === "scanning" && Scanner && (
        <Card>
          <Text style={styles.subtitle}>Aponte para o QR do totem</Text>
          <Scanner onCode={scanned} onCancel={close} />
        </Card>
      )}
      {qr?.stage === "checking" && (
        <Card>
          <ActivityIndicator
            accessibilityLabel="Conferindo o QR"
            color={colors.green}
          />
          <Text style={styles.text}>Conferindo o QR…</Text>
        </Card>
      )}
      {qr?.stage === "error" && (
        <Card>
          <ErrorMessage message={qr.message} />
          <Button
            label="Ler novamente"
            onPress={() => setQr({ stage: "scanning" })}
          />
          <Button label="Fechar" secondary onPress={close} />
        </Card>
      )}
      {qr?.stage === "ready" && (
        <Gate
          key={`qr:${qr.gate.id}`}
          {...{ api, intents }}
          gate={qr.gate}
          intent={state[intents.key(qr.gate.buildingId, qr.gate.id)]}
          reload={resource.reload}
          qrContent={qr.content}
          onClose={close}
        />
      )}
      <Refresh resource={resource} />
      <Feedback
        resource={resource}
        empty={resource.data !== null && gates.length === 0 && !qrGate}
        emptyMessage="Nenhum portão autorizado para moradores neste condomínio."
      />
      {gates.map((gate) => (
        <Gate
          key={gate.id}
          {...{ api, gate, intents }}
          intent={state[intents.key(scope.buildingId, gate.id)]}
          reload={resource.reload}
          qrReader={qrEnabled}
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
  qrContent,
  qrReader,
  onClose,
}: {
  api: ApiClient;
  gate: AccessGateView;
  intent?: AccessIntent;
  intents: AccessIntentStore;
  reload(): void;
  /** Present when this card comes from a QR read on site. */
  qrContent?: string;
  /** Whether this app can read a QR, for the hint on gates that require one. */
  qrReader?: boolean;
  onClose?(): void;
}) {
  const alive = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const command = intent?.command ?? null;
  const waiting = command !== null && !commandSettled(command);
  const uncertain = Boolean(intent && !intent.command && !intent.pending);
  // Managers keep the list button; the database refuses anyone else anyway.
  const qrOnly = !qrContent && gate.requireQr && !gate.canManage;
  const status = useResource<AccessCommandView>(
    api,
    waiting ? `/access/commands/${encodeURIComponent(command.id)}` : null,
    COMMAND_POLL_MS,
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
  function send() {
    if (!alive.current || AppState.currentState !== "active") return;
    setError(null);
    void intents
      .submit(gate.buildingId, gate.id, (requestId) =>
        qrContent
          ? api.post<AccessCommandView>("/access/qr/open", {
              content: qrContent,
              requestId,
            })
          : api.post<AccessCommandView>(
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
  }
  function confirm() {
    // After a QR read this card is the confirmation; a resend still explains itself.
    if (qrContent && !uncertain) {
      send();
      return;
    }
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
          onPress: send,
        },
      ],
    );
  }
  return (
    <Card>
      {qrContent && <Text style={styles.muted}>QR do totem conferido</Text>}
      <Text style={styles.subtitle}>{gate.name}</Text>
      <Text style={styles.muted}>
        {gate.kind === "GARAGE" ? "Garagem" : "Pedestres"}
      </Text>
      {!gate.available && (
        <Text style={styles.text}>
          {gate.unavailableReason ?? "Acesso indisponível neste momento."}
        </Text>
      )}
      {qrOnly && (
        <Text style={styles.text}>
          {qrReader
            ? "Este portão abre pelo QR do totem. No local, toque em “Ler QR do portão”."
            : "Este portão abre pelo QR do totem, lido no app do morador."}
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
      {!qrOnly && (
        <Button
          label={
            intent?.pending
              ? "Enviando solicitação…"
              : waiting
                ? "Aguardando confirmação"
                : uncertain
                  ? "Reenviar mesma solicitação"
                  : qrContent
                    ? `Abrir ${gate.name}`
                    : "Solicitar abertura"
          }
          disabled={!gate.available || Boolean(intent?.pending) || waiting}
          onPress={confirm}
        />
      )}
      {onClose && <Button label="Fechar" secondary onPress={onClose} />}
    </Card>
  );
}
