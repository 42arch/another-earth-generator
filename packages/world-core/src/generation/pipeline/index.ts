import type { RandomSource } from '#math/random'
import { ALEA_VERSION, AleaRandom, MULBERRY32_VERSION, normalizeWorldSeed, RANDOM_SEED_DERIVATION_VERSION, stableHash, stageRandom } from '#math/random'
import { CircularDependencyError, DuplicateStageError, InvalidStageInputError, MissingDependencyError, PipelineCancelledError, StageExecutionError } from './errors'

export type ConfigValue = null | boolean | number | string | readonly ConfigValue[] | { readonly [key: string]: ConfigValue }

export interface StageExecutionContext {
  readonly stageId: string
  readonly worldSeed: string
  readonly random: RandomSource
  readonly signal?: AbortSignal
  getConfig: (path: string) => ConfigValue | undefined
  getContentSignature: (key: string) => string | undefined
  getDependency: <T>(id: string) => Readonly<T>
  throwIfCancelled: () => void
  progress: (fraction: number, message?: string) => void
}

/** execute owns its new output. Once returned, the pipeline/cache owns it; consumers must not mutate or transfer its buffers. */
export interface GenerationStage<TOutput = unknown> {
  readonly id: string
  readonly version: string
  readonly dependencies: readonly string[]
  readonly configKeys: readonly string[]
  readonly contentKeys?: readonly string[]
  /** Legacy direct-seed alea is reserved for preserving M0.3 Mesh output. */
  readonly randomProfile?: 'alea-direct-v1'
  readonly randomSeedConfigKey?: string
  execute: (context: StageExecutionContext) => TOutput | Promise<TOutput>
  validate?: (output: TOutput) => void
}

export interface GenerationInput<TConfig extends object> {
  readonly seed: string | number
  readonly config: Readonly<TConfig>
  readonly contentSignatures?: Readonly<{ [key: string]: string }>
}

export interface PipelineOptions {
  readonly signal?: AbortSignal
  readonly force?: boolean | readonly string[]
  readonly runId?: string
  readonly onEvent?: (event: PipelineEvent) => void
}

export interface StagePlan {
  readonly stageId: string
  readonly inputSignature: string
  readonly action: 'cache-hit' | 'execute'
  readonly reason: 'cached' | 'cache-miss' | 'forced'
}

export interface PipelineEvent {
  readonly type: 'pipeline-started' | 'stage-started' | 'stage-progress' | 'stage-completed' | 'stage-cache-hit' | 'stage-failed' | 'pipeline-completed' | 'pipeline-cancelled'
  readonly runId: string
  readonly stageId?: string
  readonly stageProgress?: number
  readonly pipelineProgress: number
  readonly durationMs?: number
  readonly message?: string
  readonly error?: { readonly name: string, readonly message: string }
}

