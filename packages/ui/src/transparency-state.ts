/** Creation is a building-wide operation. Existing report mutations must pass
 * this same conjunction against authorization for that selected report. */
export function transparencyPermissions(capabilities: readonly string[] | null | undefined) {
  const has = (capability: string) => capabilities?.includes(capability) === true;
  return {
    readDrafts: has("finance:read"),
    manageReports: has("finance:read") && has("finance:manage"),
    manageUpdates: has("notices:read") && has("notices:manage"),
  };
}
