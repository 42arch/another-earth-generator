import type { GenerationStage, PipelineEvent } from './index'
import { describe, expect, it } from 'vitest'
import { copyDependency } from './copy-dependency'
import { CircularDependencyError, DuplicateStageError, InvalidStageInputError, MissingDependencyError, PipelineCancelledError, StageExecutionError } from './errors'
import { GenerationPipeline, StageCache, StageRegistry } from './index'

interface MockConfig {
  mesh: { level: number }
  climate: { temperature: number }
  hydrology: { rain: number }
  unused?: { style: string }
}
function config(): MockConfig {
  return { mesh: { level: 2 }, climate: { temperature: 5 }, hydrology: { rain: 10 } }
}
function stage(id: string, dependencies: readonly string[], configKeys: readonly string[], calls: string[]): GenerationStage<number> {
  return {
    id,
    version: '1',
    dependencies,
    configKeys,
    execute(context) {
      calls.push(id)
      let value = 1
      for (const dependency of dependencies)
        value += context.getDependency<number>(dependency)
      for (const key of configKeys)
        value += context.getConfig(key) as number
      return value
    },
  }
}
function mockStages(calls: string[]): GenerationStage<number>[] {
  return [
    stage('mesh', [], ['mesh.level'], calls),
    stage('geology', ['mesh'], [], calls),
    stage('terrain', ['geology'], [], calls),
    stage('climate', ['terrain'], ['climate.temperature'], calls),
    stage('hydrology', ['terrain'], ['hydrology.rain'], calls),
    stage('ecology', ['climate', 'hydrology'], [], calls),
  ]
}
function input(value = config()) {
  return { seed: '42', config: value }
}

describe('stage graph and execution', () => {
  it('runs a dependency-free stage and sorts branches regardless of registration order', async () => {
    const calls: string[] = []
    const stages = mockStages(calls)
    const forward = new GenerationPipeline<MockConfig>(new StageRegistry())
    for (const item of stages) forward.registry.register(item)
    const reverse = new GenerationPipeline<MockConfig>(new StageRegistry())
    for (const item of stages.toReversed()) reverse.registry.register(item)
    const expected = ['mesh', 'geology', 'terrain', 'climate', 'hydrology', 'ecology']
    expect(forward.registry.ordered().map(item => item.id)).toEqual(expected)
    expect(reverse.registry.ordered().map(item => item.id)).toEqual(expected)
    const a = await forward.execute(input())
    const b = await reverse.execute(input())
    expect(a.getOutput<number>('ecology')).toBe(b.getOutput<number>('ecology'))
    expect(calls).toEqual([...expected, ...expected])
  })

  it('reports duplicate, missing and circular dependencies', () => {
    const calls: string[] = []
    const registry = new StageRegistry().register(stage('one', [], [], calls))
    expect(() => registry.register(stage('one', [], [], calls))).toThrow(DuplicateStageError)
    expect(() => new GenerationPipeline(new StageRegistry().register(stage('orphan', ['missing'], [], calls)))).toThrow(MissingDependencyError)
    expect(() => new GenerationPipeline(new StageRegistry().register(stage('a', ['b'], [], calls)).register(stage('b', ['a'], [], calls)))).toThrow(CircularDependencyError)
  })

  it('reuses only unaffected stages, propagates changed signatures, and honors force', async () => {
    const calls: string[] = []
    const pipeline = new GenerationPipeline<MockConfig>(new StageRegistry())
    mockStages(calls).forEach(item => pipeline.registry.register(item))
    await pipeline.execute(input())
    expect(pipeline.plan(input()).every(item => item.action === 'cache-hit')).toBe(true)
    const sameValues = { hydrology: { rain: 10 }, unused: { style: 'dark' }, climate: { temperature: 5 }, mesh: { level: 2 } }
    expect(pipeline.plan(input(sameValues)).every(item => item.action === 'cache-hit')).toBe(true)
    calls.length = 0
    await pipeline.execute(input({ ...config(), climate: { temperature: 8 } }))
    expect(calls).toEqual(['climate', 'ecology'])
    calls.length = 0
    await pipeline.execute(input({ ...config(), mesh: { level: 3 } }))
    expect(calls).toEqual(['mesh', 'geology', 'terrain', 'climate', 'hydrology', 'ecology'])
    const forced = pipeline.plan(input(), { force: ['terrain'] })
    expect(forced.filter(item => item.reason === 'forced').map(item => item.stageId)).toEqual(['terrain', 'climate', 'hydrology', 'ecology'])
    calls.length = 0
    const forcedRun = await pipeline.execute(input(), { force: ['terrain'] })
    expect(calls).toEqual(['terrain', 'climate', 'hydrology', 'ecology'])
    expect(forcedRun.plan.filter(item => item.reason === 'forced').map(item => item.stageId)).toEqual(['terrain', 'climate', 'hydrology', 'ecology'])
    pipeline.cache.clear()
    expect(pipeline.plan(input()).every(item => item.action === 'execute')).toBe(true)
  })

  it('isolates stage RNG from registration order and other stage consumption', async () => {
    const randomStage = (id: string): GenerationStage<number> => ({ id, version: '1', dependencies: [], configKeys: [], execute: ({ random }) => random.fork('region:1').nextFloat() })
    const a = new GenerationPipeline<MockConfig>(new StageRegistry().register(randomStage('z')).register(randomStage('a')))
    const b = new GenerationPipeline<MockConfig>(new StageRegistry().register(randomStage('a')).register(randomStage('z')))
    expect((await a.execute(input())).getOutput<number>('z')).toBe((await b.execute(input())).getOutput<number>('z'))
  })
})

