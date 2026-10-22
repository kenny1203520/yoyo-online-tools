import { executeDeveloperJob, type DeveloperJob } from "../lib/developer-job";
const scope = self as unknown as { onmessage: ((event: MessageEvent<DeveloperJob>) => void) | null; postMessage: (reply: unknown) => void };
scope.onmessage = (event) => scope.postMessage(executeDeveloperJob(event.data));
scope.postMessage({ ready: true });
