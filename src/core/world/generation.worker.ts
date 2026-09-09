import type { GenerationRequest, GenerationResponse } from '@/core/world/generation-protocol'
import { snapshotMesh } from '@/core/world/generation-protocol'
import { GenerationRuntime } from '@/core/world/generation-runtime'

const runtime = new GenerationRuntime()
// Keep DOM and worker library declarations separate without widening global types.
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<GenerationRequest>) => void
  postMessage: (message: GenerationResponse) => void
}

scope.onmessage = ({ data: request }) => {
  try {
    const result = runtime.run(request.params, request.stage, stage =>
      scope.postMessage({ type: 'progress', id: request.id, stage }))
    scope.postMessage({
      type: 'result',
      id: request.id,
      mesh: request.meshRevision === result.revision ? undefined : snapshotMesh(result.mesh),
      meshRevision: result.revision,
      data: result.data,
      stage: result.stage,
      timings: result.timings,
    })
  }
  catch (error) {
    scope.postMessage({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : '世界生成失败。',
    })
  }
}