describe('stage cache and lifecycle', () => {
  it('defaults to a 512 MiB cache budget for L8 terrain artifacts', () => {
    expect(new StageCache().maxBytes).toBe(512 * 2 ** 20)
  })

  it('invalidates versions and content domains, but ignores unrelated content', async () => {
    const make = (version: string) => ({ id: 'content', version, dependencies: [], configKeys: [], contentKeys: ['names'], execute: () => 1 }) satisfies GenerationStage<number>
    const cache = new StageCache()
    const a = new GenerationPipeline<MockConfig>(new StageRegistry().register(make('1')), cache)
    const base = { ...input(), contentSignatures: { names: 'v1', religions: 'v1' } }
    await a.execute(base)
    expect(a.plan({ ...base, contentSignatures: { names: 'v1', religions: 'v2' } })[0].action).toBe('cache-hit')
    expect(a.plan({ ...base, contentSignatures: { names: 'v2', religions: 'v1' } })[0].action).toBe('execute')
    expect(new GenerationPipeline<MockConfig>(new StageRegistry().register(make('2')), cache).plan(base)[0].action).toBe('execute')
    expect(a.plan({ ...base, seed: '100' })[0].action).toBe('execute')
    const changedRandom = new GenerationPipeline<MockConfig>(new StageRegistry().register({ ...make('1'), randomProfile: 'alea-direct-v1' }), cache)
    expect(changedRandom.plan(base)[0].action).toBe('execute')
  })

  it('does not cache failures or cancelled outputs and emits distinct lifecycle events', async () => {
    const events: PipelineEvent[] = []
    const broken = new GenerationPipeline<MockConfig>(new StageRegistry().register({ id: 'broken', version: '1', dependencies: [], configKeys: [], execute: () => {
      throw new Error('original')
    } }))
    await expect(broken.execute(input(), { onEvent: event => events.push(event) })).rejects.toMatchObject({ name: 'StageExecutionError', stageId: 'broken', cause: expect.objectContaining({ message: 'original' }) })
    expect(broken.cache.size).toBe(0)
    expect(events.map(event => event.type)).toEqual(['pipeline-started', 'stage-started', 'stage-failed'])
    const controller = new AbortController()
    const cancelled = new GenerationPipeline<MockConfig>(new StageRegistry().register({ id: 'cancel', version: '1', dependencies: [], configKeys: [], execute: async (context) => {
      context.progress(0.5)
      controller.abort()
      return 5
    } }))
    events.length = 0
    await expect(cancelled.execute(input(), { signal: controller.signal, onEvent: event => events.push(event) })).rejects.toBeInstanceOf(PipelineCancelledError)
    expect(cancelled.cache.size).toBe(0)
    expect(events.map(event => event.type)).toEqual(['pipeline-started', 'stage-started', 'stage-progress', 'pipeline-cancelled'])
    expect(events[2].stageProgress).toBe(0.5)
    expect(new StageExecutionError('x', new Error('cause')).cause).toBeInstanceOf(Error)
  })

  it('retains completed valid cache entries when a later stage is cancelled', async () => {
    const controller = new AbortController()
    const pipeline = new GenerationPipeline<MockConfig>(new StageRegistry()
      .register({ id: 'a', version: '1', dependencies: [], configKeys: [], execute: () => 7 })
      .register({ id: 'b', version: '1', dependencies: ['a'], configKeys: [], execute: () => {
        controller.abort()
        return 8
      } }))
    await expect(pipeline.execute(input(), { signal: controller.signal })).rejects.toBeInstanceOf(PipelineCancelledError)
    expect(pipeline.cache.size).toBe(1)
    expect(pipeline.plan(input()).map(item => item.action)).toEqual(['cache-hit', 'execute'])
  })

  it('rejects undeclared reads and invalid canonical config values', async () => {
    const bad = new GenerationPipeline<MockConfig>(new StageRegistry().register({ id: 'bad', version: '1', dependencies: [], configKeys: [], execute: context => context.getConfig('mesh.level') }))
    await expect(bad.execute(input())).rejects.toBeInstanceOf(InvalidStageInputError)
    const valid = new GenerationPipeline<MockConfig>(new StageRegistry().register(stage('mesh', [], ['mesh.level'], [])))
    expect(() => valid.plan(input({ ...config(), mesh: { level: Number.POSITIVE_INFINITY } }))).toThrow(InvalidStageInputError)
  })

  it('guards dependency buffers while allowing isolated native working copies', async () => {
    const source: GenerationStage<{ values: Uint8Array }> = { id: 'a', version: '1', dependencies: [], configKeys: [], execute: () => ({ values: new Uint8Array([1, 2, 3]) }) }
    const reader: GenerationStage<number> = { id: 'b', version: '1', dependencies: ['a'], configKeys: [], execute: (context) => {
      const values = context.getDependency<{ values: Uint8Array }>('a').values
      expect(values[0]).toBe(1)
      expect(() => {
        values[0] = 9
      }).toThrow(TypeError)
      expect(() => values.fill(0)).toThrow(TypeError)
      expect(() => values.buffer).toThrow(TypeError)
      expect(() => {
        values.subarray(0, 1)[0] = 8
      }).toThrow(TypeError)
      const owned = copyDependency<{ values: Uint8Array }>(context, 'a')
      expect(ArrayBuffer.isView(owned.values)).toBe(true)
      owned.values.subarray(0, 1).fill(9)
      structuredClone(owned, { transfer: [owned.values.buffer as ArrayBuffer] })
      expect(owned.values.byteLength).toBe(0)
      expect(values[0]).toBe(1)
      expect(copyDependency<{ values: Uint8Array }>(context, 'a').values).toEqual(new Uint8Array([1, 2, 3]))
      const selected = copyDependency<{ values: Uint8Array }, { first: Uint8Array, alias: Uint8Array }>(context, 'a', source => ({ first: source.values, alias: source.values }))
      expect(selected.first).toBe(selected.alias)
      selected.first[0] = 99
      expect(values[0]).toBe(1)
      structuredClone(selected, { transfer: [selected.first.buffer as ArrayBuffer] })
      expect(values[0]).toBe(1)
      expect(() => copyDependency(context, 'undeclared')).toThrow(InvalidStageInputError)
      expect(() => copyDependency<unknown, number>(context, 'undeclared', () => 1)).toThrow(InvalidStageInputError)
      return values[0]
    } }
    const pipeline = new GenerationPipeline<MockConfig>(new StageRegistry().register(source).register(reader))
    expect((await pipeline.execute(input())).getOutput<number>('b')).toBe(1)
    expect(pipeline.cache.size).toBe(2)
  })

  it('evicts least recently used large outputs and detects detached buffers', async () => {
    const cache = new StageCache(16)
    cache.put('a', new Uint8Array(10))
    cache.put('b', new Uint8Array(10))
    expect(cache.lookup('a')).toBeUndefined()
    expect(cache.lookup('b')).toBeDefined()
    expect(cache.usedBytes).toBe(10)
    const data = cache.lookup('b') as Uint8Array
    structuredClone(data, { transfer: [data.buffer as ArrayBuffer] })
    expect(cache.lookup('b')).toBeUndefined()
    expect(cache.usedBytes).toBe(0)
  })
})
