"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "./page.module.css";

type Point = {
  x: number;
  y: number;
};

type ToolMode = "navigate" | "calibrate" | "measure";

type ImageAsset = {
  src: string;
  width: number;
  height: number;
  name: string;
};

type Calibration = {
  start: Point;
  end: Point;
  knownDistance: number;
  unit: string;
  pixelsPerUnit: number;
};

type Measurement = {
  id: string;
  name: string;
  start: Point;
  end: Point;
  value: number;
  unit: string;
  color: string;
};

type Viewport = {
  width: number;
  height: number;
};

const TOOL_LABELS: Record<ToolMode, string> = {
  navigate: "Mover",
  calibrate: "Calibrar",
  measure: "Medir",
};

const MEASUREMENT_COLORS = ["#fc6f59", "#ffb347", "#4cd7b2", "#6cb8ff", "#ffe27a"];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function distanceBetween(start: Point, end: Point) {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function formatNumber(value: number) {
  if (value >= 100) {
    return value.toFixed(1);
  }

  if (value >= 10) {
    return value.toFixed(2);
  }

  return value.toFixed(3);
}

function formatPixels(value: number) {
  return `${value.toFixed(1)} px`;
}

function niceScaleLength(maxUnits: number) {
  if (maxUnits <= 0) {
    return 0;
  }

  const exponent = Math.floor(Math.log10(maxUnits));
  const base = 10 ** exponent;
  const candidates = [1, 2, 5, 10];
  let best = base;

  for (const candidate of candidates) {
    const value = candidate * base;
    if (value <= maxUnits) {
      best = value;
    }
  }

  return best;
}

function makeMeasurementName(index: number) {
  return `M${String(index + 1).padStart(2, "0")}`;
}

function midpoint(start: Point, end: Point) {
  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
}

function lineLabelPosition(start: Point, end: Point, offset = 22) {
  const center = midpoint(start, end);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);

  return {
    x: center.x + Math.sin(angle) * offset,
    y: center.y - Math.cos(angle) * offset,
  };
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const [imageAsset, setImageAsset] = useState<ImageAsset | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>("navigate");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showScaleBar, setShowScaleBar] = useState(true);
  const [calibrationDraft, setCalibrationDraft] = useState<Point[]>([]);
  const [measurementDraft, setMeasurementDraft] = useState<Point | null>(null);
  const [knownDistance, setKnownDistance] = useState("100");
  const [unit, setUnit] = useState("um");
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  useEffect(() => {
    const element = viewportRef.current;

    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const fitScale =
    imageAsset && viewport.width > 0 && viewport.height > 0
      ? Math.min(viewport.width / imageAsset.width, viewport.height / imageAsset.height)
      : 1;

  const renderedWidth = imageAsset ? imageAsset.width * fitScale * zoom : 0;
  const renderedHeight = imageAsset ? imageAsset.height * fitScale * zoom : 0;
  const stageX = (viewport.width - renderedWidth) / 2 + pan.x;
  const stageY = (viewport.height - renderedHeight) / 2 + pan.y;

  function resetWorkspace() {
    setToolMode("navigate");
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setShowScaleBar(true);
    setCalibrationDraft([]);
    setMeasurementDraft(null);
    setCalibration(null);
    setMeasurements([]);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    const probe = new window.Image();

    probe.onload = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      objectUrlRef.current = nextUrl;

      setImageAsset({
        src: nextUrl,
        width: probe.naturalWidth,
        height: probe.naturalHeight,
        name: file.name,
      });

      resetWorkspace();
    };

    probe.onerror = () => {
      URL.revokeObjectURL(nextUrl);
    };

    probe.src = nextUrl;
    event.target.value = "";
  }

  function screenToImage(clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();

    if (!rect || !imageAsset || renderedWidth <= 0 || renderedHeight <= 0) {
      return null;
    }

    const localX = clientX - rect.left - stageX;
    const localY = clientY - rect.top - stageY;

    return {
      x: clamp(localX / (fitScale * zoom), 0, imageAsset.width),
      y: clamp(localY / (fitScale * zoom), 0, imageAsset.height),
    };
  }

  function applyCalibration() {
    if (calibrationDraft.length !== 2) {
      return;
    }

    const parsedDistance = Number(knownDistance);
    const pixels = distanceBetween(calibrationDraft[0], calibrationDraft[1]);

    if (!Number.isFinite(parsedDistance) || parsedDistance <= 0 || pixels <= 0) {
      return;
    }

    setCalibration({
      start: calibrationDraft[0],
      end: calibrationDraft[1],
      knownDistance: parsedDistance,
      unit: unit.trim() || "units",
      pixelsPerUnit: pixels / parsedDistance,
    });

    setMeasurementDraft(null);
    setToolMode("measure");
  }

  function handleCanvasClick(clientX: number, clientY: number) {
    const point = screenToImage(clientX, clientY);

    if (!point || !imageAsset) {
      return;
    }

    if (toolMode === "calibrate") {
      setMeasurementDraft(null);
      setCalibrationDraft((current) => (current.length >= 2 ? [point] : [...current, point]));
      return;
    }

    if (toolMode === "measure" && calibration) {
      if (!measurementDraft) {
        setMeasurementDraft(point);
        return;
      }

      const value = distanceBetween(measurementDraft, point) / calibration.pixelsPerUnit;

      setMeasurements((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          name: makeMeasurementName(current.length),
          start: measurementDraft,
          end: point,
          value,
          unit: calibration.unit,
          color: MEASUREMENT_COLORS[current.length % MEASUREMENT_COLORS.length],
        },
      ]);

      setMeasurementDraft(null);
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (toolMode !== "navigate" || !imageAsset) {
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const activeDrag = dragRef.current;

    if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - activeDrag.x;
    const deltaY = event.clientY - activeDrag.y;
    const moved = activeDrag.moved || Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1;

    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved,
    };

    setPan((current) => ({
      x: current.x + deltaX,
      y: current.y + deltaY,
    }));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      suppressClickRef.current = dragRef.current.moved;
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function applyZoom(nextZoom: number, anchor?: { x: number; y: number }) {
    if (!imageAsset) {
      return;
    }

    const boundedZoom = clamp(nextZoom, 0.25, 20);

    if (Math.abs(boundedZoom - zoom) < 0.0001) {
      return;
    }

    const anchorPoint = anchor ?? {
      x: viewport.width / 2,
      y: viewport.height / 2,
    };

    const imagePoint = {
      x: (anchorPoint.x - stageX) / (fitScale * zoom),
      y: (anchorPoint.y - stageY) / (fitScale * zoom),
    };

    const nextScale = fitScale * boundedZoom;
    const nextRenderedWidth = imageAsset.width * nextScale;
    const nextRenderedHeight = imageAsset.height * nextScale;

    setZoom(boundedZoom);
    setPan({
      x: anchorPoint.x - (viewport.width - nextRenderedWidth) / 2 - imagePoint.x * nextScale,
      y: anchorPoint.y - (viewport.height - nextRenderedHeight) / 2 - imagePoint.y * nextScale,
    });
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!imageAsset) {
      return;
    }

    event.preventDefault();

    const sensitivity = event.ctrlKey ? 0.0024 : 0.0012;
    const rect = viewportRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    applyZoom(zoom * Math.exp(-event.deltaY * sensitivity), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  function zoomIn() {
    applyZoom(zoom * 1.2);
  }

  function zoomOut() {
    applyZoom(zoom / 1.2);
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function clearDrafts() {
    setCalibrationDraft([]);
    setMeasurementDraft(null);
  }

  function removeMeasurement(id: string) {
    setMeasurements((current) => current.filter((measurement) => measurement.id !== id));
  }

  async function exportAnnotatedImage(format: "png" | "jpeg") {
    if (!imageAsset) {
      return;
    }

    const image = new window.Image();
    image.src = imageAsset.src;

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("No se pudo cargar la imagen para exportar."));
    });

    const canvas = document.createElement("canvas");
    canvas.width = imageAsset.width;
    canvas.height = imageAsset.height;

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.drawImage(image, 0, 0, imageAsset.width, imageAsset.height);

    for (const measurement of measurements) {
      drawMeasurement(context, measurement.start, measurement.end, {
        label: `${measurement.name} - ${formatNumber(measurement.value)} ${measurement.unit}`,
        color: measurement.color,
      });
    }

    if (showScaleBar && calibration) {
      drawScaleBar(context, imageAsset.width, imageAsset.height, calibration);
    }

    const link = document.createElement("a");
    const baseName = imageAsset.name.replace(/\.[^.]+$/, "");
    link.href =
      format === "jpeg" ? canvas.toDataURL("image/jpeg", 0.92) : canvas.toDataURL("image/png");
    link.download = `${baseName}-mediciones.${format === "jpeg" ? "jpg" : "png"}`;
    link.click();
  }

  const draftCalibrationPixels =
    calibrationDraft.length === 2 ? distanceBetween(calibrationDraft[0], calibrationDraft[1]) : 0;

  const viewerPhysicalWidth =
    calibration && fitScale > 0 && zoom > 0
      ? viewport.width / (fitScale * zoom * calibration.pixelsPerUnit)
      : 0;

  const scaleBarUnits = calibration ? niceScaleLength(viewerPhysicalWidth * 0.22) : 0;
  const scaleBarPixels = calibration ? scaleBarUnits * calibration.pixelsPerUnit : 0;

  return (
    <div className={styles.page}>
      <input
        ref={fileInputRef}
        className={styles.hiddenInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/tiff"
        onChange={handleFileChange}
      />

      <main className={styles.shell}>
        <section className={styles.workspace}>
          <aside className={styles.sidebar}>
            <button className={styles.primaryButton} onClick={openFilePicker}>
              {imageAsset ? "Cambiar imagen" : "Subir imagen"}
            </button>

            <div className={styles.block}>
              <div className={styles.label}>Herramienta</div>
              <div className={styles.toolGrid}>
                {(["navigate", "calibrate", "measure"] as ToolMode[]).map((mode) => (
                  <button
                    key={mode}
                    className={mode === toolMode ? styles.toolButtonActive : styles.toolButton}
                    onClick={() => setToolMode(mode)}
                    disabled={mode === "measure" && !calibration}
                  >
                    {TOOL_LABELS[mode]}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.block}>
              <div className={styles.label}>Calibracion</div>
              <div className={styles.formRow}>
                <input
                  value={knownDistance}
                  onChange={(event) => setKnownDistance(event.target.value)}
                  inputMode="decimal"
                  placeholder="Distancia"
                />
                <input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Unidad" />
              </div>
              <div className={styles.metaRow}>
                <span>Puntos</span>
                <strong>{calibrationDraft.length}/2</strong>
              </div>
              <div className={styles.metaRow}>
                <span>Pixels</span>
                <strong>{draftCalibrationPixels ? formatPixels(draftCalibrationPixels) : "-"}</strong>
              </div>
              <div className={styles.buttonStack}>
                <button
                  className={styles.secondaryButton}
                  onClick={applyCalibration}
                  disabled={calibrationDraft.length !== 2}
                >
                  Aplicar escala
                </button>
                <button className={styles.ghostButton} onClick={clearDrafts}>
                  Limpiar puntos
                </button>
              </div>
            </div>

            <div className={styles.block}>
              <div className={styles.label}>Salida</div>
              <div className={styles.buttonStack}>
                <button
                  className={styles.secondaryButton}
                  onClick={() => exportAnnotatedImage("png")}
                  disabled={!imageAsset}
                >
                  Exportar PNG
                </button>
                <button
                  className={styles.secondaryButton}
                  onClick={() => exportAnnotatedImage("jpeg")}
                  disabled={!imageAsset}
                >
                  Exportar JPG
                </button>
                <button className={styles.ghostButton} onClick={() => setShowScaleBar((current) => !current)} disabled={!calibration}>
                  {showScaleBar ? "Ocultar escala" : "Mostrar escala"}
                </button>
                <button className={styles.ghostButton} onClick={resetView} disabled={!imageAsset}>
                  Reset vista
                </button>
              </div>
            </div>
          </aside>

          <section className={styles.viewerColumn}>
            <div className={styles.viewerTopbar}>
              <div className={styles.statusCluster}>
                <span>{imageAsset?.name ?? "Sin imagen"}</span>
                {imageAsset ? <span>{imageAsset.width} x {imageAsset.height}</span> : null}
              </div>
              <div className={styles.statusCluster}>
                <button className={styles.zoomButton} onClick={zoomOut} disabled={!imageAsset}>
                  -
                </button>
                <button className={styles.zoomButton} onClick={zoomIn} disabled={!imageAsset}>
                  +
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                {calibration ? <span>1 {calibration.unit} = {formatPixels(calibration.pixelsPerUnit)}</span> : null}
              </div>
            </div>

            <div
              ref={viewportRef}
              className={styles.viewer}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onWheel={handleWheel}
              onClick={(event) => {
                if (toolMode === "navigate" || suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }

                handleCanvasClick(event.clientX, event.clientY);
              }}
              data-mode={toolMode}
            >
              {imageAsset ? (
                <div
                  className={styles.stage}
                  style={{
                    width: `${renderedWidth}px`,
                    height: `${renderedHeight}px`,
                    left: `${stageX}px`,
                    top: `${stageY}px`,
                  }}
                >
                  <Image
                    className={styles.stageImage}
                    src={imageAsset.src}
                    alt="Microscopy sample"
                    width={imageAsset.width}
                    height={imageAsset.height}
                    unoptimized
                  />

                  <svg className={styles.stageOverlay} viewBox={`0 0 ${imageAsset.width} ${imageAsset.height}`}>
                    {calibration && (
                      <MeasurementLine
                        start={calibration.start}
                        end={calibration.end}
                        label={`${formatNumber(calibration.knownDistance)} ${calibration.unit}`}
                        color="#f4d35e"
                        dashed
                      />
                    )}

                    {calibrationDraft.length === 2 && !calibration && (
                      <MeasurementLine
                        start={calibrationDraft[0]}
                        end={calibrationDraft[1]}
                        label={formatPixels(draftCalibrationPixels)}
                        color="#f4d35e"
                        dashed
                      />
                    )}

                    {calibrationDraft.length === 1 && (
                      <PointHandle point={calibrationDraft[0]} color="#f4d35e" />
                    )}

                    {measurements.map((measurement) => (
                      <MeasurementLine
                        key={measurement.id}
                        start={measurement.start}
                        end={measurement.end}
                        label={`${measurement.name} - ${formatNumber(measurement.value)} ${measurement.unit}`}
                        color={measurement.color}
                      />
                    ))}

                    {measurementDraft && <PointHandle point={measurementDraft} color="#ffb347" />}
                  </svg>

                  {showScaleBar && calibration && scaleBarPixels > 0 ? (
                    <div className={styles.scaleBar} style={{ width: `${scaleBarPixels * fitScale * zoom}px` }}>
                      <span>
                        {formatNumber(scaleBarUnits)} {calibration.unit}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className={styles.viewerEmpty}>Sube una imagen para empezar.</div>
              )}
            </div>

            <div className={styles.viewerHint}>
              <span>Trackpad o rueda: zoom suave</span>
              <span>Modo mover: arrastrar</span>
              <span>Modo calibrar o medir: dos clics</span>
            </div>
          </section>

          <aside className={styles.sidebar}>
            <div className={styles.block}>
              <div className={styles.label}>Mediciones</div>
              {measurements.length ? (
                <div className={styles.measurementList}>
                  {measurements.map((measurement) => (
                    <div key={measurement.id} className={styles.measurementItem}>
                      <div>
                        <strong>{measurement.name}</strong>
                        <span>
                          {formatNumber(measurement.value)} {measurement.unit}
                        </span>
                      </div>
                      <button onClick={() => removeMeasurement(measurement.id)}>Quitar</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>Sin mediciones</div>
              )}
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

function PointHandle({ point, color }: { point: Point; color: string }) {
  return (
    <g>
      <circle cx={point.x} cy={point.y} r="10" fill={color} fillOpacity="0.18" />
      <circle cx={point.x} cy={point.y} r="4.5" fill={color} />
    </g>
  );
}

function MeasurementLine({
  start,
  end,
  label,
  color,
  dashed = false,
}: {
  start: Point;
  end: Point;
  label: string;
  color: string;
  dashed?: boolean;
}) {
  const labelPosition = lineLabelPosition(start, end, 24);

  return (
    <g>
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={dashed ? "8 6" : "0"}
      />
      <circle cx={start.x} cy={start.y} r="4.5" fill={color} />
      <circle cx={end.x} cy={end.y} r="4.5" fill={color} />
      <g transform={`translate(${labelPosition.x} ${labelPosition.y})`}>
        <rect
          x="-74"
          y="-16"
          width="148"
          height="32"
          rx="16"
          fill="rgba(6, 10, 17, 0.84)"
          stroke="rgba(255, 255, 255, 0.08)"
        />
        <text x="0" y="4" textAnchor="middle" fill="#f9f6ef" fontSize="12" fontWeight="600">
          {label}
        </text>
      </g>
    </g>
  );
}

function drawMeasurement(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  options: { label: string; color: string; dashed?: boolean },
) {
  const labelPosition = lineLabelPosition(start, end, 28);

  context.save();
  context.strokeStyle = options.color;
  context.fillStyle = options.color;
  context.lineWidth = 4;
  context.lineCap = "round";
  context.setLineDash(options.dashed ? [12, 8] : []);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.setLineDash([]);

  for (const point of [start, end]) {
    context.beginPath();
    context.arc(point.x, point.y, 7, 0, Math.PI * 2);
    context.fill();
  }

  const labelWidth = 196;
  const labelHeight = 40;
  context.fillStyle = "rgba(6, 10, 17, 0.84)";
  roundRect(context, labelPosition.x - labelWidth / 2, labelPosition.y - labelHeight / 2, labelWidth, labelHeight, 18);
  context.fill();

  context.fillStyle = "#f9f6ef";
  context.font = "600 16px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(options.label, labelPosition.x, labelPosition.y + 1);
  context.restore();
}

function drawScaleBar(
  context: CanvasRenderingContext2D,
  imageWidth: number,
  imageHeight: number,
  calibration: Calibration,
) {
  const physicalWidth = imageWidth / calibration.pixelsPerUnit;
  const scaleUnits = niceScaleLength(physicalWidth * 0.22);
  const scalePixels = scaleUnits * calibration.pixelsPerUnit;
  const x = 38;
  const y = imageHeight - 42;

  context.save();
  context.fillStyle = "rgba(7, 11, 18, 0.7)";
  roundRect(context, x - 16, y - 38, Math.max(scalePixels + 32, 170), 56, 20);
  context.fill();

  context.strokeStyle = "#f9f6ef";
  context.lineWidth = 4;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + scalePixels, y);
  context.stroke();

  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(x, y - 8);
  context.lineTo(x, y + 8);
  context.moveTo(x + scalePixels, y - 8);
  context.lineTo(x + scalePixels, y + 8);
  context.stroke();

  context.fillStyle = "#f9f6ef";
  context.font = "600 16px sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(`${formatNumber(scaleUnits)} ${calibration.unit}`, x, y - 18);
  context.restore();
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}
