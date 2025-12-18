import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Center, Grid } from '@react-three/drei';
import * as THREE from 'three';

interface GCodeViewerProps {
  gcode: string;
}

const GCodeVisualization: React.FC<{ gcode: string }> = ({ gcode }) => {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(110, -100, 150);
    camera.lookAt(110, 110, 0);
  }, [camera]);

  const geometry = useMemo(() => {
    if (!gcode) return null;

    const lines: number[] = [];
    const colors: number[] = [];
    
    // Simple state machine for the parser
    let x = 0, y = 0, z = 0;
    // Current positions
    let cx = 0, cy = 0, cz = 0;
    
    const splitLines = gcode.split('\n');
    
    // Reusable objects
    const colorExtrude = new THREE.Color('#ef4444'); // Red for extrusion
    const colorTravel = new THREE.Color('#3b82f6'); // Blue for travel
    const colorRetract = new THREE.Color('#10b981'); // Green for retract (not strictly visualized separately here but logic could expand)

    for (const line of splitLines) {
      const parts = line.split(';')[0].trim().toUpperCase().split(' ');
      if (parts.length === 0 || parts[0] === '') continue;

      const cmd = parts[0];
      
      if (cmd === 'G0' || cmd === 'G1') {
        let isExtruding = false;
        let hasMove = false;

        // Parse params
        for (let i = 1; i < parts.length; i++) {
          const p = parts[i];
          const val = parseFloat(p.substring(1));
          if (isNaN(val)) continue;

          switch (p[0]) {
            case 'X': x = val; hasMove = true; break;
            case 'Y': y = val; hasMove = true; break;
            case 'Z': z = val; hasMove = true; break;
            case 'E': 
              // Usually if E increases, it's extrusion. 
              // We aren't tracking relative/absolute E perfectly here for preview, 
              // assuming presence of E param with move = extrusion for visualization simplicity.
              // A robust parser tracks G90/G91 and E state. 
              // For this generator, we output absolute E, so if E changes, it's extruding.
              isExtruding = true; 
              break;
          }
        }

        if (hasMove) {
          lines.push(cx, cy, cz);
          lines.push(x, y, z);
          
          // Color
          if (isExtruding && cmd === 'G1') {
             colors.push(colorExtrude.r, colorExtrude.g, colorExtrude.b);
             colors.push(colorExtrude.r, colorExtrude.g, colorExtrude.b);
          } else {
             // Travel (G0 or G1 without E)
             colors.push(colorTravel.r, colorTravel.g, colorTravel.b);
             colors.push(colorTravel.r, colorTravel.g, colorTravel.b);
          }

          // Update current pos
          cx = x; cy = y; cz = z;
        }
      }
      else if (cmd === 'G90' || cmd === 'G91') {
         // handle positioning mode if we wanted full robustness
      }
      else if (cmd === 'G28') {
          cx = 0; cy = 0; cz = 0;
          x=0; y=0; z=0;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, [gcode]);

  if (!geometry) return null;

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors opacity={0.8} transparent linewidth={1} />
    </lineSegments>
  );
};

const GCodeViewer: React.FC<GCodeViewerProps> = ({ gcode }) => {
  return (
    <div className="w-full h-full bg-slate-950 relative rounded-lg overflow-hidden border border-slate-800 shadow-inner">
      <Canvas>
        <ambientLight intensity={0.5} />
        <pointLight position={[100, 100, 100]} />
        <GCodeVisualization gcode={gcode} />
        
        {/* Print Bed Helper - Assuming 220x220 */}
        <Grid position={[110, 110, 0]} args={[220, 220]} cellColor="#334155" sectionColor="#475569" rotation={[Math.PI/2, 0, 0]} fadeDistance={500} />
        <axesHelper position={[0, 0, 0]} args={[50]} />
        
        <OrbitControls makeDefault target={[110, 110, 0]} />
      </Canvas>
      <div className="absolute top-4 right-4 pointer-events-none">
          <div className="flex flex-col gap-2 bg-slate-900/80 p-3 rounded text-xs text-white backdrop-blur">
              <div className="flex items-center gap-2">
                  <span className="w-3 h-3 bg-red-500 rounded-full"></span> Extrusion
              </div>
              <div className="flex items-center gap-2">
                  <span className="w-3 h-3 bg-blue-500 rounded-full"></span> Travel
              </div>
          </div>
      </div>
    </div>
  );
};

export default GCodeViewer;
