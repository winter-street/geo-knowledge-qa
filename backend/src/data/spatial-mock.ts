/**
 * 全国多区域地质空间演示数据。
 *
 * 区域、矿床和地质实体名称取自公开地学常识及当前知识图谱高频实体；
 * 除少量区域中心外，坐标、卫星矿化点和构造线均为功能演示而合成，不能
 * 用于实际勘查。所有要素都带 isMock/evidence，前后端必须显式标注来源。
 */

import type { GeoPoint, GeoPolyline, SpatialData } from '../types/index.js'

type MineralKind = 'FeTi' | 'Fe' | 'CuNi' | 'CuFe' | 'Au' | 'Mo' | 'W' | 'Sn' | 'PbZn' | 'Cr' | 'REE'

interface AnchorSpec {
  name: string
  lng: number
  lat: number
  kind: MineralKind
  era: string
  depositType: string
  hostRock: string
  control: string
  satellites?: number
  owlTypes?: string[]
}

interface RockSpec {
  name: string
  lng: number
  lat: number
  rockType: string
  era: string
  samples?: number
}

interface RegionSpec {
  id: string
  name: string
  keys: string[]
  seed: number
  trendDeg: number
  spreadLng: number
  spreadLat: number
  anchors: AnchorSpec[]
  rocks: RockSpec[]
  faults: Array<{ name: string; path: Array<[number, number]> }>
}

interface TaggedPoint extends GeoPoint {
  mineralKind?: MineralKind
  searchTerms: string[]
}

interface RegionDataset {
  spec: RegionSpec
  minerals: TaggedPoint[]
  rocks: TaggedPoint[]
  faults: GeoPolyline[]
}

const KIND_LABELS: Record<MineralKind, string> = {
  FeTi: '钒钛磁铁矿',
  Fe: '铁矿',
  CuNi: '铜镍矿',
  CuFe: '铜铁矿',
  Au: '金矿',
  Mo: '钼矿',
  W: '钨矿',
  Sn: '锡矿',
  PbZn: '铅锌矿',
  Cr: '铬铁矿',
  REE: '稀土矿',
}

const KIND_TERMS: Record<MineralKind, string[]> = {
  FeTi: ['钒钛', '钒钛磁铁', '钛磁铁', '磁铁矿', '钛铁矿'],
  Fe: ['铁矿', '赤铁矿', '磁铁矿'],
  CuNi: ['铜镍', '镍矿', '镍黄铁矿', '磁黄铁矿'],
  CuFe: ['铜矿', '铜铁', '黄铜矿'],
  Au: ['金矿'],
  Mo: ['钼矿', '钼'],
  W: ['钨矿', '钨'],
  Sn: ['锡矿', '锡'],
  PbZn: ['铅锌', '铅矿', '锌矿'],
  Cr: ['铬铁矿', '铬矿'],
  REE: ['稀土', '稀土矿'],
}

