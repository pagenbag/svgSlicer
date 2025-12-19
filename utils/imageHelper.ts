import { Segment, Point } from '../types';

export const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
};

export const getImageData = (img: HTMLImageElement, width: number, height: number): ImageData => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Could not get canvas context");
  
  // Draw white background then image
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  
  return ctx.getImageData(0, 0, width, height);
};

// Generates line segments based on image brightness for plotting
// Walk lines across the image; if pixel is dark enough, draw.
export const generateHatchFromImage = (
  imageData: ImageData, 
  threshold: number, // 0-255 (Pixels darker than this will be drawn)
  angleDeg: number, 
  spacing: number,
  width: number,
  height: number
): Segment[] => {
  const segments: Segment[] = [];
  const { data } = imageData;
  
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Define bounding box of rotated space to ensure we cover the whole image
  // This is a naive coverage: just scan a large enough area
  const diag = Math.sqrt(width * width + height * height);
  const start = -diag;
  const end = diag;

  for (let r = start; r < end; r += spacing) {
    let segmentStart: Point | null = null;

    // Walk along the line
    // Line eq: x*sin - y*cos + r = 0 ? No, let's use parametric.
    // A line perpendicular to the scan direction.
    // We want to scan along the line defined by distance 'r' from origin with normal angle 'angleDeg'.
    // Better parametric approach:
    // Center of rotation (width/2, height/2) usually works best, but (0,0) is easier.
    
    // Let's iterate 't' along the line.
    for (let t = -diag; t < diag; t += 1) { // Step size 1px
       // Transform (r, t) to (x, y)
       // This corresponds to rotating the grid.
       // x = r * cos(theta) - t * sin(theta) ? 
       // Standard rotation:
       // x' = x cos - y sin
       // y' = x sin + y cos
       // We scan lines of constant y' (let's say).
       
       const x = r * cos - t * sin + (width / 2); // Center offset
       const y = r * sin + t * cos + (height / 2);

       let isDark = false;
       
       // Check bounds
       if (x >= 0 && x < width && y >= 0 && y < height) {
         const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
         // Luminance
         const lum = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
         if (lum < threshold) {
            isDark = true;
         }
       }

       if (isDark) {
         if (!segmentStart) {
           segmentStart = { x, y };
         }
       } else {
         if (segmentStart) {
           segments.push({ p1: segmentStart, p2: { x, y } }); // End at previous valid point effectively
           segmentStart = null;
         }
       }
    }
    // End of line
    if (segmentStart) {
       // Clip to edge if needed, but the bounds check above handles 'isDark' becoming false at edge
       // If we ended loop while dark, close it.
       // However, loop goes beyond diag, so x/y will go out of bounds, isDark becomes false, segment closes.
    }
  }

  return segments;
};

// Simple Square Tracing for finding a single contour at 50% threshold
// Returns a list of segments representing the perimeter
export const traceContours = (imageData: ImageData, width: number, height: number): Segment[] => {
    const segments: Segment[] = [];
    // Threshold map
    const grid: boolean[][] = [];
    for(let y=0; y<height; y++) {
        const row: boolean[] = [];
        for(let x=0; x<width; x++) {
            const idx = (y * width + x) * 4;
            const avg = (imageData.data[idx] + imageData.data[idx+1] + imageData.data[idx+2]) / 3;
            row.push(avg < 128); // True if Dark (Solid)
        }
        grid.push(row);
    }

    // Horizontal edges
    for(let y=0; y<height-1; y++) {
        for(let x=0; x<width; x++) {
            if(grid[y][x] !== grid[y+1][x]) {
                segments.push({
                    p1: { x: x, y: y+1 },
                    p2: { x: x+1, y: y+1 }
                });
            }
        }
    }
    // Vertical edges
    for(let x=0; x<width-1; x++) {
        for(let y=0; y<height; y++) {
            if(grid[y][x] !== grid[y][x+1]) {
                segments.push({
                    p1: { x: x+1, y: y },
                    p2: { x: x+1, y: y+1 }
                });
            }
        }
    }

    // Optimize: Join segments (Greedy)
    // This simple implementation produces disjoint segments which is fine for visual 
    // but GCode generation works better with ordered paths. 
    // The main GCode generator logic handles segments for infill, but for perimeters it expects shapes.
    // However, our generator handles segments for infill logic but perimeters logic uses THREE.Shape.
    // For Raster->Standard Mode, we'll return raw segments and treat them as "walls" (G1 moves) directly 
    // rather than trying to reconstruct complex THREE.Shapes.
    
    return segments;
}