export interface PipelineResult {
  readonly runId: string
  readonly plan: readonly StagePlan[]
  /** Borrowed, shared artifacts. Never mutate or transfer their TypedArrays while the cache may retain them. */
  getOutput: <T>(stageId: string) => T
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export class StageRegistry {
  #stages = new Map<string, GenerationStage<unknown>>()

  register<T>(stage: GenerationStage<T>): this {
    if (!stage.id.trim() || !stage.version.trim())
      throw new InvalidStageInputError(stage.id, 'Stage ID and version must be nonempty')
    if (this.#stages.has(stage.id))
      throw new DuplicateStageError(stage.id)
    for (const keys of [stage.dependencies, stage.configKeys, stage.contentKeys ?? []]) {
      if (keys.some(key => !key.trim()) || new Set(keys).size !== keys.length)
        throw new InvalidStageInputError(stage.id, 'Declared IDs and keys must be nonempty and unique')
    }
    if (stage.randomSeedConfigKey && (stage.randomProfile !== 'alea-direct-v1' || !stage.configKeys.includes(stage.randomSeedConfigKey)))
      throw new InvalidStageInputError(stage.id, 'Random seed config key must be declared')
    this.#stages.set(stage.id, stage as GenerationStage<unknown>)
    return this
  }

  get(stageId: string): GenerationStage<unknown> | undefined {
    return this.#stages.get(stageId)
  }

  ordered(): readonly GenerationStage<unknown>[] {
    const indegree = new Map<string, number>()
    const consumers = new Map<string, string[]>()
    for (const stage of this.#stages.values()) {
      indegree.set(stage.id, stage.dependencies.length)
      for (const id of stage.dependencies) {
        if (!this.#stages.has(id))
          throw new MissingDependencyError(stage.id, id)
        const list = consumers.get(id) ?? []
        list.push(stage.id)
        consumers.set(id, list)
      }
    }
    const ready = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort(compareIds)
    const ordered: GenerationStage<unknown>[] = []
    while (ready.length) {
      const id = ready.shift()!
      ordered.push(this.#stages.get(id)!)
      for (const consumer of consumers.get(id) ?? []) {
        const remaining = indegree.get(consumer)! - 1
        indegree.set(consumer, remaining)
        if (remaining === 0) {
          ready.push(consumer)
          ready.sort(compareIds)
        }
      }
    }
    if (ordered.length !== this.#stages.size)
      throw new CircularDependencyError([...indegree].filter(([, degree]) => degree > 0).map(([id]) => id).sort(compareIds))
    return ordered
  }
}

function getPath(root: object, path: string): unknown {
  let value: unknown = root
  for (const part of path.split('.')) {
    if (!part || value === null || typeof value !== 'object' || !Object.hasOwn(value, part))
      return undefined
    value = (value as { [key: string]: unknown })[part]
  }
  return value
}

/** Canonical JSON subset; rejects unsupported and nonfinite inputs before a stage can be cached. */
function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null)
    return 'null'
  if (typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('Nonfinite config value')
    return Object.is(value, -0) ? '0' : JSON.stringify(value)
  }
  if (typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer || seen.has(value))
    throw new TypeError('Config values must be acyclic JSON data')
  seen.add(value)
  let result: string
  if (Array.isArray(value)) {
    result = `[${value.map(item => canonical(item, seen)).join(',')}]`
  }
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw new TypeError('Config values must be plain objects')
    result = `{${Object.keys(value).sort(compareIds).map(key => `${JSON.stringify(key)}:${canonical((value as { [key: string]: unknown })[key], seen)}`).join(',')}}`
  }
  seen.delete(value)
  return result
}

interface CacheEntry {
  readonly output: unknown
  readonly bytes: number
  readonly buffers: readonly { readonly buffer: ArrayBuffer, readonly byteLength: number }[]
}

function measureOutput(output: unknown): { bytes: number, buffers: CacheEntry['buffers'] } {
  let bytes = 0
  const seen = new Set<object>()
  const buffers = new Map<ArrayBuffer, number>()
  const visit = (value: unknown): void => {
    if (value === null || value === undefined || typeof value === 'boolean')
      return
    if (typeof value === 'number' || typeof value === 'bigint') {
      bytes += 8
      return
    }
    if (typeof value === 'string') {
      bytes += value.length * 2
      return
    }
    if (typeof value !== 'object' || seen.has(value))
      return
    seen.add(value)
    if (ArrayBuffer.isView(value)) {
      const buffer = value.buffer
      if (buffer instanceof ArrayBuffer && !buffers.has(buffer)) {
        buffers.set(buffer, buffer.byteLength)
        bytes += buffer.byteLength
      }
    }
    else if (value instanceof ArrayBuffer) {
      if (!buffers.has(value)) {
        buffers.set(value, value.byteLength)
        bytes += value.byteLength
      }
    }
    else if (Array.isArray(value)) {
      value.forEach(visit)
    }
    else {
      Object.values(value).forEach(visit)
    }
  }
  visit(output)
  return { bytes, buffers: [...buffers].map(([buffer, byteLength]) => ({ buffer, byteLength })) }
}

/** Zero-copy runtime guard for stage dependency reads. Public result borrows still require caller discipline. */
function readOnlyBorrow<T>(value: T, views = new WeakMap<object, object>()): Readonly<T> {
  if (value === null || typeof value !== 'object')
    return value
  const existing = views.get(value)
  if (existing)
    return existing as Readonly<T>
  const reject = () => {
    throw new TypeError('Stage dependency outputs are read-only')
  }
  if (value instanceof ArrayBuffer || value instanceof DataView)
    throw new TypeError('Raw buffers are not readable stage dependencies')
  if (ArrayBuffer.isView(value)) {
    const target = value as unknown as Uint8Array
    const safeMethods = new Set<PropertyKey>(['at', 'includes', 'indexOf', 'lastIndexOf', 'join', 'slice', 'entries', 'keys', 'values', 'toString', Symbol.iterator])
    const proxy = new Proxy(target, {
      get(array, key) {
        if (key === 'buffer')
          return reject()
        if (key === 'subarray')
          return (start?: number, end?: number) => readOnlyBorrow(array.subarray(start, end), views)
        const item: unknown = Reflect.get(array, key, array)
        if (typeof item === 'function')
          return safeMethods.has(key) ? item.bind(array) : reject
        return item
      },
      set: reject,
      deleteProperty: reject,
      defineProperty: reject,
    })
    views.set(value, proxy)
    return proxy as unknown as Readonly<T>
  }
  const proxy = new Proxy(value, {
    get(target, key, receiver) {
      return readOnlyBorrow(Reflect.get(target, key, receiver), views)
    },
    set: reject,
    deleteProperty: reject,
    defineProperty: reject,
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (descriptor && 'value' in descriptor && descriptor.configurable)
        return { ...descriptor, value: readOnlyBorrow(descriptor.value, views) }
      return descriptor
    },
  })
  views.set(value, proxy)
  return proxy as Readonly<T>
}

/** Bounded LRU. Entries are shared borrows; a detached buffer is detected and discarded at lookup. */
export class StageCache {
  readonly maxBytes: number
  #entries = new Map<string, CacheEntry>()
  #usedBytes = 0

