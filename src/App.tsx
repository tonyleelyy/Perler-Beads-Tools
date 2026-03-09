import React, { useState, useRef, useEffect } from 'react';
import { Upload, Image as ImageIcon, ZoomIn, ZoomOut, Check, RefreshCw, SlidersHorizontal, AlertCircle, Grid3X3, Plus, Settings, Trash2 } from 'lucide-react';

// --- Helper Functions ---
function rgbToHex(r: number, g: number, b: number) {
  return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).toUpperCase();
}

function colorDistance(c1: number[], c2: number[]) {
  return Math.sqrt(Math.pow(c1[0]-c2[0], 2) + Math.pow(c1[1]-c2[1], 2) + Math.pow(c1[2]-c2[2], 2));
}

interface ExtractedCell {
  row: number;
  col: number;
  color: string | null;
  rgb: number[];
}

interface AlignConfig {
  rows: number;
  cols: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  tolerance: number;
}

interface SavedPattern {
  id: string;
  originalImage: string;
  config: AlignConfig;
  data: {
    rows: number;
    cols: number;
    cells: ExtractedCell[];
  };
}

const extractGrid = (imageSrc: string, rows: number, cols: number, left: number, right: number, top: number, bottom: number) => {
  return new Promise<ExtractedCell[]>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const gridX = img.width * (left / 100);
      const gridY = img.height * (top / 100);
      const gridW = img.width * (1 - (left + right) / 100);
      const gridH = img.height * (1 - (top + bottom) / 100);

      const cellW = gridW / cols;
      const cellH = gridH / rows;

      const cells: ExtractedCell[] = [];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = gridX + c * cellW;
          const cy = gridY + r * cellH;

          // Sample 4 points near corners to avoid center text and edge lines
          const pts = [
            [cx + cellW * 0.25, cy + cellH * 0.25],
            [cx + cellW * 0.75, cy + cellH * 0.25],
            [cx + cellW * 0.25, cy + cellH * 0.75],
            [cx + cellW * 0.75, cy + cellH * 0.75],
          ];

          let tr = 0, tg = 0, tb = 0;
          for (const [px, py] of pts) {
            const data = ctx.getImageData(px, py, 1, 1).data;
            tr += data[0];
            tg += data[1];
            tb += data[2];
          }
          
          const avgR = Math.round(tr / 4);
          const avgG = Math.round(tg / 4);
          const avgB = Math.round(tb / 4);

          // Check if white/empty (e.g., > 240)
          if (avgR > 240 && avgG > 240 && avgB > 240) {
            cells.push({ row: r, col: c, color: null, rgb: [avgR, avgG, avgB] });
          } else {
            cells.push({ row: r, col: c, color: rgbToHex(avgR, avgG, avgB), rgb: [avgR, avgG, avgB] });
          }
        }
      }
      resolve(cells);
    };
    img.src = imageSrc;
  });
};

const clusterColors = (cells: ExtractedCell[], tolerance: number) => {
  const palette: { rgb: number[], hex: string }[] = [];

  for (const cell of cells) {
    if (!cell.color) continue;

    let found = false;
    for (const p of palette) {
      if (colorDistance(cell.rgb, p.rgb) < tolerance) {
        cell.color = p.hex;
        found = true;
        break;
      }
    }

    if (!found) {
      const hex = rgbToHex(cell.rgb[0], cell.rgb[1], cell.rgb[2]);
      palette.push({
        rgb: cell.rgb,
        hex: hex
      });
      cell.color = hex;
    }
  }

  return { cells };
};


// --- Components ---

