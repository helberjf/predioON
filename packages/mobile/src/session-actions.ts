/** API token generations do not automatically guard component state from old actions. */
export function createSessionActionScope() {
  let current = 0;
  return {
    begin() { return ++current; },
    isCurrent(action: number) { return action === current; },
  };
}