  constructor(maxBytes = 512 * 2 ** 20) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new RangeError('Cache budget must be a nonnegative safe integer')
    this.maxBytes = maxBytes
  }

  get size(): number { return this.#entries.size }
  get usedBytes(): number { return this.#usedBytes }

  clear(): void {
    this.#entries.clear()
    this.#usedBytes = 0
  }

  #remove(key: string): void {
    const entry = this.#entries.get(key)
    if (entry) {
      this.#entries.delete(key)
      this.#usedBytes -= entry.bytes
    }
  }

  lookup(key: string, touch = false): unknown | undefined {
    const entry = this.#entries.get(key)
    if (!entry)
      return undefined
    if (entry.buffers.some(({ buffer, byteLength }) => buffer.byteLength !== byteLength)) {
      this.#remove(key)
      return undefined
    }
    if (touch) {
      this.#entries.delete(key)
      this.#entries.set(key, entry)
    }
    return entry.output
  }

  put(key: string, output: unknown): void {
    const { bytes, buffers } = measureOutput(output)
    this.#remove(key)
    if (bytes > this.maxBytes)
      return
    while (this.#usedBytes + bytes > this.maxBytes) {
      const oldest = this.#entries.keys().next().value
      if (oldest === undefined)
        break
      this.#remove(oldest)
    }
    this.#entries.set(key, { output, bytes, buffers })
    this.#usedBytes += bytes
  }
}

interface InternalPlan extends StagePlan {
  readonly cacheKey: string
  readonly stage: GenerationStage<unknown>
}

export class GenerationPipeline<TConfig extends object> {
  readonly registry: StageRegistry
  readonly cache: StageCache
  #runSequence = 0

  constructor(registry: StageRegistry, cache = new StageCache()) {
    this.registry = registry
    this.cache = cache
    registry.ordered()
  }

