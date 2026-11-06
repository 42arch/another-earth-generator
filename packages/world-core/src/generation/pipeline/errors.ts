export class DuplicateStageError extends Error {
  readonly stageId: string
  constructor(stageId: string) {
    super(`Duplicate generation stage: ${stageId}`)
    this.name = 'DuplicateStageError'
    this.stageId = stageId
  }
}

export class MissingDependencyError extends Error {
  readonly stageId: string
  readonly dependencyId: string
  constructor(stageId: string, dependencyId: string) {
    super(`Stage ${stageId} requires missing stage ${dependencyId}`)
    this.name = 'MissingDependencyError'
    this.stageId = stageId
    this.dependencyId = dependencyId
  }
}

export class CircularDependencyError extends Error {
  readonly stageIds: readonly string[]
  constructor(stageIds: readonly string[]) {
    super(`Circular generation dependencies: ${stageIds.join(', ')}`)
    this.name = 'CircularDependencyError'
    this.stageIds = stageIds
  }
}

export class InvalidStageInputError extends Error {
  readonly stageId: string
  constructor(stageId: string, message: string, options?: ErrorOptions) {
    super(`Invalid input for ${stageId}: ${message}`, options)
    this.name = 'InvalidStageInputError'
    this.stageId = stageId
  }
}

export class StageExecutionError extends Error {
  readonly stageId: string
  constructor(stageId: string, cause: unknown) {
    super(`Generation stage ${stageId} failed`, { cause })
    this.name = 'StageExecutionError'
    this.stageId = stageId
  }
}

export class PipelineCancelledError extends Error {
  readonly stageId?: string
  constructor(stageId?: string, options?: ErrorOptions) {
    super(`Generation pipeline cancelled${stageId ? ` during ${stageId}` : ''}`, options)
    this.name = 'PipelineCancelledError'
    this.stageId = stageId
  }
}
