import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Eye, EyeOff } from 'lucide-react';
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
  onBoundsCalculated: (bounds: Bounds | null) => void;
  visibleTypes: { extrusion: boolean, plot: boolean, travel: boolean };
}> = ({ gcode, onBoundsCalculated, visibleTypes }) => {
  const previousGcode = useRef<string>('');

  const { extrusionGeo, plotGeo, travelGeo, bounds } = useMemo(() => {
    if (!gcode) return { extrusionGeo: null, plotGeo: null, travelGeo: null, bounds: null };

    const extrusionPoints: number[] = [];
    const plotPoints: number[] = [];
    const travelPoints: number[] = [];
    
    // Track bounds
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    const updateBounds = (x: number, y: number, z: number) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    };

    // Parser State
    let x = 0, y = 0, z = 0, e = 0;
    let cx = 0, cy = 0, cz = 0, ce = 0;
    let isRelative = false; // G91 support roughly
    
    const splitLines = gcode.split('\n');
    
    for (const line of splitLines) {
      const parts = line.split(';')[0].trim().toUpperCase().split(' ');
      if (parts.length === 0 || parts[0] === '') continue;

      const cmd = parts[0];
      
      if (cmd === 'G90') isRelative = false;
      if (cmd === 'G91') isRelative = true;

      if (cmd === 'G0' || cmd === 'G1') {
        let hasMove = false;
        let newE = e; // Check for E change

        // Parse params
        for (let i = 1; i < parts.length; i++) {
          const p = parts[i];
          const val = parseFloat(p.substring(1));
          if (isNaN(val)) continue;

          switch (p[0]) {
            case 'X': x = isRelative ? x + val : val; hasMove = true; break;
            case 'Y': y = isRelative ? y + val : val; hasMove = true; break;
            case 'Z': z = isRelative ? z + val : val; hasMove = true; break;
            case 'E': 
              newE = isRelative ? e + val : val; 
              break;
          }
        }

        if (hasMove) {
          updateBounds(cx, cy, cz);
          updateBounds(x, y, z);

          // Determine Line Type
          if (cmd === 'G0') {
             travelPoints.push(cx, cy, cz, x, y, z);
          } else {
             // G1
             if (newE > ce) {
                 // Extrusion
                 extrusionPoints.push(cx, cy, cz, x, y, z);
             } else {
                 // G1 without E increase -> Plot (XY move) or Travel?
                 // In Plotter Mode, a G1 Z-only move is a "Pen Down" move, which is technically travel/positioning, not plotting.
                 // We detect if this is a pure Z move.
                 const isPureZ = Math.abs(z - cz) > 0.0001 && Math.abs(x - cx) < 0.0001 && Math.abs(y - cy) < 0.0001;

                 if (isPureZ) {
                     travelPoints.push(cx, cy, cz, x, y, z);
                 } else {
                     plotPoints.push(cx, cy, cz, x, y, z);
                 }
             }
          }

          // Update current pos
          cx = x; cy = y; cz = z; ce = newE;
          e = newE;
        }
      }
      else if (cmd === 'G28') {
          cx = 0; cy = 0; cz = 0;
          x=0; y=0; z=0;
      }
    }
    
    const calculatedBounds = (minX !== Infinity) ? {
        min: new THREE.Vector3(minX, minY, minZ),
        max: new THREE.Vector3(maxX, maxY, maxZ)
    } : null;

    const createGeo = (pts: number[]) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        return g;
    }

    return { 
        extrusionGeo: createGeo(extrusionPoints), 
        plotGeo: createGeo(plotPoints), 
        travelGeo: createGeo(travelPoints), 
        bounds: calculatedBounds 
    };
  }, [gcode]);

  useEffect(() => {
     if (gcode !== previousGcode.current) {
        onBoundsCalculated(bounds);
        previousGcode.current = gcode;
     }
  }, [bounds, gcode, onBoundsCalculated]);

  return (
    <>
      {visibleTypes.extrusion && extrusionGeo && (
        <lineSegments geometry={extrusionGeo}>
            <lineBasicMaterial color="#ef4444" linewidth={1} opacity={1} transparent={false} />
        </lineSegments>
      )}
      {visibleTypes.plot && plotGeo && (
        <lineSegments geometry={plotGeo}>
             {/* Use a distinct color for Plot (e.g., Green or Teal) */}
            <lineBasicMaterial color="#10b981" linewidth={1} opacity={1} transparent={false} />
        </lineSegments>
      )}
      {visibleTypes.travel && travelGeo && (
        <lineSegments geometry={travelGeo}>
            <lineBasicMaterial color="#3b82f6" linewidth={1} opacity={0.4} transparent />
        </lineSegments>
      )}
    </>
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
  const [visibleTypes, setVisibleTypes] = useState({ extrusion: true, plot: true, travel: true });

  const bedCenterX = bedWidth / 2;
  const bedCenterY = bedDepth / 2;

  const toggle = (key: keyof typeof visibleTypes) => {
      setVisibleTypes(p => ({...p, [key]: !p[key]}));
  };

  return (
    <div className="w-full h-full bg-slate-950 relative rounded-lg overflow-hidden border border-slate-800 shadow-inner group">
      <Canvas>
        <CameraSetup cx={bedCenterX} cy={bedCenterY} />
        <ambientLight intensity={0.6} />
        <pointLight position={[bedWidth, bedDepth, 200]} intensity={0.8} />
        <pointLight position={[0, 0, 200]} intensity={0.5} />
        
        <GCodeVisualization gcode={gcode} onBoundsCalculated={setBounds} visibleTypes={visibleTypes} />
        
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
      
      {/* HUD: Legend & Toggles */}
      <div className="absolute top-4 right-4 pointer-events-auto flex flex-col gap-2">
          <div className="flex flex-col gap-2 bg-slate-900/90 p-3 rounded text-xs text-white backdrop-blur border border-slate-700/50 shadow-lg">
              <div className="font-semibold border-b border-slate-700 pb-1 mb-1 text-slate-400 uppercase tracking-wider text-[10px]">Visibility</div>
              
              <button onClick={() => toggle('extrusion')} className="flex items-center justify-between gap-3 hover:bg-slate-800 p-1 rounded transition-colors group/btn">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 bg-red-500 rounded-full shadow-[0_0_5px_rgba(239,68,68,0.5)]"></span> 
                    <span>Extrusion</span>
                  </div>
                  {visibleTypes.extrusion ? <Eye className="w-3 h-3 text-slate-400" /> : <EyeOff className="w-3 h-3 text-slate-600" />}
              </button>

              <button onClick={() => toggle('plot')} className="flex items-center justify-between gap-3 hover:bg-slate-800 p-1 rounded transition-colors group/btn">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 bg-emerald-500 rounded-full shadow-[0_0_5px_rgba(16,185,129,0.5)]"></span> 
                    <span>Plot (2D)</span>
                  </div>
                  {visibleTypes.plot ? <Eye className="w-3 h-3 text-slate-400" /> : <EyeOff className="w-3 h-3 text-slate-600" />}
              </button>

              <button onClick={() => toggle('travel')} className="flex items-center justify-between gap-3 hover:bg-slate-800 p-1 rounded transition-colors group/btn">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 bg-blue-500 rounded-full shadow-[0_0_5px_rgba(59,130,246,0.5)]"></span> 
                    <span>Travel</span>
                  </div>
                  {visibleTypes.travel ? <Eye className="w-3 h-3 text-slate-400" /> : <EyeOff className="w-3 h-3 text-slate-600" />}
              </button>
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