  #plan(input: GenerationInput<TConfig>, force?: PipelineOptions['force']): InternalPlan[] {
    let worldSeed: string
    try {
      worldSeed = normalizeWorldSeed(input.seed)
    }
    catch (cause) {
      throw new InvalidStageInputError('pipeline', 'Invalid world seed', { cause })
    }
    const ordered = this.registry.ordered()
    const signatures = new Map<string, string>()
    const forced = new Set<string>()
    const plan: InternalPlan[] = []
    if (Array.isArray(force)) {
      for (const id of force) {
        if (!this.registry.get(id))
          throw new InvalidStageInputError(id, 'Unknown forced stage')
      }
    }
    for (const stage of ordered) {
      let config: string
      try {
        config = canonical(stage.configKeys.slice().sort(compareIds).map((path) => {
          const value = getPath(input.config, path)
          return value === undefined ? [path, false] : [path, true, value]
        }))
      }
      catch (cause) {
        throw new InvalidStageInputError(stage.id, 'Invalid declared config value', { cause })
      }
      const content = stage.contentKeys?.slice().sort(compareIds).map(key => [key, input.contentSignatures?.[key] ?? null]) ?? []
      const dependencies = stage.dependencies.slice().sort(compareIds).map(id => [id, signatures.get(id)])
      const randomAlgorithmVersion = stage.randomProfile === 'alea-direct-v1' ? ALEA_VERSION : MULBERRY32_VERSION
      const canonicalInput = canonical([stage.id, stage.version, worldSeed, config, content, dependencies, RANDOM_SEED_DERIVATION_VERSION, stage.randomProfile ?? 'stage-derived-v1', stage.randomSeedConfigKey ?? null, randomAlgorithmVersion])
      const inputSignature = stableHash(canonicalInput)
      const cacheKey = `${inputSignature}:${canonicalInput}`
      signatures.set(stage.id, inputSignature)
      const isForced = force === true || (Array.isArray(force) && force.includes(stage.id)) || stage.dependencies.some(id => forced.has(id))
      if (isForced)
        forced.add(stage.id)
      const cached = !isForced && this.cache.lookup(cacheKey) !== undefined
      plan.push({ stageId: stage.id, inputSignature, cacheKey, stage, action: cached ? 'cache-hit' : 'execute', reason: isForced ? 'forced' : cached ? 'cached' : 'cache-miss' })
    }
    return plan
  }

  plan(input: GenerationInput<TConfig>, options: Pick<PipelineOptions, 'force'> = {}): readonly StagePlan[] {
    return this.#plan(input, options.force).map(({ stageId, inputSignature, action, reason }) => ({ stageId, inputSignature, action, reason }))
  }

