import { BlockList, isIP } from "node:net";

/** Never accept Express's broad aliases, boolean trust or a hop count from env. */
export function parseTrustedProxyCidrs(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const invalid = () => new Error("TRUST_PROXY_CIDRS deve conter somente IPs ou CIDRs explícitos e restritos, separados por vírgula");
  if (value.length > 2048) throw invalid();
  const networks = value.split(",").map(entry => entry.trim());
  if (networks.length > 32) throw invalid();
  const canonical: string[] = [];
  for (const entry of networks) {
    const [address, prefix, extra] = entry.split("/");
    const family = address && !address.includes("%") ? isIP(address) : 0;
    if (!family || extra !== undefined) throw invalid();
    if (prefix !== undefined) {
      if (!/^[1-9]\d{0,2}$/.test(prefix)) throw invalid();
      const size = Number(prefix);
      if (size > (family === 4 ? 32 : 128)) throw invalid();
      if (family === 6 && size <= 96) {
        const subnet = new BlockList();
        subnet.addSubnet(address!, size, "ipv6");
        // A network that includes all IPv4-mapped addresses would trust every
        // IPv4 peer even though its written IPv6 prefix is not /0.
        if (subnet.check("::ffff:0.0.0.0", "ipv6")) throw invalid();
      }
    }
    // Express's IP dependency does not accept every mixed notation understood
    // by Node. Canonical IPv6 hex keeps the same address without that mismatch.
    const host = family === 6 ? new URL(`http://[${address}]/`).hostname.slice(1, -1) : address!;
    canonical.push(prefix === undefined ? host : `${host}/${prefix}`);
  }
  return [...new Set(canonical)];
}