const REGIONS: RegionSpec[] = [
  {
    id: 'east-tianshan', name: '东天山成矿带', keys: ['新疆', '哈密', '东天山', '觉罗塔格'],
    seed: 1101, trendDeg: 18, spreadLng: 0.075, spreadLat: 0.045,
    anchors: [
      { name: '尾亚钒钛磁铁矿', lng: 93.50, lat: 41.50, kind: 'FeTi', era: '晚二叠世', depositType: '岩浆分异型', hostRock: '辉长岩', control: '尾亚断裂带', satellites: 24 },
      { name: '香山西段铜镍矿', lng: 93.20, lat: 41.30, kind: 'CuNi', era: '二叠纪', depositType: '岩浆熔离型', hostRock: '镁铁-超镁铁岩', control: '香山西段断裂', satellites: 22 },
      { name: '黄山铜镍矿', lng: 94.50, lat: 42.00, kind: 'CuNi', era: '二叠纪', depositType: '岩浆熔离型', hostRock: '辉长岩', control: '康古尔塔格断裂带', satellites: 24 },
      { name: '康古尔金矿', lng: 93.85, lat: 42.02, kind: 'Au', era: '晚古生代', depositType: '剪切带型', hostRock: '糜棱岩', control: '康古尔塔格断裂带', satellites: 18 },
      { name: '马头滩铁矿', lng: 93.95, lat: 41.55, kind: 'Fe', era: '海西期', depositType: '矽卡岩型', hostRock: '闪长岩', control: '阿齐克库都克断裂', satellites: 16 },
    ],
    rocks: [
      { name: '尾亚辉长岩体', lng: 93.48, lat: 41.52, rockType: '辉长岩', era: '晚二叠世', samples: 12 },
      { name: '香山超镁铁岩带', lng: 93.18, lat: 41.33, rockType: '橄榄岩-辉石岩', era: '二叠纪', samples: 10 },
    ],
    faults: [
      { name: '东天山断裂带', path: [[93.05, 41.38], [93.55, 41.50], [94.05, 41.58], [94.65, 41.76]] },
      { name: '康古尔塔格断裂带', path: [[92.9, 41.88], [93.7, 42.02], [94.5, 42.18], [95.2, 42.28]] },
      { name: '尾亚断裂带', path: [[93.26, 41.34], [93.52, 41.49], [93.82, 41.61]] },
      { name: '香山西段断裂', path: [[92.92, 41.19], [93.20, 41.31], [93.51, 41.44]] },
    ],
  },
  {
    id: 'panxi', name: '攀西钒钛成矿带', keys: ['四川', '攀枝花', '攀西', '西昌', '峨眉山'],
    seed: 2202, trendDeg: -18, spreadLng: 0.055, spreadLat: 0.075,
    anchors: [
      { name: '攀枝花钒钛磁铁矿', lng: 101.72, lat: 26.56, kind: 'FeTi', era: '晚二叠世', depositType: '岩浆分异型', hostRock: '层状辉长岩', control: '攀枝花南北向断裂', satellites: 28 },
      { name: '红格钒钛磁铁矿', lng: 101.96, lat: 26.52, kind: 'FeTi', era: '晚二叠世', depositType: '岩浆分异型', hostRock: '辉长岩-辉石岩', control: '安宁河断裂带', satellites: 25 },
      { name: '白马钒钛磁铁矿', lng: 102.10, lat: 27.78, kind: 'FeTi', era: '晚二叠世', depositType: '岩浆分异型', hostRock: '层状辉长岩', control: '安宁河断裂带', satellites: 26 },
      { name: '太和钒钛磁铁矿', lng: 102.15, lat: 27.45, kind: 'FeTi', era: '晚二叠世', depositType: '岩浆分异型', hostRock: '辉长岩', control: '昔格达断裂', satellites: 22 },
      { name: '拉拉铜矿', lng: 101.98, lat: 26.20, kind: 'CuFe', era: '元古代', depositType: '火山沉积变质型', hostRock: '片岩', control: '区域剪切带', satellites: 18 },
    ],
    rocks: [
      { name: '攀枝花层状辉长岩体', lng: 101.75, lat: 26.58, rockType: '碱性辉长岩', era: '晚二叠世', samples: 14 },
      { name: '峨眉山玄武岩区', lng: 102.05, lat: 27.05, rockType: '玄武岩', era: '晚二叠世', samples: 13 },
    ],
    faults: [
      { name: '安宁河断裂带', path: [[102.02, 25.95], [102.00, 26.75], [102.10, 27.55], [102.24, 28.20]] },
      { name: '攀枝花南北向断裂', path: [[101.62, 26.22], [101.72, 26.58], [101.78, 26.95]] },
      { name: '昔格达断裂', path: [[101.88, 27.05], [102.10, 27.48], [102.28, 27.92]] },
    ],
  },
  {
    id: 'middle-lower-yangtze', name: '长江中下游成矿带', keys: ['长江中下游', '安徽', '铜陵', '庐枞', '鄂东南', '大冶'],
    seed: 3303, trendDeg: 50, spreadLng: 0.065, spreadLat: 0.045,
    anchors: [
      { name: '冬瓜山铜矿', lng: 117.82, lat: 30.91, kind: 'CuFe', era: '燕山期', depositType: '矽卡岩-斑岩型', hostRock: '石英闪长岩', control: '铜陵深断裂', satellites: 24 },
      { name: '凤凰山铜矿', lng: 118.01, lat: 30.87, kind: 'CuFe', era: '燕山期', depositType: '矽卡岩型', hostRock: '闪长岩', control: '铜陵深断裂', satellites: 20 },
      { name: '大冶铁矿', lng: 114.96, lat: 30.09, kind: 'Fe', era: '燕山期', depositType: '矽卡岩型', hostRock: '闪长岩', control: '大冶断裂', satellites: 24 },
      { name: '安庆铜铁矿', lng: 117.04, lat: 30.53, kind: 'CuFe', era: '燕山期', depositType: '矽卡岩型', hostRock: '闪长岩', control: '沿江断裂带', satellites: 20 },
      { name: '罗河铁矿', lng: 117.33, lat: 31.10, kind: 'Fe', era: '燕山期', depositType: '火山岩型', hostRock: '安山岩', control: '庐枞火山构造', satellites: 18 },
    ],
    rocks: [
      { name: '铜陵石英闪长岩体', lng: 117.86, lat: 30.95, rockType: '石英闪长岩', era: '燕山期', samples: 12 },
      { name: '庐枞火山岩盆地', lng: 117.35, lat: 31.18, rockType: '安山岩-粗面岩', era: '白垩纪', samples: 12 },
    ],
    faults: [
      { name: '长江深断裂带', path: [[114.6, 29.95], [116.1, 30.35], [117.5, 30.65], [118.4, 31.0]] },
      { name: '铜陵深断裂', path: [[117.45, 30.52], [117.82, 30.90], [118.16, 31.18]] },
      { name: '大冶断裂', path: [[114.58, 29.86], [114.95, 30.08], [115.33, 30.28]] },
    ],
  },
  {
    id: 'jiaodong', name: '胶东金成矿区', keys: ['山东', '胶东', '莱州', '招远', '烟台'],
    seed: 4404, trendDeg: 35, spreadLng: 0.052, spreadLat: 0.04,
    anchors: [
      { name: '焦家金矿', lng: 120.12, lat: 37.23, kind: 'Au', era: '燕山期', depositType: '蚀变岩型', hostRock: '花岗岩', control: '焦家断裂带', satellites: 26 },
      { name: '三山岛金矿', lng: 119.94, lat: 37.39, kind: 'Au', era: '燕山期', depositType: '破碎带蚀变岩型', hostRock: '花岗岩', control: '三山岛断裂', satellites: 24 },
      { name: '玲珑金矿', lng: 120.50, lat: 37.38, kind: 'Au', era: '燕山期', depositType: '石英脉型', hostRock: '花岗岩', control: '招平断裂带', satellites: 24 },
      { name: '新城金矿', lng: 120.05, lat: 37.18, kind: 'Au', era: '燕山期', depositType: '蚀变岩型', hostRock: '花岗岩', control: '焦家断裂带', satellites: 20 },
    ],
    rocks: [
      { name: '玲珑花岗岩体', lng: 120.55, lat: 37.35, rockType: '花岗岩', era: '侏罗纪', samples: 14 },
      { name: '郭家岭花岗闪长岩体', lng: 120.30, lat: 37.15, rockType: '花岗闪长岩', era: '白垩纪', samples: 12 },
    ],
    faults: [
      { name: '焦家断裂带', path: [[119.85, 36.98], [120.05, 37.18], [120.28, 37.40], [120.48, 37.58]] },
      { name: '招平断裂带', path: [[120.20, 36.95], [120.42, 37.26], [120.64, 37.55]] },
      { name: '三山岛断裂', path: [[119.72, 37.20], [119.96, 37.40], [120.18, 37.54]] },
    ],
  },
  {
    id: 'dian-qian-gui', name: '滇黔桂成矿区', keys: ['云南', '贵州', '广西', '滇黔桂', '个旧', '大厂'],
    seed: 5505, trendDeg: 62, spreadLng: 0.07, spreadLat: 0.05,
    anchors: [
      { name: '个旧锡矿', lng: 103.16, lat: 23.36, kind: 'Sn', era: '燕山期', depositType: '岩浆热液型', hostRock: '花岗岩-碳酸盐岩', control: '个旧断裂', satellites: 25 },
      { name: '大厂锡多金属矿', lng: 107.52, lat: 24.83, kind: 'Sn', era: '燕山期', depositType: '热液脉型', hostRock: '灰岩', control: '丹池断裂带', satellites: 24 },
      { name: '都龙锡锌矿', lng: 104.75, lat: 23.33, kind: 'PbZn', era: '燕山期', depositType: '矽卡岩型', hostRock: '大理岩-片岩', control: '都龙断裂带', satellites: 20 },
      { name: '烂泥沟金矿', lng: 105.48, lat: 25.35, kind: 'Au', era: '燕山期', depositType: '卡林型', hostRock: '泥质灰岩', control: '北东向断裂', satellites: 22 },
      { name: '金牙金矿', lng: 107.05, lat: 24.12, kind: 'Au', era: '燕山期', depositType: '微细浸染型', hostRock: '碎屑岩', control: '右江断裂系统', satellites: 18 },
    ],
    rocks: [
      { name: '个旧花岗岩体', lng: 103.20, lat: 23.30, rockType: '花岗岩', era: '燕山期', samples: 12 },
      { name: '右江盆地碳酸盐岩区', lng: 106.30, lat: 24.40, rockType: '灰岩-白云岩', era: '三叠纪', samples: 14 },
    ],
    faults: [
      { name: '个旧断裂', path: [[102.82, 23.05], [103.18, 23.38], [103.48, 23.72]] },
      { name: '丹池断裂带', path: [[106.95, 24.35], [107.52, 24.82], [108.05, 25.18]] },
      { name: '右江断裂系统', path: [[104.65, 23.35], [105.85, 24.12], [107.10, 24.78]] },
    ],
  },
  {
    id: 'qinling', name: '秦岭成矿带', keys: ['陕西', '河南', '秦岭', '小秦岭', '金堆城'],
    seed: 6606, trendDeg: 8, spreadLng: 0.065, spreadLat: 0.04,
    anchors: [
      { name: '金堆城钼矿', lng: 109.97, lat: 34.21, kind: 'Mo', era: '燕山期', depositType: '斑岩型', hostRock: '花岗斑岩', control: '华山-老牛山断裂', satellites: 25 },
      { name: '南泥湖钼矿', lng: 111.46, lat: 33.96, kind: 'Mo', era: '燕山期', depositType: '斑岩-矽卡岩型', hostRock: '花岗斑岩', control: '栾川断裂带', satellites: 22 },
      { name: '潼关金矿', lng: 110.25, lat: 34.52, kind: 'Au', era: '燕山期', depositType: '石英脉型', hostRock: '花岗片麻岩', control: '小秦岭拆离断层', satellites: 21 },
      { name: '凤县铅锌矿', lng: 106.51, lat: 33.92, kind: 'PbZn', era: '印支期', depositType: '沉积改造型', hostRock: '碳酸盐岩', control: '凤太断裂带', satellites: 20 },
    ],
    rocks: [
      { name: '金堆城花岗斑岩体', lng: 109.95, lat: 34.20, rockType: '花岗斑岩', era: '燕山期', samples: 12 },
      { name: '小秦岭太古宙变质岩群', lng: 110.30, lat: 34.45, rockType: '片麻岩', era: '太古宙', samples: 11 },
    ],
    faults: [
      { name: '秦岭主造山带', path: [[105.9, 33.65], [108.0, 33.85], [110.2, 34.10], [112.2, 34.02]] },
      { name: '华山-老牛山断裂', path: [[109.45, 33.98], [110.05, 34.22], [110.65, 34.43]] },
      { name: '凤太断裂带', path: [[105.98, 33.60], [106.55, 33.92], [107.15, 34.08]] },
    ],
  },
  {
    id: 'nanling', name: '南岭成矿带', keys: ['湖南', '江西', '广东', '南岭', '柿竹园', '瑶岗仙'],
    seed: 7707, trendDeg: 48, spreadLng: 0.06, spreadLat: 0.045,
    anchors: [
      { name: '柿竹园钨多金属矿', lng: 113.16, lat: 25.78, kind: 'W', era: '燕山期', depositType: '矽卡岩-云英岩型', hostRock: '花岗岩', control: '郴州-临武断裂', satellites: 26 },
      { name: '瑶岗仙钨矿', lng: 113.31, lat: 25.58, kind: 'W', era: '燕山期', depositType: '石英脉型', hostRock: '花岗岩', control: '瑶岗仙断裂', satellites: 22 },
      { name: '大宝山铜多金属矿', lng: 113.76, lat: 24.56, kind: 'CuFe', era: '燕山期', depositType: '矽卡岩型', hostRock: '花岗闪长岩', control: '大宝山断裂', satellites: 21 },
      { name: '德兴铜矿', lng: 117.73, lat: 29.00, kind: 'CuFe', era: '燕山期', depositType: '斑岩型', hostRock: '花岗闪长斑岩', control: '赣东北深断裂', satellites: 23 },
    ],
    rocks: [
      { name: '骑田岭花岗岩体', lng: 112.95, lat: 25.42, rockType: '花岗岩', era: '燕山期', samples: 13 },
      { name: '诸广山花岗岩体', lng: 113.55, lat: 26.20, rockType: '花岗岩', era: '燕山期', samples: 12 },
    ],
    faults: [
      { name: '南岭东西向构造带', path: [[111.8, 25.1], [113.3, 25.55], [114.8, 25.72], [116.4, 26.05]] },
      { name: '郴州-临武断裂', path: [[112.75, 24.82], [113.14, 25.55], [113.42, 26.15]] },
      { name: '赣东北深断裂', path: [[117.25, 28.55], [117.72, 29.00], [118.15, 29.40]] },
    ],
  },
  {
    id: 'tibet', name: '冈底斯-三江成矿带', keys: ['西藏', '冈底斯', '拉萨', '三江', '甲玛', '驱龙', '玉龙'],
    seed: 8808, trendDeg: 78, spreadLng: 0.075, spreadLat: 0.045,
    anchors: [
      { name: '甲玛铜多金属矿', lng: 92.27, lat: 29.70, kind: 'CuFe', era: '喜山期', depositType: '斑岩-矽卡岩型', hostRock: '花岗闪长斑岩', control: '冈底斯构造带', satellites: 24 },
      { name: '驱龙铜矿', lng: 91.72, lat: 29.67, kind: 'CuFe', era: '喜山期', depositType: '斑岩型', hostRock: '花岗斑岩', control: '东西向断裂系统', satellites: 24 },
      { name: '雄村铜金矿', lng: 88.80, lat: 29.55, kind: 'CuFe', era: '喜山期', depositType: '斑岩型', hostRock: '英安岩', control: '冈底斯弧带', satellites: 20 },
      { name: '玉龙铜矿', lng: 97.78, lat: 31.40, kind: 'CuFe', era: '喜山期', depositType: '斑岩型', hostRock: '二长花岗斑岩', control: '金沙江-红河断裂带', satellites: 22 },
    ],
    rocks: [
      { name: '冈底斯花岗岩基', lng: 91.80, lat: 29.65, rockType: '花岗闪长岩', era: '古近纪', samples: 14 },
      { name: '玉龙斑岩带', lng: 97.75, lat: 31.38, rockType: '二长花岗斑岩', era: '喜山期', samples: 12 },
    ],
    faults: [
      { name: '冈底斯构造带', path: [[87.8, 29.38], [90.2, 29.55], [92.5, 29.72], [94.8, 29.82]] },
      { name: '雅鲁藏布江缝合带', path: [[87.2, 29.10], [90.0, 29.28], [93.0, 29.22], [95.2, 29.35]] },
      { name: '金沙江-红河断裂带', path: [[96.8, 32.2], [97.8, 31.4], [98.7, 30.4]] },
    ],
  },
  {
    id: 'northeast', name: '辽吉铁金成矿区', keys: ['辽宁', '吉林', '辽吉', '鞍山', '本溪', '夹皮沟'],
    seed: 9909, trendDeg: 28, spreadLng: 0.058, spreadLat: 0.045,
    anchors: [
      { name: '鞍山式铁矿', lng: 123.00, lat: 41.12, kind: 'Fe', era: '太古宙', depositType: '沉积变质型', hostRock: '条带状铁建造', control: '鞍山古陆构造', satellites: 26 },
      { name: '本溪南芬铁矿', lng: 123.72, lat: 41.10, kind: 'Fe', era: '太古宙', depositType: '沉积变质型', hostRock: '磁铁石英岩', control: '太子河断裂', satellites: 22 },
      { name: '夹皮沟金矿', lng: 126.75, lat: 42.95, kind: 'Au', era: '燕山期', depositType: '石英脉型', hostRock: '花岗岩-绿岩带', control: '夹皮沟断裂带', satellites: 22 },
      { name: '红透山铜锌矿', lng: 124.14, lat: 42.02, kind: 'PbZn', era: '元古代', depositType: '火山成因块状硫化物型', hostRock: '变质火山岩', control: '浑河断裂带', satellites: 19 },
    ],
    rocks: [
      { name: '鞍山条带状铁建造', lng: 123.05, lat: 41.15, rockType: '磁铁石英岩', era: '太古宙', samples: 13 },
      { name: '夹皮沟花岗绿岩带', lng: 126.70, lat: 42.90, rockType: '花岗岩-绿岩', era: '太古宙', samples: 12 },
    ],
    faults: [
      { name: '郯庐断裂带东北段', path: [[122.5, 40.6], [123.4, 41.4], [124.4, 42.25], [125.2, 43.0]] },
      { name: '太子河断裂', path: [[123.05, 40.82], [123.70, 41.10], [124.25, 41.42]] },
      { name: '夹皮沟断裂带', path: [[126.35, 42.62], [126.75, 42.95], [127.18, 43.22]] },
    ],
  },
  {
    id: 'bayan-obo', name: '白云鄂博稀土成矿区', keys: ['内蒙古', '包头', '白云鄂博', '阴山'],
    seed: 10110, trendDeg: 82, spreadLng: 0.06, spreadLat: 0.04,
    anchors: [
      { name: '白云鄂博主矿', lng: 109.97, lat: 41.77, kind: 'REE', era: '中元古代', depositType: '铁-稀土-铌多金属型', hostRock: '白云岩', control: '白云鄂博断裂带', satellites: 30 },
      { name: '白云鄂博东矿', lng: 110.05, lat: 41.79, kind: 'REE', era: '中元古代', depositType: '铁-稀土-铌多金属型', hostRock: '白云岩', control: '白云鄂博断裂带', satellites: 24 },
      { name: '白云鄂博西矿', lng: 109.82, lat: 41.76, kind: 'Fe', era: '中元古代', depositType: '铁-稀土多金属型', hostRock: '白云岩', control: '东西向构造带', satellites: 20 },
    ],
    rocks: [
      { name: '白云鄂博白云岩体', lng: 109.98, lat: 41.76, rockType: '白云岩', era: '中元古代', samples: 14 },
      { name: '阴山片麻岩基底', lng: 109.70, lat: 41.45, rockType: '片麻岩', era: '太古宙', samples: 10 },
    ],
    faults: [
      { name: '白云鄂博断裂带', path: [[109.35, 41.70], [109.85, 41.76], [110.35, 41.82]] },
      { name: '阴山北缘断裂', path: [[108.9, 41.35], [109.8, 41.48], [110.7, 41.55]] },
    ],
  },
]