  async execute(input: GenerationInput<TConfig>, options: PipelineOptions = {}): Promise<PipelineResult> {
    const entries = this.#plan(input, options.force)
    const runId = options.runId ?? `run-${++this.#runSequence}`
    const worldSeed = normalizeWorldSeed(input.seed)
    const outputs = new Map<string, unknown>()
    const actualPlan: StagePlan[] = []
    const emit = (event: Omit<PipelineEvent, 'runId'>) => {
      try {
        options.onEvent?.({ ...event, runId })
      }
      catch {
        // Progress observers cannot change generation results or cache publication.
      }
    }
    emit({ type: 'pipeline-started', pipelineProgress: 0 })
    let currentStage: string | undefined
    let completed = 0
    try {
      for (const entry of entries) {
        currentStage = entry.stageId
        if (options.signal?.aborted)
          throw new PipelineCancelledError(currentStage, { cause: options.signal.reason })
        const stage = entry.stage
        const start = performance.now()
        if (entry.action === 'cache-hit') {
          const cached = this.cache.lookup(entry.cacheKey, true)
          if (cached !== undefined) {
            outputs.set(stage.id, cached)
            actualPlan.push({ stageId: stage.id, inputSignature: entry.inputSignature, action: 'cache-hit', reason: 'cached' })
            completed++
            emit({ type: 'stage-cache-hit', stageId: stage.id, stageProgress: 1, pipelineProgress: completed / entries.length, durationMs: performance.now() - start })
            continue
          }
        }
        emit({ type: 'stage-started', stageId: stage.id, stageProgress: 0, pipelineProgress: completed / entries.length })
        const allowedConfig = new Set(stage.configKeys)
        const allowedContent = new Set(stage.contentKeys ?? [])
        const allowedDependencies = new Set(stage.dependencies)
        let random: RandomSource
        try {
          random = stage.randomProfile === 'alea-direct-v1'
            ? new AleaRandom((getPath(input.config, stage.randomSeedConfigKey ?? '') ?? worldSeed) as string | number)
            : stageRandom(worldSeed, stage.id, stage.version)
        }
        catch (cause) {
          const error = new InvalidStageInputError(stage.id, 'Invalid random seed', { cause })
          emit({ type: 'stage-failed', stageId: stage.id, pipelineProgress: completed / entries.length, durationMs: performance.now() - start, error: { name: error.name, message: error.message } })
          throw error
        }
        const context: StageExecutionContext = {
          stageId: stage.id,
          worldSeed,
          random,
          signal: options.signal,
          getConfig(path) {
            if (!allowedConfig.has(path))
              throw new InvalidStageInputError(stage.id, `Undeclared config key ${path}`)
            return readOnlyBorrow(getPath(input.config, path) as ConfigValue | undefined)
          },
          getContentSignature(key) {
            if (!allowedContent.has(key))
              throw new InvalidStageInputError(stage.id, `Undeclared content key ${key}`)
            return input.contentSignatures?.[key]
          },
          getDependency<T>(id: string): Readonly<T> {
            if (!allowedDependencies.has(id) || !outputs.has(id))
              throw new InvalidStageInputError(stage.id, `Undeclared or unavailable dependency ${id}`)
            return readOnlyBorrow(outputs.get(id) as T)
          },
          throwIfCancelled() {
            if (options.signal?.aborted)
              throw new PipelineCancelledError(stage.id, { cause: options.signal.reason })
          },
          progress(fraction, message) {
            if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
              throw new InvalidStageInputError(stage.id, 'Progress must be in [0, 1]')
            emit({ type: 'stage-progress', stageId: stage.id, stageProgress: fraction, pipelineProgress: (completed + fraction) / entries.length, message })
          },
        }
        try {
          const output = await stage.execute(context)
          context.throwIfCancelled()
          if (output === undefined)
            throw new InvalidStageInputError(stage.id, 'Stage returned undefined')
          stage.validate?.(output)
          context.throwIfCancelled()
          outputs.set(stage.id, output)
          this.cache.put(entry.cacheKey, output)
          actualPlan.push({ stageId: stage.id, inputSignature: entry.inputSignature, action: 'execute', reason: entry.reason === 'forced' ? 'forced' : 'cache-miss' })
          completed++
          emit({ type: 'stage-completed', stageId: stage.id, stageProgress: 1, pipelineProgress: completed / entries.length, durationMs: performance.now() - start })
        }
        catch (cause) {
          if (cause instanceof PipelineCancelledError || options.signal?.aborted)
            throw cause instanceof PipelineCancelledError ? cause : new PipelineCancelledError(stage.id, { cause })
          const error = cause instanceof InvalidStageInputError ? cause : new StageExecutionError(stage.id, cause)
          emit({ type: 'stage-failed', stageId: stage.id, pipelineProgress: completed / entries.length, durationMs: performance.now() - start, error: { name: error.name, message: error.message } })
          throw error
        }
      }
      emit({ type: 'pipeline-completed', pipelineProgress: 1 })
      return {
        runId,
        plan: actualPlan,
        getOutput<T>(stageId: string): T {
          if (!outputs.has(stageId))
            throw new RangeError(`No output for stage ${stageId}`)
          return outputs.get(stageId) as T
        },
      }
    }
    catch (cause) {
      if (cause instanceof PipelineCancelledError)
        emit({ type: 'pipeline-cancelled', stageId: currentStage, pipelineProgress: entries.length ? completed / entries.length : 0, error: { name: cause.name, message: cause.message } })
      throw cause
    }
  }
}
