export interface PrinterSettings {
  nozzleDiameter: number; // mm
  filamentDiameter: number; // mm
  layerHeight: number; // mm
  initialLayerHeight: number; // mm
  printSpeed: number; // mm/min
  travelSpeed: number; // mm/min
  temperature: number; // Celsius
  bedTemperature: number; // Celsius
  retractionDistance: number; // mm
  retractionSpeed: number; // mm/min
  extrusionMultiplier: number;
  zOffset: number; // mm
  bedWidth: number; // mm
  bedDepth: number; // mm
}

export interface ModelSettings {
  targetHeight: number; // Total height in mm
  scale: number; // Percentage or scalar (1 = 100%)
  fillDensity: number; // 0-100 (Simplified for this app: line spacing)
  generateInfill: boolean;
}

export interface SlicerState {
  svgContent: string | null;
  gcode: string;
  isGenerating: boolean;
  prefixGCode: string;
  postfixGCode: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  p1: Point;
  p2: Point;
}