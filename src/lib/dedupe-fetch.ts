// Share one in-flight GET between concurrent callers (same URL + same auth header).
// The entry is removed as soon as the request settles, so later calls always hit the network
// and never see stale data.
const inflight = new Map<string, Promise<Response>>();

export function dedupedGet(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const key = `${url}|${headers['Authorization'] || headers['authorization'] || ''}`;
  let p = inflight.get(key);
  if (!p) {
    p = fetch(url, { headers }).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, p);
  }
  return p.then((r) => r.clone());
}
