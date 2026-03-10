import React, { useState, useRef, useEffect } from 'react';
import { Upload, Image as ImageIcon, ZoomIn, ZoomOut, Check, RefreshCw, SlidersHorizontal, AlertCircle, Grid3X3, Plus, Settings, Trash2, Eraser, Undo2, Redo2, Info, LayoutGrid, Layout } from 'lucide-react';

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

  return cells;
};


interface PlacedPattern {
  patternId: string;
  x: number;
  y: number;
  cells: { x: number, y: number, color: string }[];
}

function getRotatedCells(p: SavedPattern, rotation: number) {
  const colored = p.data.cells.filter(c => c.color);
  if (colored.length === 0) return [];
  
  const rows = p.data.rows;
  const cols = p.data.cols;
  
  let mapped = colored.map(c => {
    let x = c.col;
    let y = c.row;
    if (rotation === 90) {
      x = rows - 1 - c.row;
      y = c.col;
    } else if (rotation === 180) {
      x = cols - 1 - c.col;
      y = rows - 1 - c.row;
    } else if (rotation === 270) {
      x = c.row;
      y = cols - 1 - c.col;
    }
    return { x, y, color: c.color as string };
  });

  const minX = Math.min(...mapped.map(c => c.x));
  const minY = Math.min(...mapped.map(c => c.y));

  return mapped.map(c => ({
    x: c.x - minX,
    y: c.y - minY,
    color: c.color
  }));
}