function createRandom(seed: number): () => number {
  let state = seed | 0
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(random: () => number): number {
  const u = 1 - random()
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function owlTypesFor(anchor: AnchorSpec): string[] {
  return Array.from(new Set([
    'RockHostedMineral',
    'AgeConstrainedMineral',
    ...(anchor.control ? ['StructurallyControlledMineral'] : []),
    ...(anchor.owlTypes || []),
  ]))
}

function buildRegion(spec: RegionSpec): RegionDataset {
  const random = createRandom(spec.seed)
  const angle = spec.trendDeg * Math.PI / 180
  const minerals: TaggedPoint[] = []
  const rocks: TaggedPoint[] = []

  for (const anchor of spec.anchors) {
    const common = {
      type: 'Mineral', region: spec.name, mineralKind: anchor.kind,
      era: anchor.era, depositType: anchor.depositType,
      owlTypes: owlTypesFor(anchor), isMock: true,
      evidence: `演示数据：以「${anchor.name}」为主题锚点，按「${anchor.control}」控矿模式合成`,
    }
    minerals.push({
      ...common, id: `mock-${spec.id}-${anchor.name}`, name: anchor.name,
      lng: anchor.lng, lat: anchor.lat, isAnchor: true,
      detail: `${spec.name}主题锚点；${anchor.depositType}，形成于${anchor.era}，赋存于${anchor.hostRock}，受${anchor.control}控制。坐标仅供功能演示。`,
      searchTerms: [anchor.name, KIND_LABELS[anchor.kind], anchor.hostRock, anchor.control, anchor.era, anchor.depositType],
    })

    const count = anchor.satellites ?? 20
    for (let index = 0; index < count; index += 1) {
      const along = gaussian(random) * spec.spreadLng
      const across = gaussian(random) * spec.spreadLat
      const lng = anchor.lng + along * Math.cos(angle) - across * Math.sin(angle)
      const lat = anchor.lat + along * Math.sin(angle) + across * Math.cos(angle)
      const level = ['矿点', '矿化点', '地球化学异常', '物探异常', '蚀变带'][Math.floor(random() * 5)]!
      minerals.push({
        ...common,
        id: `mock-${spec.id}-${anchor.kind}-${index + 1}-${anchor.name}`,
        name: `${anchor.name.slice(0, 4)}外围${KIND_LABELS[anchor.kind]}${level}${index + 1}`,
        lng: Number(lng.toFixed(5)), lat: Number(lat.toFixed(5)), isAnchor: false,
        detail: `${anchor.name}外围${level}；按区域构造走向生成，用于缓冲区、距离排序、热力图和多条件筛选演示。`,
        searchTerms: [anchor.name, KIND_LABELS[anchor.kind], anchor.hostRock, anchor.control, anchor.era, anchor.depositType, level],
      })
    }
  }

  for (const rock of spec.rocks) {
    const samples = rock.samples ?? 10
    rocks.push({
      id: `mock-${spec.id}-${rock.name}`, name: rock.name, type: 'Rock',
      lng: rock.lng, lat: rock.lat, region: spec.name, era: rock.era,
      isAnchor: true, isMock: true,
      evidence: `演示数据：依据「${rock.name}」主题生成岩体采样点`,
      detail: `${rock.rockType}主题岩体，时代为${rock.era}；坐标仅供功能演示。`,
      searchTerms: [rock.name, rock.rockType, rock.era, '岩石', '岩体'],
    })
    for (let index = 0; index < samples; index += 1) {
      rocks.push({
        id: `mock-${spec.id}-rock-${rock.name}-${index + 1}`,
        name: `${rock.name.slice(0, 5)}采样点${index + 1}`,
        type: 'Rock', region: spec.name, era: rock.era,
        lng: Number((rock.lng + gaussian(random) * spec.spreadLng * 0.65).toFixed(5)),
        lat: Number((rock.lat + gaussian(random) * spec.spreadLat * 0.65).toFixed(5)),
        isAnchor: false, isMock: true,
        evidence: `演示数据：围绕「${rock.name}」合成`,
        detail: `${rock.rockType}演示采样点，用于岩体分布与矿岩空间关联分析。`,
        searchTerms: [rock.name, rock.rockType, rock.era, '岩石', '岩体'],
      })
    }
  }

  const faults: GeoPolyline[] = spec.faults.map((fault, index) => ({
    id: `mock-${spec.id}-fault-${index + 1}`,
    type: 'Structure', label: fault.name, path: fault.path,
    region: spec.name, isMock: true,
    evidence: `演示数据：${spec.name}构造线，用于空间关系分析`,
  }))

  return { spec, minerals, rocks, faults }
}

const DATASETS = REGIONS.map(buildRegion)

function publicPoint(point: TaggedPoint): GeoPoint {
  const { searchTerms: _searchTerms, ...result } = point
  return result
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term))
}

