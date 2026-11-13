import {
  Activity,
  CloudRain,
  Globe,
  Layers,
  Mountain,
  Thermometer,
  Waves,
  Wind,
  Workflow,
} from '@lucide/svelte'

export const LAYER_GROUPS = [
  { label: '地形与构造', items: [{ id: 'plates', label: '运动板块', icon: Workflow }, { id: 'elevation', label: '基础高程', icon: Mountain }, { id: 'slope', label: '坡度', icon: Mountain }] },
  { label: '气候与水文', items: [{ id: 'temperature', label: '月平均气温', icon: Thermometer }, { id: 'precipitation', label: '月总降水', icon: CloudRain }, { id: 'annual-temperature', label: '年平均气温', icon: Thermometer }, { id: 'annual-precipitation', label: '年总降水', icon: CloudRain }, { id: 'koppen', label: 'Köppen 气候分类', icon: Thermometer }, { id: 'wind', label: '风场', icon: Wind }, { id: 'rivers', label: '河网', icon: Waves }, { id: 'lakes', label: '静态湖泊', icon: Waves }] },
  { label: '生态', items: [{ id: 'biomes', label: '生物群系分类', icon: Globe }, { id: 'land-cover', label: '自然覆盖（群系归并）', icon: Layers }] },
] as const

export const LAYER_ICONS = { Activity, Globe, Layers, Mountain, Thermometer, Waves, Workflow }
