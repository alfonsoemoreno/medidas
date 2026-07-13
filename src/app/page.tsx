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

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
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
  start?: Point | null;
  end?: Point | null;
  knownDistance: number;
  unit: string;
  pixelsPerUnit: number;
};

type SavedCalibrationPreset = {
  id: string;
  name: string;
  knownDistance: number;
  unit: string;
  pixelsPerUnit: number;
  imageName?: string;
  imageWidth?: number;
  imageHeight?: number;
  createdAt: number;
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
  labelHeight: number;
  labelRadius: number;
  labelFontSize: number;
  labelPaddingX: number;
  labelPaddingY: number;
  labelMinWidth: number;
  scaleBarThickness: number;
  scaleBarTickHeight: number;
  scaleBarLabelFontSize: number;
  scaleBarLabelPaddingX: number;
  scaleBarLabelPaddingY: number;
};

type OverlayScaleMetrics = {
  scaleBarThickness: number;
  scaleBarTickHeight: number;
  scaleBarLabelFontSize: number;
  scaleBarLabelPaddingX: number;
  scaleBarLabelPaddingY: number;
  scaleBarMarginX: number;
  scaleBarMarginBottom: number;
  scaleBarLabelGap: number;
};

const TOOL_LABELS: Record<ToolMode, string> = {
  navigate: "Mover",
  calibrate: "Calibrar",
  measure: "Medir",
};

const MEASUREMENT_COLORS = ["#fc6f59", "#ffb347", "#4cd7b2", "#6cb8ff", "#ffe27a"];
const SAVED_CALIBRATIONS_KEY = "medidas.saved-calibrations";
const LAST_CALIBRATION_KEY = "medidas.last-calibration";

function ZoomIcon({ type }: { type: "in" | "out" }) {
  return (
    <svg
      className={styles.zoomIcon}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 10h10" />
      {type === "in" ? <path d="M10 5v10" /> : null}
    </svg>
  );
}

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

function makeCalibrationPresetName(name: string | undefined, total: number) {
  const cleaned = name?.replace(/\.[^.]+$/, "").trim();
  return cleaned ? `${cleaned} · escala` : `Calibracion ${String(total + 1).padStart(2, "0")}`;
}

function toCalibrationPreset(
  calibration: Calibration,
  imageAsset: ImageAsset | null,
  name: string,
): SavedCalibrationPreset {
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    knownDistance: calibration.knownDistance,
    unit: calibration.unit,
    pixelsPerUnit: calibration.pixelsPerUnit,
    imageName: imageAsset?.name,
    imageWidth: imageAsset?.width,
    imageHeight: imageAsset?.height,
    createdAt: Date.now(),
  };
}

function applyCalibrationPresetValues(preset: SavedCalibrationPreset): Calibration {
  return {
    knownDistance: preset.knownDistance,
    unit: preset.unit,
    pixelsPerUnit: preset.pixelsPerUnit,
    start: null,
    end: null,
  };
}

function createAnnotationMetrics(
  imageAsset: ImageAsset | null,
  multiplier: { labels: number; lines: number; scale: number },
  displayScale = 1,
): AnnotationMetrics {
  const normalizedScale = Math.max(displayScale, 0.08);
  const toImageSpace = (screenPixels: number, factor: number, min: number, max: number) =>
    clamp((screenPixels * factor) / normalizedScale, min, max);

  return {
    lineWidth: toImageSpace(2.2, multiplier.lines, 1, 40),
    pointRadius: toImageSpace(4.2, multiplier.lines, 2, 56),
    pointHaloRadius: toImageSpace(8.4, multiplier.lines, 4, 96),
    labelOffset: toImageSpace(24, multiplier.labels, 12, 220),
    labelHeight: toImageSpace(28, multiplier.labels, 20, 160),
    labelRadius: toImageSpace(14, multiplier.labels, 10, 72),
    labelFontSize: toImageSpace(11.5, multiplier.labels, 9, 88),
    labelPaddingX: toImageSpace(11, multiplier.labels, 8, 60),
    labelPaddingY: toImageSpace(6, multiplier.labels, 4, 36),
    labelMinWidth: toImageSpace(84, multiplier.labels, 64, 520),
    scaleBarThickness: toImageSpace(3.8, multiplier.scale, 1.5, 24),
    scaleBarTickHeight: toImageSpace(16, multiplier.scale, 8, 72),
    scaleBarLabelFontSize: toImageSpace(12, multiplier.scale, 8, 56),
    scaleBarLabelPaddingX: toImageSpace(10, multiplier.scale, 5, 36),
    scaleBarLabelPaddingY: toImageSpace(7, multiplier.scale, 4, 24),
  };
}