function selectedKinds(question: string): MineralKind[] {
  let kinds = (Object.keys(KIND_TERMS) as MineralKind[])
    .filter((kind) => includesAny(question, KIND_TERMS[kind]))
  if (kinds.includes('FeTi')) {
    const remaining = question.replace(/钒钛磁铁矿|钒钛磁铁|钛磁铁矿|钛磁铁|钛铁矿/g, '')
    if (!remaining.includes('铁矿')) kinds = kinds.filter((kind) => kind !== 'Fe')
  }
  return kinds
}

function selectRegions(question: string): RegionDataset[] {
  const matched = DATASETS.filter(({ spec }) => includesAny(question, [spec.name, ...spec.keys]))
  if (matched.length) return matched
  if (includesAny(question, ['全国', '中国', '全部', '所有', '工作区', '研究区'])) return DATASETS
  return DATASETS
}

function matchesPoint(point: TaggedPoint, question: string, kinds: MineralKind[]): boolean {
  if (kinds.length && point.type === 'Mineral' && !kinds.includes(point.mineralKind!)) return false
  const hasSpecificName = point.searchTerms.some((term) =>
    term.length >= 2 && (question.includes(term) || (question.length >= 2 && term.includes(question)))
  )
  const isGenericSpatialQuestion = includesAny(question, [
    '矿产', '矿床', '矿点', '矿化', '分布', '附近', '周边', '范围', '距离',
    '断裂', '构造', '控矿', '岩石', '岩体', '年代', '形成于', '成矿带',
  ])
  return hasSpecificName || kinds.length > 0 || isGenericSpatialQuestion
}

