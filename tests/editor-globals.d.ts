// Ambient declarations for the editor's global lexical bindings (not type-checked by Playwright; for editors only).
declare const HexUtils: any, GenUtils: any, Tools: any, Brush: any, History: any, Canvas: any, Terrain: any;
declare const Roads: any, EdgeTiling: any, IO: any, UI: any, Generator: any, HexDB: any, BldDB: any, SttDB: any;
declare const ZonePainter: any, Selection: any, Clipboard: any, Stamps: any, Layers: any, Placement: any, DistanceBands: any, PaletteAccordion: any;
declare let MAP_WIDTH: number, MAP_HEIGHT: number;
declare let mapData: string[];
declare let objectsData: Record<string, string>, roadsData: Record<string, any>, tileExtras: Record<string, any>;
declare let bridgesData: any[], settlements: any[];
declare const ROW_PITCH: number, COL_PITCH: number, DEFAULT_TILE_ID: string;
declare function getCityCol(): number;
declare function getCityRow(): number;
declare function cityDistance(col: number, row: number): number;
