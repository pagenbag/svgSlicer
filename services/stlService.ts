import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter';
import { ModelSettings } from '../types';

export const generateSTL = (svgContent: string, settings: ModelSettings): Blob => {
  const loader = new SVGLoader();
  const data = loader.parse(svgContent);
  const shapes: THREE.Shape[] = [];

  // flatMap paths to shapes
  data.paths.forEach((path) => {
    // SVGLoader.createShapes handles holes automatically if path directions are correct
    const pathShapes = SVGLoader.createShapes(path);
    pathShapes.forEach((s) => shapes.push(s));
  });

  if (shapes.length === 0) {
    throw new Error("No valid shapes found in SVG to generate STL.");
  }

  // Create 3D Geometry from Shapes
  // Depth corresponds to target height
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: settings.targetHeight,
    bevelEnabled: false,
    steps: 1
  });

  // Center the geometry
  geometry.computeBoundingBox();
  if (geometry.boundingBox) {
      const center = new THREE.Vector3();
      geometry.boundingBox.getCenter(center);
      // Move center to (0,0,0) - Z is usually 0 to height, centering Z puts it at -h/2 to h/2
      // Let's center XY, but keep Z base at 0? 
      // Standard STL usually sits on the bed (Z=0).
      // geometry.boundingBox.min.z is usually 0 if extruding forward.
      geometry.translate(-center.x, -center.y, -geometry.boundingBox.min.z);
  }

  // Apply Scale
  // Note: settings.scale is XY scale. 
  // Should we scale Z? Usually 'targetHeight' is explicit, so we don't scale Z by the XY scale factor.
  geometry.scale(settings.scale, settings.scale, 1);

  // Flip Y (SVG is Y-down, 3D is Y-up)
  // Scaling by -1 mirrors it. To fix normals we might need to be careful, but STLExporter usually handles the triangle output.
  // However, scaling by -1 inverts winding order.
  geometry.scale(1, -1, 1);

  // Create a mesh to pass to exporter
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  
  // Ensure matrices are updated
  mesh.updateMatrixWorld();

  const exporter = new STLExporter();
  // parse returns DataView (binary) or string (ascii)
  const result = exporter.parse(mesh, { binary: true });
  
  return new Blob([result], { type: 'application/octet-stream' });
};