export const FULL_FIELD: SpatialData = {
  markers: DATASETS.flatMap(({ minerals, rocks }) => [...minerals, ...rocks].map(publicPoint)),
  polylines: DATASETS.flatMap(({ faults }) => faults),
}

export const MOCK_SPATIAL_STATS = {
  regions: DATASETS.length,
  mineralAnchors: DATASETS.reduce((sum, item) => sum + item.minerals.filter((point) => point.isAnchor).length, 0),
  mineralPoints: DATASETS.reduce((sum, item) => sum + item.minerals.length, 0),
  rockPoints: DATASETS.reduce((sum, item) => sum + item.rocks.length, 0),
  structures: DATASETS.reduce((sum, item) => sum + item.faults.length, 0),
  totalFeatures: FULL_FIELD.markers.length + FULL_FIELD.polylines.length,
}

/**
 * 关键词检索演示数据。区域词优先限定区域，再按矿种、年代、成因、岩性和
 * 实体名称过滤；只有明确的全国查询才返回全量，避免普通问答渲染上千点。
 */
export function matchMockSpatial(keyword: string, requestedTypes?: string[]): SpatialData {
  const question = String(keyword).trim()
  if (!question) return { markers: [], polylines: [] }

  const explicitRegion = DATASETS.some(({ spec }) => includesAny(question, [spec.name, ...spec.keys]))
  const nationwide = includesAny(question, ['全国', '中国', '全部', '所有地区'])
  const regions = selectRegions(question)
  const kinds = selectedKinds(question)
  const wantsRocks = requestedTypes?.includes('Rock') || includesAny(question, ['岩石', '岩体', '围岩', '母岩', '辉长岩', '玄武岩', '花岗岩', '闪长岩', '片麻岩', '白云岩'])
  const wantsStructures = requestedTypes?.includes('Structure') || includesAny(question, [
    '断裂', '构造', '控矿', '断层', '剪切带', '缝合带', '造山带',
    '有利度', '找矿潜力', '成矿预测', '优选靶区', '评分',
  ])

  let points = regions.flatMap(({ minerals, rocks }) => [
    ...minerals.filter((point) => {
      if (kinds.length && !kinds.includes(point.mineralKind!)) return false
      return explicitRegion || nationwide || matchesPoint(point, question, kinds)
    }),
    ...((wantsRocks || ((explicitRegion || nationwide) && kinds.length === 0))
      ? rocks.filter((point) => explicitRegion || nationwide || matchesPoint(point, question, kinds))
      : []),
  ])

  if (!explicitRegion && !nationwide) {
    points = points.filter((point) => point.searchTerms.some((term) =>
      term.length >= 2 && (question.includes(term) || (question.length >= 2 && term.includes(question)))
    ))
  }

  const polylines = (explicitRegion || nationwide || wantsStructures)
    ? regions.flatMap(({ faults }) => faults)
    : []

  if (!points.length && !polylines.length) return { markers: [], polylines: [] }
  return { markers: points.map(publicPoint), polylines }
}

export const MOCK_SPATIAL: Record<string, SpatialData> = Object.fromEntries(
  DATASETS.map(({ spec }) => [spec.name, matchMockSpatial(spec.name)])
)
