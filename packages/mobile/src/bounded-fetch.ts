function aborted(): Error {
  const error = new Error("A requisição foi cancelada ou excedeu o tempo de espera.");
  error.name = "AbortError";
  return error;
}

/** JSON API transport: bound headers and the entire body, without retrying requests.
 * Reading a clone buffers the finite API response while retaining the original
 * Response (including redirect/status metadata and its unread body) for the client.
 * This adapter is not intended for streaming/download endpoints.
 */
export function createBoundedFetch(
  transport: typeof globalThis.fetch,
  timeoutMs = 20_000,
): typeof globalThis.fetch {
  return async (input, init) => {
    const upstream = init && "signal" in init
      ? init.signal
      : typeof Request !== "undefined" && input instanceof Request
        ? input.signal
        : undefined;
    if (upstream?.aborted) throw aborted();
    const controller = new AbortController();
    let rejectDeadline!: (error: Error) => void;
    const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
    const cancel = () => {
      controller.abort();
      rejectDeadline(aborted());
    };
    const timer = setTimeout(cancel, timeoutMs);
    upstream?.addEventListener("abort", cancel, { once: true });
    try {
      const complete = (async () => {
        const response = await transport(input, { ...init, signal: controller.signal });
        if (controller.signal.aborted) throw aborted();
        await response.clone().text();
        if (controller.signal.aborted) throw aborted();
        return response;
      })();
      // Also settle the caller if a native transport fails to honor AbortSignal.
      return await Promise.race([complete, deadline]);
    } finally {
      clearTimeout(timer);
      upstream?.removeEventListener("abort", cancel);
    }
  };
}
