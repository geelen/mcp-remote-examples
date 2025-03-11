import { DurableObject } from 'cloudflare:workers'
import { WorkerEntrypoint } from 'cloudflare:workers'

export class MCPEntrypoint extends DurableObject {
  static Router = class extends WorkerEntrypoint {}
}
