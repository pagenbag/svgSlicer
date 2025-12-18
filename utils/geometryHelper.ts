import { Point, Segment } from '../types';
import * as THREE from 'three';

// Convert Three.js Shape to a set of closed loops (polygons) represented as segments
export const shapeToSegments = (shape: THREE.Shape): Segment[] => {
  const segments: Segment[] = [];
  
  // Helper to convert Path points to Segments
  const extractSegments = (points: THREE.Vector2[]) => {
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length]; // Close the loop
      segments.push({
        p1: { x: p1.x, y: p1.y },
        p2: { x: p2.x, y: p2.y },
      });
    }
  };

  extractSegments(shape.getPoints());

  // Handle holes
  if (shape.holes && shape.holes.length > 0) {
    shape.holes.forEach((holePath) => {
      extractSegments(holePath.getPoints());
    });
  }

  return segments;
};

// Calculate intersections of a horizontal line (y = constant) with polygon segments
export const getScanlineIntersections = (y: number, segments: Segment[]): number[] => {
  const intersections: number[] = [];

  for (const seg of segments) {
    const minY = Math.min(seg.p1.y, seg.p2.y);
    const maxY = Math.max(seg.p1.y, seg.p2.y);

    // Check if the scanline intersects the segment's Y range
    // We use > and <= to handle vertices efficiently (avoid double counting)
    if (y > minY && y <= maxY) {
      // Calculate X intersection
      // x = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
      const t = (y - seg.p1.y) / (seg.p2.y - seg.p1.y);
      const x = seg.p1.x + t * (seg.p2.x - seg.p1.x);
      intersections.push(x);
    }
  }

  return intersections.sort((a, b) => a - b);
};

// Calculate the volume of filament needed for a move of length L
// V = L * layerHeight * nozzleDiameter (Simplified rectangular approximation)
// E = V / (PI * (filamentRadius)^2)
export const calculateExtrusion = (
  length: number,
  layerHeight: number,
  nozzleDiameter: number,
  filamentDiameter: number
): number => {
  const filamentRadius = filamentDiameter / 2;
  const volume = length * layerHeight * nozzleDiameter;
  const filamentArea = Math.PI * Math.pow(filamentRadius, 2);
  return volume / filamentArea;
};
