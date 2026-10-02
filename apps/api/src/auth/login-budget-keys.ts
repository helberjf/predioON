import { createHmac } from "node:crypto";
import { isIP } from "node:net";

function networkIdentity(value: string | null | undefined): string {
  const address = typeof value === "string" && value.length <= 64 ? value.trim() : "";
  const family = address.includes("%") ? 0 : isIP(address);
  if (family === 4) return `ipv4:${address}`;
  if (family !== 6) return "unavailable-network";

  // Node validates the address; its URL parser converts mixed notation into
  // canonical hex. Expand that validated form only to select the network bits.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split("::");
  const first = left ? left.split(":") : [], last = right ? right.split(":") : [];
  const words = right === undefined ? first : [...first, ...Array(8 - first.length - last.length).fill("0"), ...last];
  if (words.slice(0, 5).every(word => Number.parseInt(word, 16) === 0) && Number.parseInt(words[5]!, 16) === 0xffff) {
    const high = Number.parseInt(words[6]!, 16), low = Number.parseInt(words[7]!, 16);
    return `ipv4:${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
  }
  return `ipv6:${words.slice(0, 4).map(word => word.padStart(4, "0")).join(":")}::/64`;
}

/** No email or network address is persisted in the budget store. */
export function loginBudgetKeys(secret: string, email: string, address: string | null | undefined) {
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("AUTH_RATE_LIMIT_KEY precisa ter pelo menos 32 bytes");
  return {
    network: createHmac("sha256", secret).update("network\0").update(networkIdentity(address)).digest(),
    account: createHmac("sha256", secret).update("account\0").update(email.toLowerCase()).digest(),
  };
}
