import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
export async function startProductionProxy(serviceWorker?: () => string) {
  const upstream = new URL(process.env.E2E_BASE_URL || "http://127.0.0.1:3100");
  const server = createServer((req, res) => {
    if (req.url === "/sw.js" && serviceWorker) { res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" }); res.end(serviceWorker()); return; }
    const forwarded = (upstream.protocol === "https:" ? httpsRequest : httpRequest)(new URL(req.url || "/", upstream), { method: req.method, headers: { ...req.headers, host: upstream.host } }, (response) => { res.writeHead(response.statusCode || 500, response.headers); response.pipe(res); });
    forwarded.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(forwarded);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test proxy address");
  return { origin: `http://127.0.0.1:${address.port}`, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}
