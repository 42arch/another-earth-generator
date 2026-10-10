export type MakiId
  = | 'star'
    | 'place-of-worship'
    | 'mountain'
    | 'monument'
    | 'lighthouse'
    | 'harbor'
    | 'diamond'
    | 'city'
    | 'circle'
    | 'castle'
    | 'campsite'
    | 'building'

export type MakiKey
  = | 'Star'
    | 'PlaceOfWorship'
    | 'Mountain'
    | 'Monument'
    | 'Lighthouse'
    | 'Harbor'
    | 'Diamond'
    | 'City'
    | 'Circle'
    | 'Castle'
    | 'Campsite'
    | 'Building'

export enum Maki {
  Star = 'star',
  PlaceOfWorship = 'place-of-worship',
  Mountain = 'mountain',
  Monument = 'monument',
  Lighthouse = 'lighthouse',
  Harbor = 'harbor',
  Diamond = 'diamond',
  City = 'city',
  Circle = 'circle',
  Castle = 'castle',
  Campsite = 'campsite',
  Building = 'building',
}

export const MAKI_CODEPOINTS: { [key in Maki]: string } = {
  [Maki.Star]: '61697',
  [Maki.PlaceOfWorship]: '61698',
  [Maki.Mountain]: '61699',
  [Maki.Monument]: '61700',
  [Maki.Lighthouse]: '61701',
  [Maki.Harbor]: '61702',
  [Maki.Diamond]: '61703',
  [Maki.City]: '61704',
  [Maki.Circle]: '61705',
  [Maki.Castle]: '61706',
  [Maki.Campsite]: '61707',
  [Maki.Building]: '61708',
}
