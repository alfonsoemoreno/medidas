"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "./page.module.css";

type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
};

type SaveFileHandle = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

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

type AnnotationMetrics = {
  lineWidth: number;
  pointRadius: number;
  pointHaloRadius: number;
  labelOffset: number;
  labelWidth: number;
  labelHeight: number;
  labelRadius: number;
  labelFontSize: number;
  scaleBarThickness: number;
  scaleBarTickHeight: number;
  scaleBarLabelFontSize: number;
  scaleBarLabelPaddingX: number;
  scaleBarLabelPaddingY: number;
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
  let formatted = "";

  if (value >= 100) {
    formatted = value.toFixed(1);
  } else if (value >= 10) {
    formatted = value.toFixed(2);
  } else {
    formatted = value.toFixed(3);
  }

  return formatted.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
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

function createAnnotationMetrics(
  imageAsset: ImageAsset | null,
  multiplier: { labels: number; lines: number; scale: number },
  displayScale = 1,
): AnnotationMetrics {
  const normalizedScale = Math.max(displayScale, 0.08);
  const base = clamp(1 / Math.sqrt(normalizedScale), 0.72, 3.4);

  return {
    lineWidth: Math.max(0.8, 2.2 * base * multiplier.lines),
    pointRadius: Math.max(1.8, 4.2 * base * multiplier.lines),
    pointHaloRadius: Math.max(3.5, 8.4 * base * multiplier.lines),
    labelOffset: Math.max(8, 22 * base * multiplier.labels),
    labelWidth: Math.max(52, 136 * base * multiplier.labels),
    labelHeight: Math.max(18, 30 * base * multiplier.labels),
    labelRadius: Math.max(8, 14 * base * multiplier.labels),
    labelFontSize: Math.max(7, 11.5 * base * multiplier.labels),
    scaleBarThickness: Math.max(1.5, 3.8 * base * multiplier.scale),
    scaleBarTickHeight: Math.max(8, 16 * base * multiplier.scale),
    scaleBarLabelFontSize: Math.max(8, 12 * base * multiplier.scale),
    scaleBarLabelPaddingX: Math.max(5, 10 * base * multiplier.scale),
    scaleBarLabelPaddingY: Math.max(4, 7 * base * multiplier.scale),
  };
}

function scaleOnlyScaleMetrics(metrics: AnnotationMetrics, factor: number): AnnotationMetrics {
  return {
    ...metrics,
    scaleBarThickness: metrics.scaleBarThickness * factor,
    scaleBarTickHeight: metrics.scaleBarTickHeight * factor,
    scaleBarLabelFontSize: metrics.scaleBarLabelFontSize * factor,
    scaleBarLabelPaddingX: metrics.scaleBarLabelPaddingX * factor,
    scaleBarLabelPaddingY: metrics.scaleBarLabelPaddingY * factor,
  };
}

async function canvasToBlob(canvas: HTMLCanvasElement, format: "png" | "jpeg") {
  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  const quality = format === "jpeg" ? 0.92 : undefined;

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("No se pudo generar el archivo de exportacion."));
        return;
      }

      resolve(blob);
    }, mimeType, quality);
  });
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
  const [labelSize, setLabelSize] = useState(1);
  const [lineSize, setLineSize] = useState(1);
  const [scaleSize, setScaleSize] = useState(1);

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

  function updateMeasurementName(id: string, name: string) {
    setMeasurements((current) =>
      current.map((measurement) =>
        measurement.id === id
          ? {
              ...measurement,
              name,
            }
          : measurement,
      ),
    );
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

    const exportScale = 1;
    const exportWidth = imageAsset.width;
    const exportHeight = imageAsset.height;
    const exportScaleBarUnits = scaleBarUnits;
    const exportScaleBarWidth = scaleBarPixels;

    const canvas = document.createElement("canvas");
    canvas.width = exportWidth;
    canvas.height = exportHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, exportWidth, exportHeight);

    for (const measurement of measurements) {
      drawMeasurement(context, measurement.start, measurement.end, {
        label: `${measurement.name} - ${formatNumber(measurement.value)} ${measurement.unit}`,
        color: measurement.color,
        metrics: exportMeasurementMetrics,
        scale: exportScale,
      });
    }

    if (showScaleBar && calibration && exportScaleBarWidth > 0) {
      drawScaleBar(
        context,
        exportWidth,
        exportHeight,
        exportScaleBarWidth,
        `${formatNumber(exportScaleBarUnits)} ${calibration.unit}`,
        exportScaleMetrics,
      );
    }

    const baseName = imageAsset.name.replace(/\.[^.]+$/, "");
    const extension = format === "jpeg" ? "jpg" : "png";
    const suggestedName = `${baseName}-mediciones.${extension}`;
    const blob = await canvasToBlob(canvas, format);
    const windowWithPicker = window as Window & {
      showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>;
    };

    if (windowWithPicker.showSaveFilePicker) {
      try {
        const handle = await windowWithPicker.showSaveFilePicker({
          suggestedName,
          types: [
            {
              description: format === "jpeg" ? "JPEG image" : "PNG image",
              accept: {
                [format === "jpeg" ? "image/jpeg" : "image/png"]: [`.${extension}`],
              },
            },
          ],
        });

        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (error) {
        const maybeAbort = error as DOMException;

        if (maybeAbort?.name === "AbortError") {
          return;
        }
      }
    }

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = suggestedName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  const draftCalibrationPixels =
    calibrationDraft.length === 2 ? distanceBetween(calibrationDraft[0], calibrationDraft[1]) : 0;
  const displayScale = fitScale * zoom;
  const screenMetrics = createAnnotationMetrics(
    imageAsset,
    { labels: labelSize, lines: lineSize, scale: scaleSize },
    displayScale,
  );
  const exportMeasurementMetrics = createAnnotationMetrics(
    imageAsset,
    { labels: labelSize, lines: lineSize, scale: scaleSize },
    fitScale,
  );
  const exportScaleMetrics = scaleOnlyScaleMetrics(
    screenMetrics,
    fitScale > 0 ? 1 / fitScale : 1,
  );

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

            <div className={styles.block}>
              <div className={styles.label}>Tamano</div>
              <div className={styles.sliderGroup}>
                <label className={styles.sliderField}>
                  <span>Etiquetas</span>
                  <input
                    type="range"
                    min="0.2"
                    max="4"
                    step="0.1"
                    value={labelSize}
                    onChange={(event) => setLabelSize(Number(event.target.value))}
                  />
                  <strong>{labelSize.toFixed(1)}x</strong>
                </label>
                <label className={styles.sliderField}>
                  <span>Lineas</span>
                  <input
                    type="range"
                    min="0.2"
                    max="4"
                    step="0.1"
                    value={lineSize}
                    onChange={(event) => setLineSize(Number(event.target.value))}
                  />
                  <strong>{lineSize.toFixed(1)}x</strong>
                </label>
                <label className={styles.sliderField}>
                  <span>Escala</span>
                  <input
                    type="range"
                    min="0.2"
                    max="4"
                    step="0.1"
                    value={scaleSize}
                    onChange={(event) => setScaleSize(Number(event.target.value))}
                  />
                  <strong>{scaleSize.toFixed(1)}x</strong>
                </label>
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
                    draggable={false}
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
                        metrics={screenMetrics}
                      />
                    )}

                    {calibrationDraft.length === 2 && !calibration && (
                      <MeasurementLine
                        start={calibrationDraft[0]}
                        end={calibrationDraft[1]}
                        label={formatPixels(draftCalibrationPixels)}
                        color="#f4d35e"
                        dashed
                        metrics={screenMetrics}
                      />
                    )}

                    {calibrationDraft.length === 1 && (
                      <PointHandle point={calibrationDraft[0]} color="#f4d35e" metrics={screenMetrics} />
                    )}

                    {measurements.map((measurement) => (
                      <MeasurementLine
                        key={measurement.id}
                        start={measurement.start}
                        end={measurement.end}
                        label={`${measurement.name} - ${formatNumber(measurement.value)} ${measurement.unit}`}
                        color={measurement.color}
                        metrics={screenMetrics}
                      />
                    ))}

                    {measurementDraft && (
                      <PointHandle point={measurementDraft} color="#ffb347" metrics={screenMetrics} />
                    )}
                  </svg>

                  {showScaleBar && calibration && scaleBarPixels > 0 ? (
                    <div
                      className={styles.scaleBar}
                      style={{
                        width: `${scaleBarPixels * fitScale * zoom}px`,
                        height: `${screenMetrics.scaleBarThickness}px`,
                        boxShadow: `0 0 0 ${Math.max(screenMetrics.scaleBarThickness / 2, 1)}px rgba(7, 11, 18, 0.28)`,
                        ["--tick-height" as string]: `${screenMetrics.scaleBarTickHeight}px`,
                        ["--tick-width" as string]: `${Math.max(screenMetrics.scaleBarThickness * 0.75, 2)}px`,
                      }}
                    >
                      <span
                        style={{
                          fontSize: `${screenMetrics.scaleBarLabelFontSize}px`,
                          padding: `${screenMetrics.scaleBarLabelPaddingY}px ${screenMetrics.scaleBarLabelPaddingX}px`,
                        }}
                      >
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
                        <input
                          className={styles.measurementNameInput}
                          value={measurement.name}
                          onChange={(event) => updateMeasurementName(measurement.id, event.target.value)}
                          aria-label="Nombre de medicion"
                        />
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

function PointHandle({
  point,
  color,
  metrics,
}: {
  point: Point;
  color: string;
  metrics: AnnotationMetrics;
}) {
  return (
    <g>
      <circle cx={point.x} cy={point.y} r={metrics.pointHaloRadius} fill={color} fillOpacity="0.18" />
      <circle cx={point.x} cy={point.y} r={metrics.pointRadius} fill={color} />
    </g>
  );
}

function MeasurementLine({
  start,
  end,
  label,
  color,
  dashed = false,
  metrics,
}: {
  start: Point;
  end: Point;
  label: string;
  color: string;
  dashed?: boolean;
  metrics: AnnotationMetrics;
}) {
  const labelPosition = lineLabelPosition(start, end, metrics.labelOffset);

  return (
    <g>
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke={color}
        strokeWidth={metrics.lineWidth}
        strokeLinecap="round"
        strokeDasharray={dashed ? "8 6" : "0"}
      />
      <circle cx={start.x} cy={start.y} r={metrics.pointRadius} fill={color} />
      <circle cx={end.x} cy={end.y} r={metrics.pointRadius} fill={color} />
      <g transform={`translate(${labelPosition.x} ${labelPosition.y})`}>
        <rect
          x={-metrics.labelWidth / 2}
          y={-metrics.labelHeight / 2}
          width={metrics.labelWidth}
          height={metrics.labelHeight}
          rx={metrics.labelRadius}
          fill="rgba(6, 10, 17, 0.84)"
          stroke="rgba(255, 255, 255, 0.08)"
        />
        <text
          x="0"
          y={metrics.labelFontSize * 0.33}
          textAnchor="middle"
          fill="#f9f6ef"
          fontSize={metrics.labelFontSize}
          fontWeight="600"
        >
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
  options: { label: string; color: string; dashed?: boolean; metrics: AnnotationMetrics; scale?: number },
) {
  const scale = options.scale ?? 1;
  const scaledStart = { x: start.x * scale, y: start.y * scale };
  const scaledEnd = { x: end.x * scale, y: end.y * scale };
  const labelPosition = lineLabelPosition(scaledStart, scaledEnd, options.metrics.labelOffset);

  context.save();
  context.strokeStyle = options.color;
  context.fillStyle = options.color;
  context.lineWidth = options.metrics.lineWidth;
  context.lineCap = "round";
  context.setLineDash(options.dashed ? [12, 8] : []);
  context.beginPath();
  context.moveTo(scaledStart.x, scaledStart.y);
  context.lineTo(scaledEnd.x, scaledEnd.y);
  context.stroke();
  context.setLineDash([]);

  for (const point of [scaledStart, scaledEnd]) {
    context.beginPath();
    context.arc(point.x, point.y, options.metrics.pointRadius, 0, Math.PI * 2);
    context.fill();
  }

  const labelWidth = options.metrics.labelWidth;
  const labelHeight = options.metrics.labelHeight;
  context.fillStyle = "rgba(6, 10, 17, 0.84)";
  roundRect(
    context,
    labelPosition.x - labelWidth / 2,
    labelPosition.y - labelHeight / 2,
    labelWidth,
    labelHeight,
    options.metrics.labelRadius,
  );
  context.fill();

  context.fillStyle = "#f9f6ef";
  context.font = `600 ${Math.round(options.metrics.labelFontSize)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(options.label, labelPosition.x, labelPosition.y + options.metrics.labelFontSize * 0.04);
  context.restore();
}

function drawScaleBar(
  context: CanvasRenderingContext2D,
  _imageWidth: number,
  imageHeight: number,
  scalePixels: number,
  label: string,
  metrics: AnnotationMetrics,
) {
  const x = 26;
  const bottomMargin = Math.max(28, metrics.scaleBarTickHeight + metrics.scaleBarThickness + 10);
  const y = imageHeight - bottomMargin;
  const labelPaddingX = metrics.scaleBarLabelPaddingX;
  const labelPaddingY = metrics.scaleBarLabelPaddingY;
  const labelHeight = metrics.scaleBarLabelFontSize + labelPaddingY * 2;

  context.save();
  context.font = `600 ${Math.round(metrics.scaleBarLabelFontSize)}px sans-serif`;
  const textWidth = context.measureText(label).width;
  const labelWidth = textWidth + labelPaddingX * 2;
  const labelRadius = Math.max(labelHeight / 2, 10);
  const barY = y;
  const labelY = barY - metrics.scaleBarTickHeight - labelHeight - 6;

  context.fillStyle = "rgba(7, 11, 18, 0.52)";
  roundRect(
    context,
    x - 2,
    barY + metrics.scaleBarThickness,
    scalePixels + 4,
    Math.max(metrics.scaleBarThickness * 1.6, 4),
    Math.max(metrics.scaleBarThickness, 2),
  );
  context.fill();

  context.fillStyle = "rgba(7, 11, 18, 0.78)";
  roundRect(context, x - 4, labelY, labelWidth, labelHeight, labelRadius);
  context.fill();

  context.strokeStyle = "#f9f6ef";
  context.lineWidth = metrics.scaleBarThickness;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x, barY);
  context.lineTo(x + scalePixels, barY);
  context.stroke();

  context.lineWidth = Math.max(metrics.scaleBarThickness * 0.75, 2);
  context.beginPath();
  context.moveTo(x, barY - metrics.scaleBarTickHeight / 2);
  context.lineTo(x, barY + metrics.scaleBarTickHeight / 2);
  context.moveTo(x + scalePixels, barY - metrics.scaleBarTickHeight / 2);
  context.lineTo(x + scalePixels, barY + metrics.scaleBarTickHeight / 2);
  context.stroke();

  context.fillStyle = "#f9f6ef";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(label, x + labelPaddingX - 4, labelY + labelHeight / 2 + 0.5);
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