function getLabelBox(label: string, metrics: AnnotationMetrics) {
  const estimatedTextWidth = label.length * metrics.labelFontSize * 0.58;

  return {
    width: Math.max(metrics.labelMinWidth, estimatedTextWidth + metrics.labelPaddingX * 2),
    height: metrics.labelHeight,
    radius: Math.max(metrics.labelRadius, metrics.labelHeight / 2),
  };
}

function createOverlayScaleMetrics(multiplier: number, scaleFactor = 1): OverlayScaleMetrics {
  return {
    scaleBarThickness: clamp(4 * multiplier * scaleFactor, 3, 32),
    scaleBarTickHeight: clamp(18 * multiplier * scaleFactor, 12, 96),
    scaleBarLabelFontSize: clamp(14 * multiplier * scaleFactor, 11, 72),
    scaleBarLabelPaddingX: clamp(12 * multiplier * scaleFactor, 8, 56),
    scaleBarLabelPaddingY: clamp(8 * multiplier * scaleFactor, 5, 36),
    scaleBarMarginX: clamp(26 * scaleFactor, 18, 140),
    scaleBarMarginBottom: clamp(26 * scaleFactor, 18, 140),
    scaleBarLabelGap: clamp(8 * scaleFactor, 6, 36),
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
  const [savedCalibrations, setSavedCalibrations] = useState<SavedCalibrationPreset[]>([]);
  const [lastCalibration, setLastCalibration] = useState<SavedCalibrationPreset | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [labelSize, setLabelSize] = useState(1);
  const [lineSize, setLineSize] = useState(1);
  const [scaleSize, setScaleSize] = useState(1);
  const [isOffline, setIsOffline] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const storedPresets = window.localStorage.getItem(SAVED_CALIBRATIONS_KEY);
        const parsedPresets = storedPresets ? (JSON.parse(storedPresets) as SavedCalibrationPreset[]) : [];
        setSavedCalibrations(Array.isArray(parsedPresets) ? parsedPresets : []);
      } catch {
        setSavedCalibrations([]);
      }

      try {
        const storedLast = window.localStorage.getItem(LAST_CALIBRATION_KEY);
        setLastCalibration(storedLast ? (JSON.parse(storedLast) as SavedCalibrationPreset) : null);
      } catch {
        setLastCalibration(null);
      }

      setStorageReady(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    setIsOffline(!navigator.onLine);

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const syncInstalledState = () => {
      setIsInstalled(mediaQuery.matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true);
    };

    syncInstalledState();
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    mediaQuery.addEventListener("change", syncInstalledState);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      mediaQuery.removeEventListener("change", syncInstalledState);
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }).catch(() => {
      // Ignore registration failures; the app should remain usable online.
    });
  }, []);

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

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    window.localStorage.setItem(SAVED_CALIBRATIONS_KEY, JSON.stringify(savedCalibrations));
  }, [savedCalibrations, storageReady]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    if (!lastCalibration) {
      window.localStorage.removeItem(LAST_CALIBRATION_KEY);
      return;
    }

    window.localStorage.setItem(LAST_CALIBRATION_KEY, JSON.stringify(lastCalibration));
  }, [lastCalibration, storageReady]);

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

    const nextCalibration = {
      start: calibrationDraft[0],
      end: calibrationDraft[1],
      knownDistance: parsedDistance,
      unit: unit.trim() || "units",
      pixelsPerUnit: pixels / parsedDistance,
    };

    setCalibration(nextCalibration);
    setLastCalibration(
      toCalibrationPreset(
        nextCalibration,
        imageAsset,
        makeCalibrationPresetName(imageAsset?.name, savedCalibrations.length),
      ),
    );

    setMeasurementDraft(null);
    setToolMode("measure");
  }

  function applySavedCalibration(preset: SavedCalibrationPreset) {
    setCalibration(applyCalibrationPresetValues(preset));
    setKnownDistance(String(preset.knownDistance));
    setUnit(preset.unit);
    setCalibrationDraft([]);
    setMeasurementDraft(null);
    setShowScaleBar(true);
    setToolMode("measure");
    setLastCalibration(preset);
  }

  function saveCurrentCalibration() {
    if (!calibration) {
      return;
    }

    const nextName = presetName.trim() || makeCalibrationPresetName(imageAsset?.name, savedCalibrations.length);
    const preset = toCalibrationPreset(calibration, imageAsset, nextName);

    setSavedCalibrations((current) => [preset, ...current].slice(0, 12));
    setLastCalibration(preset);
    setPresetName("");
  }

  function removeSavedCalibration(id: string) {
    setSavedCalibrations((current) => current.filter((preset) => preset.id !== id));

    if (lastCalibration?.id === id) {
      setLastCalibration(null);
    }
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

  async function installApp() {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;

    if (choice.outcome === "accepted") {
      setIsInstalled(true);
    }

    setInstallPrompt(null);
  }

  const draftCalibrationPixels =
    calibrationDraft.length === 2 ? distanceBetween(calibrationDraft[0], calibrationDraft[1]) : 0;
  const displayScale = fitScale * zoom;
  const screenMetrics = createAnnotationMetrics(
    imageAsset,
    { labels: labelSize, lines: lineSize, scale: scaleSize },
    displayScale,
  );
  const overlayScaleMetrics = createOverlayScaleMetrics(scaleSize);
  const exportMeasurementMetrics = createAnnotationMetrics(
    imageAsset,
    { labels: labelSize, lines: lineSize, scale: scaleSize },
    fitScale,
  );
  const exportScaleMetrics = createOverlayScaleMetrics(
    scaleSize,
    displayScale > 0 ? 1 / displayScale : 1,
  );

  const viewerPhysicalWidth =
    calibration && fitScale > 0 && zoom > 0
      ? viewport.width / (fitScale * zoom * calibration.pixelsPerUnit)
      : 0;

  const scaleBarUnits = calibration ? niceScaleLength(viewerPhysicalWidth * 0.16) : 0;
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
            <div className={styles.brandPanel}>
              <div className={styles.sidebarBrand}>
                <Image src="/icon.png" alt="Escala y Medición" width={188} height={188} priority />
              </div>
              <div className={styles.brandTextBlock}>
                <strong>Escala y Medición</strong>
                <span>Calibración profesional y medición visual para imágenes de microscopio.</span>
              </div>
              <button className={styles.primaryButton} onClick={openFilePicker}>
                {imageAsset ? "Cambiar imagen" : "Subir imagen"}
              </button>
              {installPrompt && !isInstalled ? (
                <button className={styles.secondaryButton} onClick={installApp}>
                  Instalar app
                </button>
              ) : null}
              <p className={styles.installHint}>
                {isInstalled
                  ? "Instalada. Tras la primera carga, puede funcionar sin conexión."
                  : "Ábrela una vez con internet y luego podrás usarla sin conexión."}
              </p>
            </div>

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
              {calibration ? (
                <div className={styles.metaRow}>
                  <span>Actual</span>
                  <strong>
                    {formatNumber(calibration.knownDistance)} {calibration.unit}
                  </strong>
                </div>
              ) : null}
              <div className={styles.buttonStack}>
                <button
                  className={styles.secondaryButton}
                  onClick={applyCalibration}
                  disabled={calibrationDraft.length !== 2}
                >
                  Aplicar escala
                </button>
                <div className={styles.presetSaveRow}>
                  <label className={styles.presetNameField}>
                    <span>Nombre de calibracion</span>
                    <input
                      value={presetName}
                      onChange={(event) => setPresetName(event.target.value)}
                      placeholder="Ej. Regla 10 mm"
                      disabled={!calibration}
                    />
                  </label>
                  <button className={styles.ghostButton} onClick={saveCurrentCalibration} disabled={!calibration}>
                    Guardar
                  </button>
                </div>
                <button
                  className={styles.ghostButton}
                  onClick={() => lastCalibration && applySavedCalibration(lastCalibration)}
                  disabled={!lastCalibration}
                >
                  Recuperar ultima
                </button>
                <button className={styles.ghostButton} onClick={clearDrafts}>
                  Limpiar puntos
                </button>
              </div>
              {savedCalibrations.length ? (
                <div className={styles.presetList}>
                  {savedCalibrations.map((preset) => (
                    <div key={preset.id} className={styles.presetItem}>
                      <div className={styles.presetContent}>
                        <strong>{preset.name}</strong>
                        <span>
                          {formatNumber(preset.knownDistance)} {preset.unit} · {formatPixels(preset.pixelsPerUnit)}
                        </span>
                        {preset.imageName ? <em>{preset.imageName}</em> : null}
                      </div>
                      <div className={styles.presetActions}>
                        <button className={styles.ghostButton} onClick={() => applySavedCalibration(preset)}>
                          Usar
                        </button>
                        <button className={styles.presetDeleteButton} onClick={() => removeSavedCalibration(preset.id)}>
                          Quitar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
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
                <span className={isOffline ? styles.statusOffline : styles.statusOnline}>
                  {isOffline ? "Sin conexión" : "En línea"}
                </span>
                <span>{imageAsset?.name ?? "Sin imagen"}</span>
                {imageAsset ? <span>{imageAsset.width} x {imageAsset.height}</span> : null}
              </div>
              <div className={styles.statusCluster}>
                <button
                  className={styles.zoomButton}
                  onClick={zoomOut}
                  disabled={!imageAsset}
                  aria-label="Alejar"
                >
                  <ZoomIcon type="out" />
                </button>
                <button
                  className={styles.zoomButton}
                  onClick={zoomIn}
                  disabled={!imageAsset}
                  aria-label="Acercar"
                >
                  <ZoomIcon type="in" />
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
                    {calibration?.start && calibration?.end && (
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
                        height: `${overlayScaleMetrics.scaleBarThickness}px`,
                        boxShadow: `0 0 0 ${Math.max(overlayScaleMetrics.scaleBarThickness / 2, 1)}px rgba(7, 11, 18, 0.28)`,
                        ["--tick-height" as string]: `${overlayScaleMetrics.scaleBarTickHeight}px`,
                        ["--tick-width" as string]: `${Math.max(overlayScaleMetrics.scaleBarThickness * 0.75, 2)}px`,
                      }}
                    >
                      <span
                        style={{
                          fontSize: `${overlayScaleMetrics.scaleBarLabelFontSize}px`,
                          padding: `${overlayScaleMetrics.scaleBarLabelPaddingY}px ${overlayScaleMetrics.scaleBarLabelPaddingX}px`,
                        }}
                      >
                        {formatNumber(scaleBarUnits)} {calibration.unit}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className={styles.viewerEmpty}>
                  <Image
                    className={styles.viewerEmptyLogo}
                    src="/icon.png"
                    alt=""
                    width={132}
                    height={132}
                    aria-hidden="true"
                    priority
                  />
                  <strong>Sube una imagen para empezar</strong>
                  <span>Calibra escalas, registra mediciones y exporta resultados con una vista limpia.</span>
                </div>
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
                      <div className={styles.measurementContent}>
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
  const labelBox = getLabelBox(label, metrics);

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
          x={-labelBox.width / 2}
          y={-labelBox.height / 2}
          width={labelBox.width}
          height={labelBox.height}
          rx={labelBox.radius}
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
  const labelBox = getLabelBox(options.label, options.metrics);

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

  context.fillStyle = "rgba(6, 10, 17, 0.84)";
  roundRect(
    context,
    labelPosition.x - labelBox.width / 2,
    labelPosition.y - labelBox.height / 2,
    labelBox.width,
    labelBox.height,
    labelBox.radius,
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
  metrics: OverlayScaleMetrics,
) {
  const x = metrics.scaleBarMarginX;
  const bottomMargin = Math.max(metrics.scaleBarMarginBottom, metrics.scaleBarTickHeight + metrics.scaleBarThickness + 10);
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
  const labelY = barY - metrics.scaleBarTickHeight - labelHeight - metrics.scaleBarLabelGap;

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
