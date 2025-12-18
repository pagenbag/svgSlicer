import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';

interface Bounds {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

interface GCodeViewerProps {
  gcode: string;
  bedWidth: number;
  bedDepth: number;
}

const GCodeVisualization: React.FC<{ 
  gcode: string; 
  onBoundsCalculated: (bounds: Bounds | null) => void 
}> = ({ gcode, onBoundsCalculated }) => {
  const previousGcode = useRef<string>('');

  const { geometry, bounds } = useMemo(() => {
    if (!gcode) return { geometry: null, bounds: null };

    const lines: number[] = [];
    const colors: number[] = [];
    
    // Track bounds
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    const updateBounds = (x: number, y: number, z: number) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    };

    // Simple state machine for the parser
    let x = 0, y = 0, z = 0;
    // Current positions
    let cx = 0, cy = 0, cz = 0;
    
    const splitLines = gcode.split('\n');
    
    // Reusable objects
    const colorExtrude = new THREE.Color('#ef4444'); // Red for extrusion
    const colorTravel = new THREE.Color('#3b82f6'); // Blue for travel

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
              isExtruding = true; 
              break;
          }
        }

        if (hasMove) {
          lines.push(cx, cy, cz);
          lines.push(x, y, z);
          
          updateBounds(cx, cy, cz);
          updateBounds(x, y, z);

          // Color
          if (isExtruding && cmd === 'G1') {
             colors.push(colorExtrude.r, colorExtrude.g, colorExtrude.b);
             colors.push(colorExtrude.r, colorExtrude.g, colorExtrude.b);
          } else {
             // Travel
             colors.push(colorTravel.r, colorTravel.g, colorTravel.b);
             colors.push(colorTravel.r, colorTravel.g, colorTravel.b);
          }

          // Update current pos
          cx = x; cy = y; cz = z;
        }
      }
      else if (cmd === 'G28') {
          cx = 0; cy = 0; cz = 0;
          x=0; y=0; z=0;
      }
    }
    
    // Handle case where no moves generated geometry
    const calculatedBounds = (minX !== Infinity) ? {
        min: new THREE.Vector3(minX, minY, minZ),
        max: new THREE.Vector3(maxX, maxY, maxZ)
    } : null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return { geometry: geo, bounds: calculatedBounds };
  }, [gcode]);

  useEffect(() => {
     if (gcode !== previousGcode.current) {
        onBoundsCalculated(bounds);
        previousGcode.current = gcode;
     }
  }, [bounds, gcode, onBoundsCalculated]);

  if (!geometry) return null;

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors opacity={0.8} transparent linewidth={1} />
    </lineSegments>
  );
};

// Component to handle initial camera setup for Z-up
const CameraSetup: React.FC<{ cx: number, cy: number }> = ({ cx, cy }) => {
    const { camera } = useThree();
    const initialized = useRef(false);

    useEffect(() => {
        if (!initialized.current) {
            camera.up.set(0, 0, 1); // Set Z as Up
            camera.position.set(cx, -cy * 0.5, 200); // Angle view
            camera.lookAt(cx, cy, 0);
            initialized.current = true;
        }
    }, [camera, cx, cy]);
    return null;
}

const GCodeViewer: React.FC<GCodeViewerProps> = ({ gcode, bedWidth, bedDepth }) => {
  const [bounds, setBounds] = useState<Bounds | null>(null);

  const bedCenterX = bedWidth / 2;
  const bedCenterY = bedDepth / 2;

  return (
    <div className="w-full h-full bg-slate-950 relative rounded-lg overflow-hidden border border-slate-800 shadow-inner group">
      <Canvas>
        <CameraSetup cx={bedCenterX} cy={bedCenterY} />
        <ambientLight intensity={0.6} />
        <pointLight position={[bedWidth, bedDepth, 200]} intensity={0.8} />
        <pointLight position={[0, 0, 200]} intensity={0.5} />
        
        <GCodeVisualization gcode={gcode} onBoundsCalculated={setBounds} />
        
        {/* Bed Visualization */}
        <group position={[bedCenterX, bedCenterY, 0]}>
             {/* Main Surface */}
            <mesh position={[0, 0, -0.1]} receiveShadow>
                <planeGeometry args={[bedWidth, bedDepth]} />
                <meshStandardMaterial color="#1e293b" roughness={0.8} metalness={0.2} />
            </mesh>
            {/* Grid - Rotated to lie on XY plane */}
            <Grid 
                args={[bedWidth, bedDepth]} 
                cellSize={10} 
                cellThickness={1.0} 
                cellColor="#334155" 
                sectionSize={50} 
                sectionThickness={1.5} 
                sectionColor="#64748b" 
                fadeDistance={1000} 
                rotation={[Math.PI / 2, 0, 0]} 
                infiniteGrid={false}
            />
        </group>

        <axesHelper position={[0, 0, 0]} args={[30]} />
        <OrbitControls makeDefault target={[bedCenterX, bedCenterY, 0]} />
      </Canvas>
      
      {/* HUD: Legend */}
      <div className="absolute top-4 right-4 pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity">
          <div className="flex flex-col gap-2 bg-slate-900/80 p-3 rounded text-xs text-white backdrop-blur border border-slate-700/50">
              <div className="flex items-center gap-2">
                  <span className="w-3 h-3 bg-red-500 rounded-full"></span> Extrusion
              </div>
              <div className="flex items-center gap-2">
                  <span className="w-3 h-3 bg-blue-500 rounded-full"></span> Travel
              </div>
          </div>
      </div>

      {/* HUD: Dimensions */}
      <div className="absolute top-4 left-4 pointer-events-none">
          <div className="flex flex-col gap-1 bg-slate-900/80 p-3 rounded text-xs text-slate-300 backdrop-blur border border-slate-700/50">
             <div className="font-semibold text-white mb-1 border-b border-slate-700 pb-1">Dimensions</div>
             {bounds ? (
                 <>
                    <div className="flex justify-between gap-4">
                        <span>Width (X):</span> 
                        <span className="font-mono text-white">{(bounds.max.x - bounds.min.x).toFixed(1)} mm</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span>Depth (Y):</span> 
                        <span className="font-mono text-white">{(bounds.max.y - bounds.min.y).toFixed(1)} mm</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span>Height (Z):</span> 
                        <span className="font-mono text-white">{(bounds.max.z - bounds.min.z).toFixed(1)} mm</span>
                    </div>
                 </>
             ) : (
                 <div className="text-slate-500 italic">No model loaded</div>
             )}
          </div>
      </div>

       {/* HUD: Bed Size Indicator (Bottom Left) */}
       <div className="absolute bottom-4 left-4 pointer-events-none text-[10px] text-slate-600 font-mono">
            Bed: {bedWidth}x{bedDepth}mm
       </div>
    </div>
  );
};

export default GCodeViewer;