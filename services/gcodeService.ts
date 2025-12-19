import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader';
import { PrinterSettings, ModelSettings, FileType, Segment } from '../types';
import { shapeToSegments, getScanlineIntersections, calculateExtrusion } from '../utils/geometryHelper';
import { loadImage, getImageData, generateHatchFromImage, traceContours } from '../utils/imageHelper';

export const generateGCode = async (
  content: string, // SVG string or DataURL
  fileType: FileType,
  printerSettings: PrinterSettings,
  modelSettings: ModelSettings,
  prefix: string
): Promise<string> => {
  
  // 1. Prepare segments/paths based on file type and mode
  let segmentsToPrint: Segment[] = [];
  
  // Plotter Override: Temp 0, 1 Layer
  const actualBedTemp = modelSettings.isPlotterMode ? 0 : printerSettings.bedTemperature;
  const actualNozzleTemp = modelSettings.isPlotterMode ? 0 : printerSettings.temperature;
  const targetLayers = modelSettings.isPlotterMode ? 1 : Math.floor(modelSettings.targetHeight / printerSettings.layerHeight);
  
  const bedCenter = { x: printerSettings.bedWidth / 2, y: printerSettings.bedDepth / 2 };

  // Helper to center and scale points from Source Space to Bed Space
  // Note: SVG/Image Y is down, Printer Y is up.
  const transformToBed = (x: number, y: number, srcWidth: number, srcHeight: number) => {
      const scale = modelSettings.scale;
      // Center of source
      const cx = srcWidth / 2;
      const cy = srcHeight / 2;
      
      const dx = (x - cx) * scale;
      const dy = (y - cy) * scale;

      // Flip Y for printer coordinate system
      return {
          x: bedCenter.x + dx,
          y: bedCenter.y - dy 
      };
  };

  if (fileType === 'image') {
      const img = await loadImage(content);
      // Process Image
      // Max resolution for processing to keep it fast
      const procWidth = 512;
      const procHeight = Math.floor(procWidth * (img.height / img.width));
      const imageData = getImageData(img, procWidth, procHeight);

      if (modelSettings.isPlotterMode) {
          // Density Hashing for Shades
          // Layer 1: Dark (0-80) - Cross hatch 45/-45
          // Layer 2: Mid (80-160) - Diagonal 45
          // Layer 3: Light (160-220) - Sparse Diagonal 45
          
          const spacing = 1.5; // mm spacing between hatch lines (in source pixels roughly)
          // We need to map mm spacing to pixel spacing based on scale? 
          // It's easier to generate in pixel space and transform.
          
          // Let's assume procWidth maps to real width * scale.
          // Or simpler: Generate lines in pixel space, then transform.
          const pxSpacing = 4; // pixels

          // Dark Pass (Cross)
          const dark1 = generateHatchFromImage(imageData, 100, 45, pxSpacing, procWidth, procHeight);
          const dark2 = generateHatchFromImage(imageData, 80, -45, pxSpacing, procWidth, procHeight);
          
          // Mid Pass (Add more density to darks + cover mids)
          const mid = generateHatchFromImage(imageData, 180, 45, pxSpacing * 1.5, procWidth, procHeight);

          // Merge
          const rawSegments = [...dark1, ...dark2, ...mid];
          
          segmentsToPrint = rawSegments.map(s => ({
              p1: transformToBed(s.p1.x, s.p1.y, procWidth, procHeight),
              p2: transformToBed(s.p2.x, s.p2.y, procWidth, procHeight)
          }));

      } else {
          // Standard 3D Print from Image -> Contour Trace
          const rawSegments = traceContours(imageData, procWidth, procHeight);
           segmentsToPrint = rawSegments.map(s => ({
              p1: transformToBed(s.p1.x, s.p1.y, procWidth, procHeight),
              p2: transformToBed(s.p2.x, s.p2.y, procWidth, procHeight)
          }));
      }

  } else {
      // SVG Handling
      const loader = new SVGLoader();
      const svgData = loader.parse(content);
      
      // Calculate SVG bounds for centering
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      
      // Collect shapes
      const shapes: THREE.Shape[] = [];
      svgData.paths.forEach((path) => {
        const pathShapes = SVGLoader.createShapes(path);
        pathShapes.forEach((shape) => {
           shapes.push(shape);
           shape.getPoints().forEach(p => {
               if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x;
               if(p.y < minY) minY = p.y; if(p.y > maxY) maxY = p.y;
           });
        });
      });
      
      const svgWidth = maxX - minX;
      const svgHeight = maxY - minY;
      
      // Shift so (0,0) is center of SVG content relative to its bounds
      // The transformToBed expects inputs relative to 0..width.
      
      // Let's adjust shape points
      shapes.forEach(shape => {
          if (modelSettings.isPlotterMode) {
              // Just outlines for plotter
               const pts = shape.getPoints();
               for(let i=0; i<pts.length; i++) {
                   const p1 = pts[i];
                   const p2 = pts[(i+1)%pts.length];
                   // Adjust p relative to minX/minY to be 0-indexed
                   segmentsToPrint.push({
                       p1: transformToBed(p1.x - minX, p1.y - minY, svgWidth, svgHeight),
                       p2: transformToBed(p2.x - minX, p2.y - minY, svgWidth, svgHeight)
                   });
               }
               // Holes
               shape.holes.forEach(h => {
                   const pts = h.getPoints();
                    for(let i=0; i<pts.length; i++) {
                       const p1 = pts[i];
                       const p2 = pts[(i+1)%pts.length];
                       segmentsToPrint.push({
                           p1: transformToBed(p1.x - minX, p1.y - minY, svgWidth, svgHeight),
                           p2: transformToBed(p2.x - minX, p2.y - minY, svgWidth, svgHeight)
                       });
                   }
               });

          } else {
               // Standard Slicing handled separately
          }
      });
      
      // If SVG Standard mode, we skip the `segmentsToPrint` generic loop and use the specific slicer logic below.
      if (!modelSettings.isPlotterMode) {
           return generateSVGStandardGCode(shapes, printerSettings, modelSettings, prefix, minX, minY, maxX, maxY);
      }
  }


  // --- GENERIC GCODE GENERATION FOR SEGMENTS (Plotter / Image Trace) ---
  
  let gcode = `; Generated by React SVG Slicer (${modelSettings.isPlotterMode ? 'Plotter Mode' : 'Standard Mode'})\n`;
  gcode += `; Settings: Nozzle ${printerSettings.nozzleDiameter}mm\n\n`;
  gcode += prefix + '\n\n';
  
  // Start
  if (!modelSettings.isPlotterMode) {
     gcode += `M104 S${actualNozzleTemp}\n`;
     gcode += `M140 S${actualBedTemp}\n`;
     gcode += `M109 S${actualNozzleTemp}\n`;
     gcode += `M190 S${actualBedTemp}\n`;
  } else {
      gcode += `; Plotter Mode: Temps disabled\n`;
  }
  
  gcode += `G90\nG21\nG28\n`;
  const initialLift = modelSettings.isPlotterMode ? printerSettings.zHop + 15 : 15.0;
  gcode += `G0 Z${initialLift.toFixed(3)} F${printerSettings.travelSpeed}\n\n`;

  let currentE = 0;

  for (let layer = 0; layer < targetLayers; layer++) {
      const z = printerSettings.initialLayerHeight + (layer * printerSettings.layerHeight) + printerSettings.zOffset;
      const zLift = z + printerSettings.zHop;

      gcode += `; Layer ${layer+1}\n`;
      
      // Ensure we are at lift height before starting layer moves if plotter mode
      if (modelSettings.isPlotterMode) {
          gcode += `G0 Z${zLift.toFixed(3)} F${printerSettings.travelSpeed}\n`;
      } else {
          gcode += `G1 Z${z.toFixed(3)} F${printerSettings.travelSpeed}\n`;
      }
      
      for (const seg of segmentsToPrint) {
          
          if (modelSettings.isPlotterMode) {
             // Plotter: 
             // 1. Ensure lifted (Move to Start at Z-Hop height)
             gcode += `G0 X${seg.p1.x.toFixed(3)} Y${seg.p1.y.toFixed(3)} F${printerSettings.travelSpeed}\n`;
             // 2. Pen Down
             gcode += `G1 Z${z.toFixed(3)} F${printerSettings.travelSpeed}\n`;
             // 3. Draw
             gcode += `G1 X${seg.p2.x.toFixed(3)} Y${seg.p2.y.toFixed(3)} F${printerSettings.printSpeed}\n`;
             // 4. Pen Up (Z-Hop)
             gcode += `G0 Z${zLift.toFixed(3)} F${printerSettings.travelSpeed}\n`;
             
          } else {
             // Standard Extrusion
             // Travel to start
             gcode += `G0 X${seg.p1.x.toFixed(3)} Y${seg.p1.y.toFixed(3)} F${printerSettings.travelSpeed}\n`;
             
             const dist = Math.sqrt(Math.pow(seg.p2.x - seg.p1.x, 2) + Math.pow(seg.p2.y - seg.p1.y, 2));
             const extrude = calculateExtrusion(dist, printerSettings.layerHeight, printerSettings.nozzleDiameter, printerSettings.filamentDiameter);
             currentE += extrude * printerSettings.extrusionMultiplier;
             gcode += `G1 X${seg.p2.x.toFixed(3)} Y${seg.p2.y.toFixed(3)} E${currentE.toFixed(5)} F${printerSettings.printSpeed}\n`;
          }
      }
  }

  // End
  gcode += `\n; End\n`;
  if (!modelSettings.isPlotterMode) {
      gcode += `M104 S0\nM140 S0\n`;
  }
  gcode += `G91\nG0 Z10\nG90\nG0 X0 Y${printerSettings.bedDepth}\nM84\n`;

  return gcode;
};


