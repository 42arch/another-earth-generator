import type { GeologyArtifact, GeologyGenerationConfig, GeologyParameters, SphericalMesh, StagePlan, TerrainArtifact, TerrainGenerationConfig, WorldGenerationConfig } from '@another-earth/world-core'

export interface GenerationConfig {
  readonly seed: string
  readonly config: Omit<WorldGenerationConfig, 'planet'> & { readonly planet: WorldGenerationConfig['planet'] & { readonly seaLevelDatumKm?: number }, readonly geology?: GeologyParameters, readonly reference?: GeologyGenerationConfig['reference'], readonly terrain?: TerrainGenerationConfig['terrain'], readonly landforms?: TerrainGenerationConfig['landforms'] }
  readonly force?: boolean
}

export interface SerializedError {
  readonly name: string
  readonly message: string
  readonly stageId?: string
  readonly stack?: string
}

export type WorkerRequest
  = | { readonly type: 'GENERATE', readonly requestId: string, readonly input: GenerationConfig }
    | { readonly type: 'CANCEL', readonly requestId: string }
    | { readonly type: 'CLEAR_CACHE', readonly requestId: string }
    | { readonly type: 'PICK', readonly requestId: string, readonly position: { readonly x: number, readonly y: number, readonly z: number } }

export type WorkerResponse
  = | { readonly type: 'READY' }
    | { readonly type: 'STARTED', readonly requestId: string }
    | { readonly type: 'PROGRESS', readonly requestId: string, readonly stageId?: string, readonly stageProgress?: number, readonly pipelineProgress: number, readonly durationMs?: number, readonly status: string, readonly message?: string }
    | { readonly type: 'COMPLETED', readonly requestId: string, readonly mesh: SphericalMesh, readonly geology?: GeologyArtifact, readonly terrain?: TerrainArtifact, readonly stages?: readonly StagePlan[], readonly cacheHit: boolean, readonly cacheBytes: number, readonly pipelineMs: number, readonly copyMs: number, readonly meshBytes: number }
    | { readonly type: 'TRANSFERRED', readonly requestId: string, readonly postMessageMs: number }
    | { readonly type: 'CANCELLED', readonly requestId: string }
    | { readonly type: 'FAILED', readonly requestId: string, readonly error: SerializedError }
    | { readonly type: 'CACHE_CLEARED', readonly requestId: string }
    | { readonly type: 'PICKED', readonly requestId: string, readonly region: number }

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const stageId = 'stageId' in error && typeof error.stageId === 'string' ? error.stageId : undefined
    return { name: error.name, message: error.message, stageId, stack: error.stack }
  }
  return { name: 'Error', message: 'Generation failed' }
}
