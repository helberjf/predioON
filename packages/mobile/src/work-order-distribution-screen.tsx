import React, { useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, Field, styles } from "./ui.tsx";
import { distributionMessages, workOrderPriorities, type DirectorySource } from "./work-order-distribution.ts";
import type { DistributionState, WorkOrderDistributionController } from "./work-order-distribution-controller.ts";
import { workOrderPriorityLabels } from "./work-orders.ts";

/** Small inline form inside the existing building scroll host. */
export function WorkOrderDistributionScreen({ state, controller }: {
  state: DistributionState; controller: WorkOrderDistributionController;
}) {
  const [peopleSearch, setPeopleSearch] = useState("");
  const [teamsSearch, setTeamsSearch] = useState("");
  const actions = controller.captureForm();
  const disabled = state.pending || state.uncertain;
  function directory(source: DirectorySource) {
    const value = state[source], people = source === "people";
    const search = people ? peopleSearch : teamsSearch;
    const names = people ? "pessoas" : "equipes";
    if (value.state === "denied") return <Text style={styles.muted}>{people ? distributionMessages.peopleDenied : distributionMessages.teamsDenied}</Text>;
    return (
      <View style={{ gap: 8 }}>
        <Field label={people ? "Buscar pessoas" : "Buscar equipes"} value={search}
          editable={!disabled} onChangeText={people ? setPeopleSearch : setTeamsSearch} maxLength={160} />
        {value.items.filter(item => item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(item => (
          <Button key={item.id} label={`${people ? "Pessoa" : "Equipe"}: ${item.name}`} disabled={disabled}
            secondary={state.selection.kind !== (people ? "person" : "team") || !("id" in state.selection) || state.selection.id !== item.id}
            onPress={() => actions.select({ kind: people ? "person" : "team", id: item.id })} />
        ))}
        {value.state === "loading" && <Text style={styles.muted}>Carregando {names}…</Text>}
        {value.state === "ready" && value.items.length === 0 && <Text style={styles.muted}>{people ? "Nenhuma pessoa disponível." : "Nenhuma equipe disponível."}</Text>}
        {value.state === "error" && (
          <>
            <Text style={styles.muted}>{distributionMessages.directory}</Text>
            <Button secondary label={`Tentar carregar ${names}`} disabled={disabled} onPress={() => void actions.retryDirectory(source)} />
          </>
        )}
        {value.nextCursor !== null && value.state !== "error" && (
          <Button secondary label={`Carregar mais ${names}`} disabled={disabled || value.state === "loading"} onPress={() => void actions.loadMore(source)} />
        )}
      </View>
    );
  }
  return (
    <Card>
      <Text style={styles.subtitle}>{state.mode === "create" ? "Nova ordem de serviço" : `Atribuir: ${state.target?.title}`}</Text>
      {state.mode === "create" && (
        <>
          <Field label="Título" value={state.draft.title} maxLength={160} editable={!disabled} onChangeText={title => actions.setDraft({ title })} />
          <Field label="Descrição" value={state.draft.description ?? ""} multiline maxLength={4000} editable={!disabled} onChangeText={description => actions.setDraft({ description })} />
          <View style={styles.row}>
            {workOrderPriorities.map(priority => <Button key={priority} label={workOrderPriorityLabels[priority]} disabled={disabled}
              secondary={state.draft.priority !== priority} onPress={() => actions.setDraft({ priority })} />)}
          </View>
        </>
      )}
      <Text style={styles.muted}>Responsável</Text>
      <Button label="Sem responsável" secondary={state.selection.kind !== "none"} disabled={disabled} onPress={() => actions.select({ kind: "none" })} />
      {directory("people")}
      {directory("teams")}
      <View style={styles.row}>
        <Button label={state.mode === "create" ? "Criar ordem" : "Salvar responsável"} disabled={disabled} onPress={() => void actions.submit()} />
        <Button label="Voltar" secondary onPress={actions.close} />
      </View>
    </Card>
  );
}
