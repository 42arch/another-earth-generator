/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from '../lib/generation/protocol'
import { GenerationWorkerRuntime } from './runtime'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope
const runtime = new GenerationWorkerRuntime((message: WorkerResponse, buffers = []) => scope.postMessage(message, buffers))
scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void runtime.handle(event.data)
}
scope.postMessage({ type: 'READY' } satisfies WorkerResponse)
