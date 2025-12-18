import React, { useState, useEffect, useCallback } from 'react';
import { Upload, Download, Settings, RefreshCw, Printer, AlertCircle } from 'lucide-react';
import { PrinterSettings, ModelSettings } from './types';
import { generateGCode } from './services/gcodeService';
import GCodeViewer from './components/GCodeViewer';

const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  nozzleDiameter: 0.4,
  filamentDiameter: 1.75,
  layerHeight: 0.2,
  initialLayerHeight: 0.24,
  printSpeed: 50 * 60, // mm/min
  travelSpeed: 120 * 60, // mm/min
  temperature: 200,
  bedTemperature: 60,
  retractionDistance: 5,
  retractionSpeed: 40 * 60,
  extrusionMultiplier: 1.0,
  zOffset: 0,
  bedWidth: 220,
  bedDepth: 220,
};

const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  targetHeight: 1.0,
  scale: 1.0,
  fillDensity: 100,
  generateInfill: true,
};

export default function App() {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [printerSettings, setPrinterSettings] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS);
  const [modelSettings, setModelSettings] = useState<ModelSettings>(DEFAULT_MODEL_SETTINGS);
  const [prefixGCode, setPrefixGCode] = useState<string>('; Auto-Bed Leveling\nG29');
  const [gcode, setGcode] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setSvgContent(event.target.result as string);
          setError(null);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleGenerate = useCallback(async () => {
    if (!svgContent) return;
    setIsGenerating(true);
    setError(null);
    try {
      const result = await generateGCode(svgContent, printerSettings, modelSettings, prefixGCode);
      setGcode(result);
    } catch (err: any) {
      setError(err.message || 'Failed to generate G-Code');
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  }, [svgContent, printerSettings, modelSettings, prefixGCode]);

  // Auto-generate when SVG loads for the first time
  useEffect(() => {
    if (svgContent && !gcode) {
      handleGenerate();
    }
  }, [svgContent, handleGenerate, gcode]);

  const downloadGCode = () => {
    const blob = new Blob([gcode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName ? `${fileName.split('.')[0]}.gcode` : 'model.gcode';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const InputGroup = ({ label, value, onChange, step = 0.1, min = 0, suffix = '' }: any) => (
    <div className="flex flex-col gap-1 mb-3">
      <label className="text-xs text-slate-400 font-medium uppercase tracking-wider">{label}</label>
      <div className="flex items-center bg-slate-800 rounded px-3 py-2 border border-slate-700 focus-within:border-blue-500 transition-colors">
        <input 
          type="number" 
          step={step}
          min={min}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="bg-transparent text-sm text-white w-full focus:outline-none"
        />
        {suffix && <span className="text-xs text-slate-500 ml-2">{suffix}</span>}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 font-sans">
      {/* Header */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-6 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Printer className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-bold text-xl tracking-tight text-white">SVG<span className="text-blue-500">Slice</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
          <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors border border-slate-700 flex items-center gap-2">
            <Upload className="w-4 h-4" />
            <span>{fileName || "Upload SVG"}</span>
            <input type="file" accept=".svg" className="hidden" onChange={handleFileUpload} />
          </label>
          
          <button 
            onClick={handleGenerate}
            disabled={!svgContent || isGenerating}
            className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all ${!svgContent ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20'}`}
          >
            <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
            Regenerate
          </button>
          
          <button 
            onClick={downloadGCode}
            disabled={!gcode}
            className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all ${!gcode ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'}`}
          >
            <Download className="w-4 h-4" />
            Download G-Code
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Settings Panel */}
        <aside className="w-80 bg-slate-900/50 border-r border-slate-800 overflow-y-auto p-6 flex flex-col gap-8">
          
          {/* Section: Printer */}
          <div>
            <h2 className="flex items-center gap-2 text-white font-semibold mb-4 text-sm">
              <Settings className="w-4 h-4 text-blue-500" />
              Printer Settings
            </h2>
            <div className="space-y-1">
              <div className="grid grid-cols-2 gap-2">
                <InputGroup label="Bed Width" value={printerSettings.bedWidth} onChange={(v: number) => setPrinterSettings({...printerSettings, bedWidth: v})} suffix="mm" step={10} />
                <InputGroup label="Bed Depth" value={printerSettings.bedDepth} onChange={(v: number) => setPrinterSettings({...printerSettings, bedDepth: v})} suffix="mm" step={10} />
              </div>
              <InputGroup label="Nozzle Diameter" value={printerSettings.nozzleDiameter} onChange={(v: number) => setPrinterSettings({...printerSettings, nozzleDiameter: v})} suffix="mm" />
              <InputGroup label="Filament Diameter" value={printerSettings.filamentDiameter} onChange={(v: number) => setPrinterSettings({...printerSettings, filamentDiameter: v})} suffix="mm" />
              <InputGroup label="Layer Height" value={printerSettings.layerHeight} onChange={(v: number) => setPrinterSettings({...printerSettings, layerHeight: v})} suffix="mm" />
              <InputGroup label="Temp (Nozzle)" value={printerSettings.temperature} onChange={(v: number) => setPrinterSettings({...printerSettings, temperature: v})} suffix="°C" step={1} />
              <InputGroup label="Temp (Bed)" value={printerSettings.bedTemperature} onChange={(v: number) => setPrinterSettings({...printerSettings, bedTemperature: v})} suffix="°C" step={1} />
              <InputGroup label="Print Speed" value={printerSettings.printSpeed / 60} onChange={(v: number) => setPrinterSettings({...printerSettings, printSpeed: v * 60})} suffix="mm/s" step={1} />
            </div>
          </div>

          {/* Section: Model */}
          <div>
            <h2 className="flex items-center gap-2 text-white font-semibold mb-4 text-sm">
              <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
              Model Settings
            </h2>
            <div className="space-y-1">
              <InputGroup label="Target Height (Z)" value={modelSettings.targetHeight} onChange={(v: number) => setModelSettings({...modelSettings, targetHeight: v})} suffix="mm" />
              <InputGroup label="XY Scale" value={modelSettings.scale} onChange={(v: number) => setModelSettings({...modelSettings, scale: v})} step={0.1} suffix="x" />
              
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-slate-400 font-medium uppercase">Generate Infill</label>
                <input type="checkbox" checked={modelSettings.generateInfill} onChange={(e) => setModelSettings({...modelSettings, generateInfill: e.target.checked})} className="accent-blue-500 h-4 w-4 rounded border-slate-700 bg-slate-800" />
              </div>
              
              {modelSettings.generateInfill && (
                 <InputGroup label="Infill Density" value={modelSettings.fillDensity} onChange={(v: number) => setModelSettings({...modelSettings, fillDensity: v})} suffix="%" step={1} min={1} />
              )}
            </div>
          </div>

           {/* Section: Start G-Code */}
           <div>
            <h2 className="flex items-center gap-2 text-white font-semibold mb-4 text-sm">
              <span className="text-blue-500 font-mono text-xs">{`{}`}</span>
              Start G-Code Prefix
            </h2>
            <textarea 
              value={prefixGCode}
              onChange={(e) => setPrefixGCode(e.target.value)}
              className="w-full h-32 bg-slate-800 border border-slate-700 rounded p-3 text-xs font-mono text-slate-300 focus:outline-none focus:border-blue-500 resize-none"
              placeholder="G28 ; Home..."
            />
          </div>

        </aside>

        {/* Viewer Area */}
        <main className="flex-1 p-6 relative flex flex-col min-w-0">
          {error && (
            <div className="absolute top-6 left-6 right-6 z-20 bg-red-500/10 border border-red-500/50 text-red-200 p-4 rounded-lg flex items-center gap-3 backdrop-blur-md">
              <AlertCircle className="w-5 h-5 text-red-500" />
              {error}
            </div>
          )}

          {!svgContent && !gcode && (
             <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="text-center space-y-4 opacity-50">
                    <Upload className="w-16 h-16 mx-auto text-slate-600" />
                    <p className="text-xl font-medium text-slate-400">Upload an SVG to start slicing</p>
                </div>
             </div>
          )}

          <div className="flex-1 relative">
             <GCodeViewer gcode={gcode} bedWidth={printerSettings.bedWidth} bedDepth={printerSettings.bedDepth} />
          </div>
          
          <div className="mt-4 flex justify-between items-center text-xs text-slate-500">
             <div>
                {gcode ? `${gcode.split('\n').length} lines of G-Code generated` : 'Ready'}
             </div>
             <div>
                Use Left Click to Rotate • Right Click to Pan • Scroll to Zoom
             </div>
          </div>
        </main>
      </div>
    </div>
  );
}