// Legacy/Specific logic for SVG -> 3D Print
const generateSVGStandardGCode = async (
    shapes: THREE.Shape[], 
    printerSettings: PrinterSettings, 
    modelSettings: ModelSettings, 
    prefix: string,
    minX: number, minY: number, maxX: number, maxY: number
): Promise<string> => {
     // Re-implement the original loop but using the bounds passed in
     
     const layers = Math.floor(modelSettings.targetHeight / printerSettings.layerHeight);
     const bedCenter = { x: printerSettings.bedWidth / 2, y: printerSettings.bedDepth / 2 };
     const svgWidth = maxX - minX;
     const svgHeight = maxY - minY;

     let gcode = `; Generated by React SVG Slicer (Standard SVG)\n`;
     gcode += `; Nozzle ${printerSettings.nozzleDiameter}mm, Layer ${printerSettings.layerHeight}mm\n\n`;
     gcode += prefix + '\n';
     gcode += `M104 S${printerSettings.temperature}\nM140 S${printerSettings.bedTemperature}\n`;
     gcode += `G90\nG21\nM109 S${printerSettings.temperature}\nM190 S${printerSettings.bedTemperature}\nG28\n`;
     gcode += `G1 Z15.0 F${printerSettings.travelSpeed}\n\n`;
     
     let currentE = 0;

     // Transform for SVG Standard (Normalization + Centering)
     const transformPoint = (p: {x: number, y: number}) => {
         const nx = p.x - minX;
         const ny = p.y - minY;
         const scale = modelSettings.scale;
         const cx = svgWidth / 2;
         const cy = svgHeight / 2;
         const dx = (nx - cx) * scale;
         const dy = (ny - cy) * scale;
         return { x: bedCenter.x + dx, y: bedCenter.y - dy };
      };

      for (let layer = 0; layer < layers; layer++) {
        const z = printerSettings.initialLayerHeight + (layer * printerSettings.layerHeight) + printerSettings.zOffset;
        gcode += `; --- Layer ${layer + 1} (Z=${z.toFixed(2)}) ---\n`;
        gcode += `G1 Z${z.toFixed(3)} F${printerSettings.travelSpeed}\n`;

        for (const shape of shapes) {
            // Perimeters
            const points = shape.getPoints();
            if (points.length < 2) continue;
            const start = transformPoint(points[0]);
            gcode += `G0 X${start.x.toFixed(3)} Y${start.y.toFixed(3)} F${printerSettings.travelSpeed}\n`;
            
            for (let i = 1; i <= points.length; i++) {
                const p = points[i % points.length];
                const tp = transformPoint(p);
                const prevP = points[(i - 1) % points.length];
                const prevTp = transformPoint(prevP);
                const dist = Math.sqrt(Math.pow(tp.x - prevTp.x, 2) + Math.pow(tp.y - prevTp.y, 2));
                const extrude = calculateExtrusion(dist, printerSettings.layerHeight, printerSettings.nozzleDiameter, printerSettings.filamentDiameter);
                currentE += extrude * printerSettings.extrusionMultiplier;
                gcode += `G1 X${tp.x.toFixed(3)} Y${tp.y.toFixed(3)} E${currentE.toFixed(5)} F${printerSettings.printSpeed}\n`;
            }

            // Infill
            if (modelSettings.generateInfill) {
                const transformedPoints = points.map(transformPoint);
                const segments = [];
                for(let i=0; i<transformedPoints.length; i++) {
                    segments.push({
                        p1: transformedPoints[i],
                        p2: transformedPoints[(i+1)%transformedPoints.length]
                    });
                }
                 if (shape.holes) {
                    shape.holes.forEach(h => {
                         const hPoints = h.getPoints().map(transformPoint);
                         for(let i=0; i<hPoints.length; i++) {
                            segments.push({p1: hPoints[i], p2: hPoints[(i+1)%hPoints.length]});
                        }
                    });
                }

                let shapeMinY = Infinity;
                let shapeMaxY = -Infinity;
                transformedPoints.forEach(p => { if (p.y < shapeMinY) shapeMinY = p.y; if (p.y > shapeMaxY) shapeMaxY = p.y; });
                
                let spacing = printerSettings.nozzleDiameter;
                if (modelSettings.fillDensity < 100 && modelSettings.fillDensity > 0) {
                   spacing = printerSettings.nozzleDiameter * (100 / modelSettings.fillDensity);
                }

                for (let y = shapeMinY + spacing; y < shapeMaxY; y += spacing) {
                    const intersections = getScanlineIntersections(y, segments);
                    for (let k = 0; k < intersections.length - 1; k += 2) {
                        const x1 = intersections[k];
                        const x2 = intersections[k+1];
                        gcode += `G0 X${x1.toFixed(3)} Y${y.toFixed(3)} F${printerSettings.travelSpeed}\n`;
                        const dist = Math.abs(x2 - x1);
                        const extrude = calculateExtrusion(dist, printerSettings.layerHeight, printerSettings.nozzleDiameter, printerSettings.filamentDiameter);
                        currentE += extrude * printerSettings.extrusionMultiplier;
                        gcode += `G1 X${x2.toFixed(3)} Y${y.toFixed(3)} E${currentE.toFixed(5)} F${printerSettings.printSpeed}\n`;
                    }
                }
            }
        }
      }

      gcode += `\nM104 S0\nM140 S0\nG91\nG1 Z10\nG90\nG1 X0 Y200\nM84\n`;
      return gcode;
}