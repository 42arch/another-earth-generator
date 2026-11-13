export const packageId = '@another-earth/world-data' as const
export { loadBuiltinCatalog, loadBuiltinGenerationCatalog } from './builtins'
export { calculateContentHash, calculateContentSignature, createContentCatalog } from './catalog'
export type { ContentCatalog } from './catalog'
export type * from './schemas/content'
export { NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS } from './schemas/ecology'
export type { EcologyClassDefinition } from './schemas/ecology'
export { validateContentPack } from './validation/validate-content-pack'
