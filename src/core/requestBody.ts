/**
 * The ONE cap on an untrusted request body, and the bounded reader for the
 * web-standard `Request` half of the app.
 *
 * Two runtimes serve the same public routes. The Node server takes a
 * `node:http` `IncomingMessage`, whose reader (`src/live/roomServer.ts`) has
 * socket-drain behaviour a web stream has no equivalent of — over the cap it
 * keeps reading and dropping for a bounded grace so the client can read the 413
 * before the connection closes. The Convex HTTP router (`convex/http.ts`) gets
 * a web `Request`, where `reader.cancel()` says the same thing in one call.
 *
 * So there are two readers, because there are two stream types — but ONE cap,
 * defined here, because a cap that exists twice drifts. Invariant 5: what two
 * runtimes must agree on lives in `src/core/`.
 */

/** 20 MB. Every POST route in both servers refuses a body larger than this. */
export const MAX_BODY_BYTES = 20 * 1024 * 1024;

/** The message both readers reject with, and both servers map to 413. */
export const BODY_TOO_LARGE = "body too large";

/**
 * Bytes of a web-standard `Request`, refusing past `maxBytes` without ever
 * holding more than that in memory.
 *
 * `content-length` is checked first because it lets an oversized upload be
 * refused before a byte is read — but it is a claim by the caller, so the
 * streamed size is counted too and is what actually decides.
 */
export async function readBoundedBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(BODY_TOO_LARGE);

  const body = req.body;
  if (!body) {
    // A request with no body reads as `{}`, the same as the Node reader. But a
    // request that DECLARED bytes and exposes no stream to read them from is a
    // runtime behaving in a way this reader does not model, and answering `{}`
    // there would hand the route a silent wrong answer — the caller's fields
    // would simply be missing. Say so instead.
    if (declared > 0) throw new Error("request body not readable");
    return new Uint8Array(0);
  }

  const reader = body.getReader();
  let chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        // Nothing past the cap is kept, and the read stops here: cancelling is
        // how a web stream says "stop sending", and the runtime still delivers
        // the response we return. Memory stops at `maxBytes` however much more
        // the client had queued.
        chunks = [];
        await reader.cancel().catch(() => {});
        throw new Error(BODY_TOO_LARGE);
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released by cancel() */
    }
  }

  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Same contract as the Node side's `readJson`: an empty body is `{}`. */
export async function readJsonRequest<T>(req: Request, maxBytes = MAX_BODY_BYTES): Promise<T> {
  const bytes = await readBoundedBody(req, maxBytes);
  return bytes.length ? (JSON.parse(new TextDecoder().decode(bytes)) as T) : ({} as T);
}
