import { randomUUID } from "node:crypto";
import { sqlClient } from "@predioon/db";

/**
 * Since SQL051 no shipped role holds the published water level without the raw
 * readings: residents lost it and the staff roles read everything. The reduced
 * projection is still part of the API, so the suites that guard it bind their
 * reader to a role created for the run, with what a resident holds plus
 * `telemetry:read-published`.
 */
export async function createPublishedReaderRole(): Promise<string> {
  const key = `TEST_PUBLISHED_READER_${randomUUID()}`;
  await sqlClient`insert into roles(key,scope,label,system) values(${key},'BUILDING','Published reader (test fixture)',false)`;
  await sqlClient`insert into role_permissions(role_key,permission_key)
    select ${key}, permission_key from role_permissions where role_key='RESIDENT' union select ${key}, 'telemetry:read-published'`;
  return key;
}
/** Bindings to the role must be gone first; they are removed with each fixture's condominium or users. */
export async function dropPublishedReaderRole(key: string): Promise<void> {
  await sqlClient`delete from role_bindings where role_key=${key}`;
  await sqlClient`delete from roles where key=${key}`;
}