const GridAligner = ({ image, initialConfig, onComplete, onCancel }: { image: string, initialConfig?: AlignConfig, onComplete: (data: any, config: AlignConfig) => void, onCancel: () => void }) => {
  const [rows, setRows] = useState(initialConfig?.rows ?? 16);
  const [cols, setCols] = useState(initialConfig?.cols ?? 16);
  const [left, setLeft] = useState(initialConfig?.left ?? 0);
  const [right, setRight] = useState(initialConfig?.right ?? 0);
  const [top, setTop] = useState(initialConfig?.top ?? 0);
  const [bottom, setBottom] = useState(initialConfig?.bottom ?? 0);
  const [tolerance, setTolerance] = useState(initialConfig?.tolerance ?? 40);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleProcess = async () => {
    setIsProcessing(true);
    // Small timeout to allow UI to update
    setTimeout(async () => {
      const rawCells = await extractGrid(image, rows, cols, left, right, top, bottom);
      const { cells } = clusterColors(rawCells, tolerance);
      onComplete({ rows, cols, cells }, { rows, cols, left, right, top, bottom, tolerance });
      setIsProcessing(false);
    }, 50);
  };

  return (
    <div className="flex h-screen bg-neutral-100 font-sans">
      <div className="w-80 bg-white border-r border-neutral-200 flex flex-col shadow-sm z-20">
        <div className="p-6 border-b border-neutral-200">
          <h1 className="text-xl font-semibold text-neutral-800">调整网格对齐</h1>
          <p className="text-sm text-neutral-500 mt-1">请调整边缘和行列数，使网格完全贴合图纸中的格子。</p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-neutral-700 flex items-center gap-2">
              <Grid3X3 size={16} /> 网格尺寸
            </h3>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">列数 (Columns): {cols}</label>
              <input type="range" min="5" max="50" value={cols} onChange={e => setCols(Number(e.target.value))} className="w-full accent-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">行数 (Rows): {rows}</label>
              <input type="range" min="5" max="50" value={rows} onChange={e => setRows(Number(e.target.value))} className="w-full accent-indigo-500" />
            </div>
          </div>

          <div className="w-full h-px bg-neutral-100" />

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-neutral-700 flex items-center gap-2">
              <SlidersHorizontal size={16} /> 边缘裁剪 (%)
            </h3>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">左边距: {left}%</label>
              <input type="range" min="0" max="40" step="0.5" value={left} onChange={e => setLeft(Number(e.target.value))} className="w-full accent-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">右边距: {right}%</label>
              <input type="range" min="0" max="40" step="0.5" value={right} onChange={e => setRight(Number(e.target.value))} className="w-full accent-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">上边距: {top}%</label>
              <input type="range" min="0" max="40" step="0.5" value={top} onChange={e => setTop(Number(e.target.value))} className="w-full accent-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">下边距: {bottom}%</label>
              <input type="range" min="0" max="40" step="0.5" value={bottom} onChange={e => setBottom(Number(e.target.value))} className="w-full accent-indigo-500" />
            </div>
          </div>

          <div className="w-full h-px bg-neutral-100" />

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-neutral-700">颜色合并容差</h3>
            <p className="text-xs text-neutral-400">值越大，相近的颜色越容易被合并为同一种颜色。</p>
            <input type="range" min="10" max="100" value={tolerance} onChange={e => setTolerance(Number(e.target.value))} className="w-full accent-indigo-500" />
          </div>
        </div>

        <div className="p-6 border-t border-neutral-200 flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-neutral-200 text-neutral-600 font-medium hover:bg-neutral-50 transition-colors">
            取消
          </button>
          <button 
            onClick={handleProcess} 
            disabled={isProcessing}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {isProcessing ? '提取中...' : '确认提取'}
          </button>
        </div>
      </div>

      <div className="flex-1 relative bg-neutral-800 overflow-hidden flex items-center justify-center p-8">
        <div className="relative max-w-full max-h-full flex items-center justify-center">
          <img src={image} className="max-w-full max-h-full object-contain shadow-2xl" alt="Preview" />
          
          <div 
            className="absolute border-4 border-indigo-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] pointer-events-none"
            style={{
              left: `${left}%`,
              right: `${right}%`,
              top: `${top}%`,
              bottom: `${bottom}%`
            }}
          >
            <div className="w-full h-full flex flex-col">
              {Array.from({length: rows}).map((_, r) => (
                <div key={r} className="flex-1 flex border-b-2 border-indigo-500/80 last:border-0">
                  {Array.from({length: cols}).map((_, c) => (
                    <div key={c} className="flex-1 border-r-2 border-indigo-500/80 last:border-0" />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Workspace = ({ 
  patterns, 
  activePatternId, 
  onSelectPattern, 
  onUpload,
  onEdit,
  onDelete
}: { 
  patterns: SavedPattern[], 
  activePatternId: string, 
  onSelectPattern: (id: string) => void, 
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void,
  onEdit: () => void,
  onDelete: () => void
}) => {
  const [zoom, setZoom] = useState(1);
  const [showOriginal, setShowOriginal] = useState(false);

  const activePattern = patterns.find(p => p.id === activePatternId);
  const cellSize = 40;

  if (!activePattern) return null;

  const { data, originalImage, config } = activePattern;

  const left = config?.left || 0;
  const right = config?.right || 0;
  const top = config?.top || 0;
  const bottom = config?.bottom || 0;
  
  const cropWidthPct = 100 - (left + right);
  const cropHeightPct = 100 - (top + bottom);
  
  const imgWidth = (100 / cropWidthPct) * 100;
  const imgHeight = (100 / cropHeightPct) * 100;
  const imgLeft = -(left / cropWidthPct) * 100;
  const imgTop = -(top / cropHeightPct) * 100;

  return (
    <div className="flex h-screen bg-neutral-100 overflow-hidden font-sans">
      <div className="w-80 bg-white border-r border-neutral-200 flex flex-col shadow-sm z-20">
        <div className="p-6 border-b border-neutral-200 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-neutral-800">图案列表</h1>
            <p className="text-sm text-neutral-500 mt-1">
              已保存 {patterns.length} 张图案
            </p>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {patterns.map(p => (
            <button
              key={p.id}
              onClick={() => onSelectPattern(p.id)}
              className={`w-full relative rounded-xl overflow-hidden border-2 transition-all group ${
                activePatternId === p.id 
                  ? 'border-indigo-500 shadow-md' 
                  : 'border-transparent hover:border-neutral-300'
              }`}
            >
              <img src={p.originalImage} className="w-full h-28 object-cover" alt="Thumbnail" />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 text-left">
                <span className="text-white text-xs font-medium drop-shadow-sm">
                  {p.data.cols} × {p.data.rows}
                </span>
              </div>
            </button>
          ))}
          
          <div className="relative w-full h-28 rounded-xl border-2 border-dashed border-neutral-300 flex flex-col items-center justify-center text-neutral-500 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50/50 transition-all group cursor-pointer">
            <input
              type="file"
              accept="image/*"
              onChange={onUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <Plus size={24} className="mb-2" />
            <span className="text-sm font-medium">上传新图案</span>
          </div>
        </div>
      </div>

      <div className="flex-1 relative flex flex-col">
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md px-4 py-2 rounded-full shadow-md border border-neutral-200 flex items-center gap-4 z-30">
          <button onClick={() => setZoom(z => Math.max(0.2, z - 0.2))} className="p-2 hover:bg-neutral-100 rounded-full text-neutral-600 transition-colors">
            <ZoomOut size={20} />
          </button>
          <span className="font-mono text-sm w-12 text-center text-neutral-600">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(5, z + 0.2))} className="p-2 hover:bg-neutral-100 rounded-full text-neutral-600 transition-colors">
            <ZoomIn size={20} />
          </button>
          <div className="w-px h-6 bg-neutral-300 mx-2" />
          <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer">
            <input 
              type="checkbox" 
              checked={showOriginal} 
              onChange={e => setShowOriginal(e.target.checked)}
              className="rounded text-indigo-500 focus:ring-indigo-500"
            />
            显示原图对齐
          </label>
          <div className="w-px h-6 bg-neutral-300 mx-2" />
          <button onClick={onEdit} className="p-2 hover:bg-neutral-100 rounded-full text-neutral-600 transition-colors" title="重新调整网格">
            <Settings size={20} />
          </button>
          <button onClick={onDelete} className="p-2 hover:bg-red-50 rounded-full text-red-500 transition-colors" title="删除图案">
            <Trash2 size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-neutral-200/50 relative">
          <div className="min-h-full min-w-full flex items-center justify-center p-12">
            <div 
              style={{
                width: data.cols * cellSize * zoom,
                height: data.rows * cellSize * zoom,
                transition: 'width 0.2s, height 0.2s'
              }}
              className="relative shadow-2xl bg-white flex-shrink-0"
            >
              <div 
                className="absolute top-0 left-0 origin-top-left transition-transform duration-200"
                style={{ 
                  width: data.cols * cellSize, 
                  height: data.rows * cellSize,
                  transform: `scale(${zoom})`
                }}
              >
                {showOriginal && (
                  <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 opacity-40">
                    <img 
                      src={originalImage} 
                      className="absolute max-w-none"
                      style={{
                        width: `${imgWidth}%`,
                        height: `${imgHeight}%`,
                        left: `${imgLeft}%`,
                        top: `${imgTop}%`,
                      }}
                      alt="Original"
                    />
                  </div>
                )}

                <div 
                  className="absolute inset-0 pointer-events-none z-10"
                  style={{
                    backgroundImage: `
                      linear-gradient(to right, rgba(0,0,0,0.1) 1px, transparent 1px),
                      linear-gradient(to bottom, rgba(0,0,0,0.1) 1px, transparent 1px)
                    `,
                    backgroundSize: `${cellSize}px ${cellSize}px`
                  }}
                />

                {data.cells.map((bead: any, i: number) => {
                  if (!bead.color) return null;

                  return (
                    <div
                      key={`${bead.row}-${bead.col}-${i}`}
                      className="absolute flex items-center justify-center border border-black/5 z-10"
                      style={{
                        left: bead.col * cellSize,
                        top: bead.row * cellSize,
                        width: cellSize,
                        height: cellSize,
                        backgroundColor: bead.color,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [patterns, setPatterns] = useState<SavedPattern[]>([]);
  const [activePatternId, setActivePatternId] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [step, setStep] = useState<'upload' | 'align' | 'workspace'>('upload');
  const [editingPatternId, setEditingPatternId] = useState<string | null>(null);
  const [patternToDelete, setPatternToDelete] = useState<string | null>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setPendingImage(event.target?.result as string);
      setEditingPatternId(null);
      setStep('align');
    };
    reader.readAsDataURL(file);
    
    // Reset input value so the same file can be selected again if needed
    e.target.value = '';
  };

  const confirmDelete = () => {
    if (!patternToDelete) return;
    const nextPatterns = patterns.filter(p => p.id !== patternToDelete);
    setPatterns(nextPatterns);
    if (nextPatterns.length > 0) {
      setActivePatternId(nextPatterns[0].id);
    } else {
      setActivePatternId(null);
      setStep('upload');
    }
    setPatternToDelete(null);
  };

  if (step === 'align' && pendingImage) {
    const editingPattern = editingPatternId ? patterns.find(p => p.id === editingPatternId) : null;
    return <GridAligner 
      image={pendingImage} 
      initialConfig={editingPattern?.config}
      onComplete={(data, config) => {
        if (editingPatternId) {
          setPatterns(prev => prev.map(p => p.id === editingPatternId ? { ...p, data, config } : p));
          setEditingPatternId(null);
        } else {
          const newPattern: SavedPattern = {
            id: Date.now().toString(),
            originalImage: pendingImage,
            config,
            data
          };
          setPatterns(prev => [...prev, newPattern]);
          setActivePatternId(newPattern.id);
        }
        setPendingImage(null);
        setStep('workspace');
      }} 
      onCancel={() => {
        setPendingImage(null);
        setEditingPatternId(null);
        setStep(patterns.length > 0 ? 'workspace' : 'upload');
      }} 
    />;
  }

  if (step === 'workspace' && patterns.length > 0 && activePatternId) {
    return (
      <>
        <Workspace 
          patterns={patterns} 
          activePatternId={activePatternId}
          onSelectPattern={setActivePatternId}
          onUpload={handleImageUpload}
          onEdit={() => {
            const p = patterns.find(p => p.id === activePatternId);
            if (p) {
              setPendingImage(p.originalImage);
              setEditingPatternId(p.id);
              setStep('align');
            }
          }}
          onDelete={() => setPatternToDelete(activePatternId)}
        />
        
        {patternToDelete && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-neutral-100">
              <div className="flex items-center gap-3 mb-4 text-red-600">
                <AlertCircle size={24} />
                <h3 className="text-lg font-semibold text-neutral-900">确认删除</h3>
              </div>
              <p className="text-neutral-500 mb-6">确定要删除这张图案吗？此操作无法撤销。</p>
              <div className="flex justify-end gap-3">
                <button 
                  onClick={() => setPatternToDelete(null)}
                  className="px-4 py-2 rounded-xl border border-neutral-200 text-neutral-600 font-medium hover:bg-neutral-50 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={confirmDelete}
                  className="px-4 py-2 rounded-xl bg-red-500 text-white font-medium hover:bg-red-600 transition-colors"
                >
                  确认删除
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6 font-sans">
      <div className="max-w-xl w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-neutral-100">
        <div className="p-10 text-center">
          <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <ImageIcon className="w-10 h-10 text-indigo-500" />
          </div>
          <h1 className="text-3xl font-bold text-neutral-900 mb-3 tracking-tight">拼豆图纸解析器 (本地版)</h1>
          <p className="text-neutral-500 mb-10 leading-relaxed">
            无需 AI，纯本地处理。上传图纸，手动对齐网格，自动生成可交互图纸，并支持多图纸切换。
          </p>

          <div className="relative group">
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="border-2 border-dashed rounded-2xl p-10 transition-all duration-200 flex flex-col items-center justify-center gap-4 border-neutral-200 group-hover:border-indigo-400 group-hover:bg-indigo-50/30">
              <div className="w-14 h-14 bg-white shadow-sm rounded-full flex items-center justify-center border border-neutral-100 group-hover:scale-110 transition-transform">
                <Upload className="w-6 h-6 text-indigo-500" />
              </div>
              <div>
                <div className="text-neutral-700 font-medium text-lg">点击或拖拽上传图纸</div>
                <div className="text-neutral-400 text-sm mt-1">支持 JPG, PNG 格式</div>
              </div>
            </div>
          </div>
          
          {patterns.length > 0 && (
            <button 
              onClick={() => setStep('workspace')}
              className="mt-6 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              返回工作区 ({patterns.length} 张图案)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