function packPatterns(
  patterns: SavedPattern[],
  canvasW: number,
  canvasH: number,
  fill: boolean,
  packMode: 'tight' | 'grid' = 'tight'
): { placed: PlacedPattern[], allFit: boolean } {
  const placed: PlacedPattern[] = [];
  let allFit = true;

  if (packMode === 'grid') {
    const patternList = patterns.map(p => {
      const cells = getRotatedCells(p, 0);
      const w = Math.max(...cells.map(c => c.x)) + 1;
      const h = Math.max(...cells.map(c => c.y)) + 1;
      return { id: p.id, cells, w, h };
    }).filter(p => p.cells.length > 0);

    if (patternList.length === 0) return { placed, allFit };

    let currentX = 1;
    let currentY = 1;
    let rowHeight = 0;

    const placePattern = (p: typeof patternList[0]) => {
      if (currentX + p.w > canvasW - 1) {
        currentX = 1;
        currentY += rowHeight + 1;
        rowHeight = 0;
      }

      if (currentY + p.h > canvasH - 1) {
        return false;
      }

      placed.push({ patternId: p.id, x: currentX, y: currentY, cells: p.cells });
      rowHeight = Math.max(rowHeight, p.h);
      currentX += p.w + 1;
      return true;
    };

    for (const p of patternList) {
      if (!placePattern(p)) {
        allFit = false;
      }
    }

    if (fill && allFit && patternList.length > 0) {
      let keepGoing = true;
      let patternIndex = 0;
      while (keepGoing) {
        const p = patternList[patternIndex % patternList.length];
        if (!placePattern(p)) {
          keepGoing = false;
        } else {
          patternIndex++;
        }
      }
    }

    return { placed, allFit };
  }

  const grid = Array.from({ length: canvasH }, () => new Array(canvasW).fill(false));

  const canPlace = (cells: {x: number, y: number}[], startX: number, startY: number) => {
    for (const c of cells) {
      const px = startX + c.x;
      const py = startY + c.y;
      if (px < 0 || px >= canvasW || py < 0 || py >= canvasH) return false;
      
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx >= 0 && nx < canvasW && ny >= 0 && ny < canvasH) {
            if (grid[ny][nx]) return false;
          }
        }
      }
    }
    return true;
  };

  const place = (cells: {x: number, y: number}[], startX: number, startY: number) => {
    for (const c of cells) {
      grid[startY + c.y][startX + c.x] = true;
    }
  };

  const sortedPatterns = [...patterns].sort((a, b) => {
    const aCount = a.data.cells.filter(c => c.color).length;
    const bCount = b.data.cells.filter(c => c.color).length;
    return bCount - aCount;
  });

  const patternRotations = sortedPatterns.map(p => ({
    id: p.id,
    rotations: [0, 90, 180, 270].map(rot => getRotatedCells(p, rot)).filter(cells => cells.length > 0)
  }));

  for (const p of patternRotations) {
    if (p.rotations.length === 0) continue;
    let placedThis = false;

    for (let y = 0; y < canvasH && !placedThis; y++) {
      for (let x = 0; x < canvasW && !placedThis; x++) {
        for (const cells of p.rotations) {
          if (canPlace(cells, x, y)) {
            place(cells, x, y);
            placed.push({ patternId: p.id, x, y, cells });
            placedThis = true;
            break;
          }
        }
      }
    }

    if (!placedThis) {
      allFit = false;
    }
  }

  if (fill && allFit && patternRotations.length > 0) {
    let keepGoing = true;
    let patternIndex = 0;
    const validPatterns = patternRotations.filter(p => p.rotations.length > 0);
    
    if (validPatterns.length === 0) keepGoing = false;

    while (keepGoing) {
      const p = validPatterns[patternIndex % validPatterns.length];
      let placedThis = false;

      for (let y = 0; y < canvasH && !placedThis; y++) {
        for (let x = 0; x < canvasW && !placedThis; x++) {
          for (const cells of p.rotations) {
            if (canPlace(cells, x, y)) {
              place(cells, x, y);
              placed.push({ patternId: p.id, x, y, cells });
              placedThis = true;
              break;
            }
          }
        }
      }

      if (!placedThis) {
        let anyPlaced = false;
        for(let i=1; i<validPatterns.length; i++) {
          const nextP = validPatterns[(patternIndex + i) % validPatterns.length];
          let pThis = false;
          for (let y = 0; y < canvasH && !pThis; y++) {
            for (let x = 0; x < canvasW && !pThis; x++) {
              for (const cells of nextP.rotations) {
                if (canPlace(cells, x, y)) {
                  place(cells, x, y);
                  placed.push({ patternId: nextP.id, x, y, cells });
                  pThis = true;
                  break;
                }
              }
            }
          }
          if (pThis) {
            anyPlaced = true;
            patternIndex = (patternIndex + i);
            break;
          }
        }
        if (!anyPlaced) {
          keepGoing = false;
        }
      }
      patternIndex++;
    }
  }

  return { placed, allFit };
}


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
  const [imgAspect, setImgAspect] = useState<number | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImgAspect(img.width / img.height);
    };
    img.src = image;
  }, [image]);

  const handleProcess = async () => {
    setIsProcessing(true);
    // Small timeout to allow UI to update
    setTimeout(async () => {
      const rawCells = await extractGrid(image, rows, cols, left, right, top, bottom);
      const clusteredCells = clusterColors(rawCells, tolerance);
      onComplete({ rows, cols, cells: clusteredCells }, { rows, cols, left, right, top, bottom, tolerance });
      setIsProcessing(false);
    }, 50);
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-neutral-100 font-sans">
      <div className="w-full md:w-80 bg-white border-b md:border-r border-neutral-200 flex flex-col shadow-sm z-20 h-[45vh] md:h-full flex-shrink-0">
        <div className="p-4 md:p-6 border-b border-neutral-200">
          <h1 className="text-lg md:text-xl font-semibold text-neutral-800">调整网格对齐</h1>
          <p className="text-xs md:text-sm text-neutral-500 mt-1">请调整边缘和行列数，使网格完全贴合图纸中的格子。</p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6">
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
              <input type="range" min="0" max="100" step="0.5" value={left} onChange={e => setLeft(Number(e.target.value))} className="w-full accent-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">右边距: {right}%</label>
              <input type="range" min="0" max="100" step="0.5" value={right} onChange={e => setRight(Number(e.target.value))} className="w-full accent-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">上边距: {top}%</label>
              <input type="range" min="0" max="100" step="0.5" value={top} onChange={e => setTop(Number(e.target.value))} className="w-full accent-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">下边距: {bottom}%</label>
              <input type="range" min="0" max="100" step="0.5" value={bottom} onChange={e => setBottom(Number(e.target.value))} className="w-full accent-indigo-500" />
            </div>
          </div>

          <div className="w-full h-px bg-neutral-100" />

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-neutral-700 flex items-center justify-between">
              <span>颜色合并容差</span>
              <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">{tolerance}%</span>
            </h3>
            <p className="text-xs text-neutral-400">值越大，相近的颜色越容易被合并为同一种颜色。</p>
            <input type="range" min="10" max="100" value={tolerance} onChange={e => setTolerance(Number(e.target.value))} className="w-full accent-indigo-500" />
          </div>
        </div>

        <div className="p-4 md:p-6 border-t border-neutral-200 flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2 md:py-2.5 rounded-xl border border-neutral-200 text-neutral-600 font-medium hover:bg-neutral-50 transition-colors text-sm md:text-base">
            取消
          </button>
          <button 
            onClick={handleProcess} 
            disabled={isProcessing}
            className="flex-1 py-2 md:py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-70 text-sm md:text-base"
          >
            {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {isProcessing ? '提取中...' : '确认提取'}
          </button>
        </div>
      </div>

      <div className="flex-1 relative bg-neutral-800 overflow-hidden flex items-center justify-center p-4 md:p-8 min-h-0">
        {imgAspect && (
          <div 
            className="relative shadow-2xl flex-shrink-0" 
            style={{ 
              aspectRatio: `${imgAspect}`,
              maxWidth: '100%', 
              maxHeight: '100%' 
            }}
          >
            <img 
              src={image} 
              className="w-full h-full block" 
              alt="Preview" 
            />
            
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
        )}
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
  onDelete,
  onUpdatePattern
}: { 
  patterns: SavedPattern[], 
  activePatternId: string, 
  onSelectPattern: (id: string) => void, 
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void,
  onEdit: () => void,
  onDelete: () => void,
  onUpdatePattern: (id: string, data: any) => void
}) => {
  const [patternZoom, setPatternZoom] = useState(1);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [showOriginal, setShowOriginal] = useState(false);
  const [viewMode, setViewMode] = useState<'patterns' | 'canvas'>('patterns');
  const [canvasW, setCanvasW] = useState(52);
  const [canvasH, setCanvasH] = useState(52);
  const [fillCanvas, setFillCanvas] = useState(false);
  const [packMode, setPackMode] = useState<'tight' | 'grid'>('tight');

  // Eraser and Undo/Redo state
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const eraseBuffer = useRef<ExtractedCell[] | null>(null);
  
  const [past, setPast] = useState<ExtractedCell[][]>([]);
  const [future, setFuture] = useState<ExtractedCell[][]>([]);

  const activePattern = patterns.find(p => p.id === activePatternId);
  const cellSize = 40;

  useEffect(() => {
    setPast([]);
    setFuture([]);
    setIsEraserMode(false);
    setIsErasing(false);
  }, [activePatternId]);

  const handlePointerDown = (index: number) => {
    if (!isEraserMode || viewMode !== 'patterns' || !activePattern) return;
    setIsErasing(true);
    eraseBuffer.current = [...activePattern.data.cells];
    eraseCell(index);
  };

  const handlePointerEnter = (index: number) => {
    if (!isErasing || !isEraserMode || viewMode !== 'patterns' || !activePattern) return;
    eraseCell(index);
  };

  const handlePointerUp = () => {
    setIsErasing(false);
    if (eraseBuffer.current) {
      const buffer = eraseBuffer.current;
      setPast(prev => [...prev, buffer]);
      setFuture([]);
      eraseBuffer.current = null;
    }
  };

  useEffect(() => {
    window.addEventListener('pointerup', handlePointerUp);
    return () => window.removeEventListener('pointerup', handlePointerUp);
  }, []);

  const eraseCell = (index: number) => {
    if (!activePattern) return;
    const currentCells = activePattern.data.cells;
    if (currentCells[index].color === null) return;
    const newCells = [...currentCells];
    newCells[index] = { ...newCells[index], color: null };
    onUpdatePattern(activePattern.id, { ...activePattern.data, cells: newCells });
  };

  const handleUndo = () => {
    if (past.length === 0 || !activePattern) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, -1);
    
    setFuture(prev => [activePattern.data.cells, ...prev]);
    setPast(newPast);
    
    onUpdatePattern(activePattern.id, { ...activePattern.data, cells: previous });
  };

  const handleRedo = () => {
    if (future.length === 0 || !activePattern) return;
    const next = future[0];
    const newFuture = future.slice(1);
    
    setPast(prev => [...prev, activePattern.data.cells]);
    setFuture(newFuture);
    
    onUpdatePattern(activePattern.id, { ...activePattern.data, cells: next });
  };

  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    const sidebarW = isMobile ? 0 : 320;
    const sidebarH = isMobile ? window.innerHeight * 0.35 : 0;
    
    const availableW = window.innerWidth - sidebarW - (isMobile ? 40 : 100);
    const availableH = window.innerHeight - sidebarH - (isMobile ? 100 : 100);

    if (viewMode === 'canvas') {
      const contentW = canvasW * cellSize;
      const contentH = canvasH * cellSize;
      
      let fitZoom = Math.min(availableW / contentW, availableH / contentH);
      fitZoom = Math.max(0.1, Math.min(5, fitZoom - 0.1));
      
      setCanvasZoom(fitZoom);
    } else if (viewMode === 'patterns' && activePattern) {
      const contentW = activePattern.data.cols * cellSize;
      const contentH = activePattern.data.rows * cellSize;
      
      let fitZoom = Math.min(availableW / contentW, availableH / contentH);
      fitZoom = Math.max(0.1, Math.min(5, fitZoom - 0.1));
      
      setPatternZoom(fitZoom);
    }
  }, [viewMode, activePattern?.id, canvasW, canvasH]);

  const zoom = viewMode === 'patterns' ? patternZoom : canvasZoom;
  const setZoom = viewMode === 'patterns' ? setPatternZoom : setCanvasZoom;

  const packedData = React.useMemo(() => {
    if (viewMode !== 'canvas') return null;
    return packPatterns(patterns, canvasW, canvasH, fillCanvas, packMode);
  }, [patterns, canvasW, canvasH, fillCanvas, packMode, viewMode]);

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
    <div className="flex flex-col md:flex-row h-screen bg-neutral-100 overflow-hidden font-sans">
      <div className="w-full md:w-80 bg-white border-b md:border-r border-neutral-200 flex flex-col shadow-sm z-20 h-[35vh] md:h-full flex-shrink-0">
        <div className="p-3 md:p-4 border-b border-neutral-200">
          <div className="flex bg-neutral-100 rounded-lg p-1 mb-4">
            <button 
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'patterns' ? 'bg-white shadow-sm text-neutral-800' : 'text-neutral-500 hover:text-neutral-700'}`}
              onClick={() => setViewMode('patterns')}
            >
              图案列表
            </button>
            <button 
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'canvas' ? 'bg-white shadow-sm text-neutral-800' : 'text-neutral-500 hover:text-neutral-700'}`}
              onClick={() => setViewMode('canvas')}
            >
              主画板
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs md:text-sm text-neutral-500">
                已保存 {patterns.length} 张图案
              </p>
            </div>
            <div className="relative">
              <input
                type="file"
                accept="image/*"
                onChange={onUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                title="上传新图案"
              />
              <button className="px-2.5 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-1 text-xs font-medium">
                <Plus size={14} />
                <span>上传</span>
              </button>
            </div>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 md:p-4 flex flex-col">
          <div className="grid grid-cols-5 md:grid-cols-2 gap-2 md:gap-3 mb-4">
            {patterns.map(p => (
              <button
                key={p.id}
                onClick={() => {
                  onSelectPattern(p.id);
                  setViewMode('patterns');
                }}
                className={`w-full aspect-square relative rounded-xl overflow-hidden border-2 transition-all group ${
                  activePatternId === p.id && viewMode === 'patterns'
                    ? 'border-indigo-500 shadow-md' 
                    : 'border-transparent hover:border-neutral-300'
                }`}
              >
                <img src={p.originalImage} className="w-full h-full object-cover" alt="Thumbnail" />
                <div className="hidden md:block absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 text-left">
                  <span className="text-white text-xs font-medium drop-shadow-sm">
                    {p.data.cols} × {p.data.rows}
                  </span>
                </div>
              </button>
            ))}
          </div>
          
          <div className="mt-auto pt-4 border-t border-neutral-100">
            <p className="text-xs text-neutral-400 text-center flex items-center justify-center gap-1">
              <Info size={12} />
              图案颜色请以原始图纸为准
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 relative flex flex-col min-h-0">
        <div className="absolute top-2 md:top-6 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md px-1.5 md:px-4 py-1 md:py-2 rounded-full shadow-md border border-neutral-200 flex items-center gap-0.5 md:gap-4 z-30 max-w-[98vw] overflow-x-auto no-scrollbar">
          <button onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} className="p-1 md:p-2 hover:bg-neutral-100 rounded-full text-neutral-600 transition-colors flex-shrink-0">
            <ZoomOut size={16} className="md:w-5 md:h-5" />
          </button>
          <span className="font-mono text-[10px] md:text-sm w-8 md:w-12 text-center text-neutral-600 flex-shrink-0">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(5, z + 0.1))} className="p-1 md:p-2 hover:bg-neutral-100 rounded-full text-neutral-600 transition-colors flex-shrink-0">
            <ZoomIn size={16} className="md:w-5 md:h-5" />
          </button>
          <div className="w-px h-4 md:h-6 bg-neutral-300 mx-0.5 md:mx-2 flex-shrink-0" />
          
          {viewMode === 'patterns' ? (
            <>
              <button 
                onClick={() => setIsEraserMode(!isEraserMode)} 
                className={`p-1 md:p-2 rounded-full transition-colors flex-shrink-0 ${isEraserMode ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-neutral-100 text-neutral-600'}`} 
                title="橡皮擦"
              >
                <Eraser size={16} className="md:w-5 md:h-5" />
              </button>
              <button 
                onClick={handleUndo} 
                disabled={past.length === 0}
                className="p-1 md:p-2 rounded-full transition-colors text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent flex-shrink-0" 
                title="撤销"
              >
                <Undo2 size={16} className="md:w-5 md:h-5" />
              </button>
              <button 
                onClick={handleRedo} 
                disabled={future.length === 0}
                className="p-1 md:p-2 rounded-full transition-colors text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent flex-shrink-0" 
                title="重做"
              >
                <Redo2 size={16} className="md:w-5 md:h-5" />
              </button>
              <div className="w-px h-4 md:h-6 bg-neutral-300 mx-0.5 md:mx-2 flex-shrink-0" />
              <label className="flex items-center gap-1 md:gap-2 text-[10px] md:text-sm text-neutral-600 cursor-pointer flex-shrink-0">
                <input 
                  type="checkbox" 
                  checked={showOriginal} 
                  onChange={e => setShowOriginal(e.target.checked)}
                  className="rounded text-indigo-500 focus:ring-indigo-500 w-3 h-3 md:w-4 md:h-4"
                />
                <span className="whitespace-nowrap">显示原图对齐</span>
              </label>
              <div className="w-px h-4 md:h-6 bg-neutral-300 mx-0.5 md:mx-2 flex-shrink-0" />
              <button onClick={onEdit} className="p-1 md:p-2 hover:bg-neutral-100 rounded-full text-neutral-600 transition-colors flex-shrink-0" title="重新调整网格">
                <Settings size={16} className="md:w-5 md:h-5" />
              </button>
              <button onClick={onDelete} className="p-1 md:p-2 hover:bg-red-50 rounded-full text-red-500 transition-colors flex-shrink-0" title="删除图案">
                <Trash2 size={16} className="md:w-5 md:h-5" />
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1 md:gap-2 text-xs md:text-sm text-neutral-600 flex-shrink-0">
                <span className="whitespace-nowrap">画板:</span>
                <input type="number" min="10" max="200" value={canvasW} onChange={e => setCanvasW(Number(e.target.value))} className="w-10 md:w-14 px-1 py-0.5 border rounded text-center focus:ring-1 focus:ring-indigo-500 outline-none" />
                <span>×</span>
                <input type="number" min="10" max="200" value={canvasH} onChange={e => setCanvasH(Number(e.target.value))} className="w-10 md:w-14 px-1 py-0.5 border rounded text-center focus:ring-1 focus:ring-indigo-500 outline-none" />
              </div>
              <div className="w-px h-5 md:h-6 bg-neutral-300 mx-1 md:mx-2 flex-shrink-0" />
              <label className="flex items-center gap-1 md:gap-2 text-xs md:text-sm text-neutral-600 cursor-pointer flex-shrink-0">
                <input 
                  type="checkbox" 
                  checked={fillCanvas} 
                  onChange={e => setFillCanvas(e.target.checked)}
                  className="rounded text-indigo-500 focus:ring-indigo-500 w-3 h-3 md:w-4 md:h-4"
                />
                <span className="whitespace-nowrap">使用现有图案填充</span>
              </label>
              <div className="w-px h-5 md:h-6 bg-neutral-300 mx-1 md:mx-2 flex-shrink-0" />
              <button 
                onClick={() => setPackMode(m => m === 'tight' ? 'grid' : 'tight')} 
                className={`p-1.5 md:p-2 rounded-full transition-colors flex-shrink-0 ${packMode === 'grid' ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-neutral-100 text-neutral-600'}`} 
                title={packMode === 'tight' ? "当前：紧凑排列。点击切换为正着排列" : "当前：正着排列。点击切换为紧凑排列"}
              >
                {packMode === 'tight' ? <Layout size={18} className="md:w-5 md:h-5" /> : <LayoutGrid size={18} className="md:w-5 md:h-5" />}
              </button>
            </>
          )}
        </div>

        {viewMode === 'canvas' && packedData && !packedData.allFit && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-red-100 text-red-600 px-4 py-2 rounded-lg shadow-md border border-red-200 flex items-center gap-2 z-30">
            <AlertCircle size={16} />
            <span className="text-sm font-medium">画板已满，部分图案无法放入，请扩大画板或删除部分图案。</span>
          </div>
        )}

        <div className="flex-1 overflow-auto bg-neutral-200/50 relative">
          <div className="min-h-full min-w-full flex items-center justify-center p-12">
            {viewMode === 'patterns' ? (
              <div 
                style={{
                  width: data.cols * cellSize * zoom,
                  height: data.rows * cellSize * zoom,
                  transition: 'width 0.2s, height 0.2s'
                }}
                className="relative shadow-2xl bg-white flex-shrink-0"
              >
                <div 
                  className={`absolute top-0 left-0 origin-top-left transition-transform duration-200 ${isEraserMode ? 'cursor-crosshair touch-none' : ''}`}
                  style={{ 
                    width: data.cols * cellSize, 
                    height: data.rows * cellSize,
                    transform: `scale(${zoom})`
                  }}
                  onPointerDown={(e) => {
                    if (isEraserMode && viewMode === 'patterns' && activePattern) {
                      e.preventDefault();
                      setIsErasing(true);
                      eraseBuffer.current = [...activePattern.data.cells];
                    }
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

                  {(data.cells || []).map((bead: any, i: number) => {
                    if (!bead.color) return null;

                    return (
                      <div
                        key={`${bead.row}-${bead.col}-${i}`}
                        onPointerDown={(e) => {
                          if (isEraserMode) {
                            e.preventDefault();
                            e.stopPropagation();
                            handlePointerDown(i);
                          }
                        }}
                        onPointerEnter={() => handlePointerEnter(i)}
                        className={`absolute flex items-center justify-center border border-black/5 z-10 ${isEraserMode ? 'cursor-crosshair touch-none' : ''}`}
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
            ) : (
              packedData && (
                <div 
                  style={{
                    width: canvasW * cellSize * zoom,
                    height: canvasH * cellSize * zoom,
                    transition: 'width 0.2s, height 0.2s'
                  }}
                  className="relative shadow-2xl bg-white flex-shrink-0"
                >
                  <div 
                    className="absolute top-0 left-0 origin-top-left transition-transform duration-200"
                    style={{ 
                      width: canvasW * cellSize, 
                      height: canvasH * cellSize,
                      transform: `scale(${zoom})`
                    }}
                  >
                    <div 
                      className="absolute inset-0 pointer-events-none z-0"
                      style={{
                        backgroundImage: `
                          linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px),
                          linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px)
                        `,
                        backgroundSize: `${cellSize}px ${cellSize}px`
                      }}
                    />

                    {packedData.placed.map((placed, idx) => {
                      return (
                        <div
                          key={idx}
                          className="absolute"
                          style={{
                            left: placed.x * cellSize,
                            top: placed.y * cellSize,
                          }}
                        >
                          {placed.cells.map((cell, cIdx) => {
                            return (
                              <div
                                key={cIdx}
                                className="absolute flex items-center justify-center border border-black/5 z-10"
                                style={{
                                  left: cell.x * cellSize,
                                  top: cell.y * cellSize,
                                  width: cellSize,
                                  height: cellSize,
                                  backgroundColor: cell.color,
                                }}
                              />
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            )}
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
          onUpdatePattern={(id, data) => {
            setPatterns(prev => prev.map(p => p.id === id ? { ...p, data } : p));
          }}
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
          <h1 className="text-2xl md:text-3xl font-bold text-neutral-900 mb-3 tracking-tight">拼豆图纸解析器 (本地版)</h1>
          <p className="text-sm md:text-base text-neutral-500 mb-8 md:mb-10 leading-relaxed">
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
