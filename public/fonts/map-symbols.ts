export type MapSymbolsId =
  | "star"
  | "settlement-ring-dot"
  | "settlement-dot"
  | "settlement-capital"
  | "place-of-worship"
  | "mountain"
  | "monument"
  | "lighthouse"
  | "harbor"
  | "diamond"
  | "city"
  | "circle"
  | "castle"
  | "campsite"
  | "building";

export type MapSymbolsKey =
  | "Star"
  | "SettlementRingDot"
  | "SettlementDot"
  | "SettlementCapital"
  | "PlaceOfWorship"
  | "Mountain"
  | "Monument"
  | "Lighthouse"
  | "Harbor"
  | "Diamond"
  | "City"
  | "Circle"
  | "Castle"
  | "Campsite"
  | "Building";

export enum MapSymbols {
  Star = "star",
  SettlementRingDot = "settlement-ring-dot",
  SettlementDot = "settlement-dot",
  SettlementCapital = "settlement-capital",
  PlaceOfWorship = "place-of-worship",
  Mountain = "mountain",
  Monument = "monument",
  Lighthouse = "lighthouse",
  Harbor = "harbor",
  Diamond = "diamond",
  City = "city",
  Circle = "circle",
  Castle = "castle",
  Campsite = "campsite",
  Building = "building",
}

export const MAP_SYMBOLS_CODEPOINTS: { [key in MapSymbols]: string } = {
  [MapSymbols.Star]: "61697",
  [MapSymbols.SettlementRingDot]: "61698",
  [MapSymbols.SettlementDot]: "61699",
  [MapSymbols.SettlementCapital]: "61700",
  [MapSymbols.PlaceOfWorship]: "61701",
  [MapSymbols.Mountain]: "61702",
  [MapSymbols.Monument]: "61703",
  [MapSymbols.Lighthouse]: "61704",
  [MapSymbols.Harbor]: "61705",
  [MapSymbols.Diamond]: "61706",
  [MapSymbols.City]: "61707",
  [MapSymbols.Circle]: "61708",
  [MapSymbols.Castle]: "61709",
  [MapSymbols.Campsite]: "61710",
  [MapSymbols.Building]: "61711",
};
