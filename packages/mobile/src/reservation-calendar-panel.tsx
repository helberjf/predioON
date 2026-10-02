import React, { useCallback } from "react";
import { Text, View } from "react-native";
import {
  reservationAvailabilityPath,
  type ApiClient,
} from "@predioon/api-client";
import {
  readReservationCalendar,
  reservationCalendarQuery,
} from "./reservation-calendar.ts";
import { useReadResource } from "./resource.ts";
import { Button, dateTime, ErrorMessage, Feedback, styles } from "./ui.tsx";

export function ReservationCalendarPanel({
  api,
  buildingId,
  areaId,
  date,
  enabled,
  revision,
}: {
  api: ApiClient;
  buildingId: string;
  areaId: string;
  date: string;
  enabled: boolean;
  revision: number;
}) {
  const query = reservationCalendarQuery(buildingId, areaId, date, enabled);
  const path = query ? reservationAvailabilityPath(query) : null;
  const read = useCallback(
    () =>
      readReservationCalendar(
        api,
        reservationCalendarQuery(buildingId, areaId, date, enabled)!,
      ),
    [api, buildingId, areaId, date, enabled],
  );
  const resource = useReadResource(
    path ? `${path}:revision=${revision}` : null,
    read,
  );
  if (!enabled) return null;
  if (!date)
    return (
      <Text style={styles.muted}>
        Escolha a data para consultar os horários ocupados.
      </Text>
    );
  if (!query)
    return (
      <ErrorMessage message="Informe uma data válida para consultar os horários." />
    );
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.subtitle}>Horários ocupados</Text>
      <Text style={styles.muted}>Data e horários deste aparelho.</Text>
      <Button
        label="Atualizar horários"
        secondary
        disabled={resource.loading}
        onPress={resource.reload}
      />
      <Feedback
        resource={resource}
        empty={
          resource.data?.authorized === true && resource.data.items.length === 0
        }
        emptyMessage="Nenhum horário ocupado nesta data."
      />
      {resource.data?.authorized === false && (
        <Text style={styles.muted}>
          Sem permissão para consultar os horários desta área.
        </Text>
      )}
      {resource.data?.authorized &&
        resource.data.items.map((interval, index) => (
          <Text
            key={`${interval.startsAt}/${interval.endsAt}/${index}`}
            style={styles.text}
          >
            {dateTime(interval.startsAt)} até {dateTime(interval.endsAt)}
          </Text>
        ))}
      <Text style={styles.muted}>
        Os horários podem mudar. A disponibilidade é verificada ao enviar a
        reserva.
      </Text>
    </View>
  );
}
