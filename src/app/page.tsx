"use client";

import { ChangeEvent, useEffect, useEffectEvent, useRef, useState } from "react";
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

type TrackpadGestureEvent = Event & {
  scale: number;
  clientX: number;
  clientY: number;
};

type Point = {
  x: number;
  y: number;
};

type ToolMode = "navigate" | "calibrate" | "measure" | "area";

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
  points: Point[];
  value: number;
  unit: string;
  color: string;
  labelOrientation: MeasurementLabelOrientation;
  endCap: MeasurementEndCap;
  manualLabelPosition: Point | null;
  showLabel: boolean;
};

type MeasurementLabelOrientation = "horizontal" | "aligned";
type MeasurementEndCap = "circle" | "tick";

type AreaMeasurement = {
  id: string;
  name: string;
  points: Point[];
  value: number;
  unit: string;
  color: string;
  manualLabelPosition: Point | null;
  showLabel: boolean;
};

type AreaDisplayUnit = "auto" | "um2" | "mm2" | "cm2" | "m2";
type CalibrationMethod = "points" | "manual";
type CollapsibleSection = "tool" | "calibration" | "size" | "output" | "measurements" | "areas";
type PanelId = CollapsibleSection;
type PanelColumn = "left" | "right";
type PanelLayout = Record<PanelColumn, PanelId[]>;
type DropPosition = "before" | "after";

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
  area: "Area",
};

const TOOL_HINTS: Record<ToolMode, string> = {
  navigate: "Arrastra para recorrer la imagen.",
  calibrate: "Define la escala con 2 puntos o con equivalencia manual.",
  measure: "Marca varios puntos consecutivos y luego cierra la medicion.",
  area: "Marca vertices y luego pulsa \"Cerrar area\".",
};

const MEASUREMENT_COLORS = ["#fc6f59", "#ffb347", "#4cd7b2", "#6cb8ff", "#ffe27a"];
const SAVED_CALIBRATIONS_KEY = "medidas.saved-calibrations";
const LAST_CALIBRATION_KEY = "medidas.last-calibration";
const AREA_UNIT_OPTIONS: Array<{ value: AreaDisplayUnit; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "um2", label: "um^2" },
  { value: "mm2", label: "mm^2" },
  { value: "cm2", label: "cm^2" },
  { value: "m2", label: "m^2" },
];
const LENGTH_UNIT_TO_METERS: Record<string, number> = {
  um: 1e-6,
  mm: 1e-3,
  cm: 1e-2,
  m: 1,
};
const MEASUREMENT_ORIENTATION_OPTIONS: Array<{ value: MeasurementLabelOrientation; label: string }> = [
  { value: "horizontal", label: "Horizontal" },
  { value: "aligned", label: "Seguir linea" },
];
const MEASUREMENT_END_CAP_OPTIONS: Array<{ value: MeasurementEndCap; label: string }> = [
  { value: "circle", label: "Circulo" },
  { value: "tick", label: "Linea" },
];
const PANEL_LAYOUT_KEY = "medidas.panel-layout";
const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  left: ["tool", "calibration"],
  right: ["size", "output", "measurements", "areas"],
};
const ALL_PANEL_IDS: PanelId[] = ["tool", "calibration", "size", "output", "measurements", "areas"];

function isPanelLayout(value: unknown): value is PanelLayout {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeLayout = value as Partial<PanelLayout>;

  if (!Array.isArray(maybeLayout.left) || !Array.isArray(maybeLayout.right)) {
    return false;
  }

  const combined = [...maybeLayout.left, ...maybeLayout.right];
  return (
    combined.length === ALL_PANEL_IDS.length &&
    ALL_PANEL_IDS.every((panelId) => combined.includes(panelId)) &&
    new Set(combined).size === ALL_PANEL_IDS.length
  );
}

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

function ActionIcon({
  type,
}: {
  type:
    | "upload"
    | "install"
    | "apply"
    | "save"
    | "restore"
    | "clear"
    | "undo"
    | "close"
    | "png"
    | "jpg"
    | "hide"
    | "show"
    | "reset";
}) {
  return (
    <svg className={styles.actionIcon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {type === "upload" ? (
        <>
          <path d="M10 13V4" />
          <path d="M6.5 7.5 10 4l3.5 3.5" />
          <path d="M4 15.5h12" />
        </>
      ) : null}
      {type === "install" ? (
        <>
          <path d="M10 3.5v8" />
          <path d="M6.5 8 10 11.5 13.5 8" />
          <path d="M4 14.5h12" />
        </>
      ) : null}
      {type === "apply" ? (
        <>
          <path d="M4 10.5 8 14.5 16 6.5" />
        </>
      ) : null}
      {type === "save" ? (
        <>
          <path d="M5 4.5h8l2 2v9H5z" />
          <path d="M8 4.5v4h4v-4" />
          <path d="M8 15.5h4" />
        </>
      ) : null}
      {type === "restore" ? (
        <>
          <path d="M5 6.5v4h4" />
          <path d="M6 10.5a5 5 0 1 0 1.4-4" />
        </>
      ) : null}
      {type === "clear" ? (
        <>
          <path d="M5 5l10 10" />
          <path d="M15 5 5 15" />
        </>
      ) : null}
      {type === "undo" ? (
        <>
          <path d="M7 6 4 9l3 3" />
          <path d="M5 9h5a4 4 0 1 1 0 8h-1.5" />
        </>
      ) : null}
      {type === "close" ? (
        <>
          <path d="M4.5 10h11" />
          <path d="M10 4.5v11" />
          <path d="M5.5 5.5 14.5 14.5" opacity="0.25" />
        </>
      ) : null}
      {type === "png" || type === "jpg" ? (
        <>
          <rect x="4.5" y="3.5" width="11" height="13" rx="2" />
          <path d="M7.5 8.5h5" />
          <path d="M7.5 11h5" />
          <path d="M7.5 13.5h3.5" />
        </>
      ) : null}
      {type === "hide" ? (
        <>
          <path d="M3.5 10s2.2-4 6.5-4 6.5 4 6.5 4-2.2 4-6.5 4-6.5-4-6.5-4Z" />
          <path d="M7 13 13 7" />
        </>
      ) : null}
      {type === "show" ? (
        <>
          <path d="M3.5 10s2.2-4 6.5-4 6.5 4 6.5 4-2.2 4-6.5 4-6.5-4-6.5-4Z" />
          <circle cx="10" cy="10" r="1.8" />
        </>
      ) : null}
      {type === "reset" ? (
        <>
          <path d="M5 6.5v4h4" />
          <path d="M6 10.5a5 5 0 1 0 1.4-4" />
        </>
      ) : null}
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className={styles.collapseIcon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={collapsed ? "M7 5.5 12 10l-5 4.5" : "M5.5 7 10 12l4.5-5"} />
    </svg>
  );
}

function DragHandleIcon() {
  return (
    <svg className={styles.dragHandleIcon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="7" cy="6" r="1.1" />
      <circle cx="13" cy="6" r="1.1" />
      <circle cx="7" cy="10" r="1.1" />
      <circle cx="13" cy="10" r="1.1" />
      <circle cx="7" cy="14" r="1.1" />
      <circle cx="13" cy="14" r="1.1" />
    </svg>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function distanceBetween(start: Point, end: Point) {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function polylineLength(points: Point[]) {
  if (points.length < 2) {
    return 0;
  }

  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += distanceBetween(points[index - 1], points[index]);
  }

  return total;
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

function formatAreaUnit(unit: string) {
  return `${unit}^2`;
}

function normalizeLengthUnit(unit: string) {
  const normalized = unit.trim().toLowerCase().replace("μ", "u").replace("µ", "u");
  return normalized in LENGTH_UNIT_TO_METERS ? normalized : null;
}

function areaDisplayUnitToLengthUnit(areaUnit: Exclude<AreaDisplayUnit, "auto">) {
  return areaUnit.replace(/2$/, "");
}

function getAreaDisplayValue(
  value: number,
  baseUnit: string,
  preferredUnit: AreaDisplayUnit,
): { value: number; unitLabel: string } {
  const normalizedBaseUnit = normalizeLengthUnit(baseUnit);

  if (!normalizedBaseUnit) {
    return {
      value,
      unitLabel: formatAreaUnit(baseUnit),
    };
  }

  const squareMeters = value * LENGTH_UNIT_TO_METERS[normalizedBaseUnit] ** 2;
  const candidates: Array<Exclude<AreaDisplayUnit, "auto">> = ["um2", "mm2", "cm2", "m2"];

  if (preferredUnit !== "auto") {
    const targetLengthUnit = areaDisplayUnitToLengthUnit(preferredUnit);
    return {
      value: squareMeters / LENGTH_UNIT_TO_METERS[targetLengthUnit] ** 2,
      unitLabel: formatAreaUnit(targetLengthUnit),
    };
  }

  const convertedCandidates = candidates.map((candidate) => {
    const targetLengthUnit = areaDisplayUnitToLengthUnit(candidate);
    return {
      candidate,
      value: squareMeters / LENGTH_UNIT_TO_METERS[targetLengthUnit] ** 2,
      unitLabel: formatAreaUnit(targetLengthUnit),
    };
  });

  const readableCandidate =
    convertedCandidates.find((candidate) => Math.abs(candidate.value) >= 0.001 && Math.abs(candidate.value) < 1000) ??
    convertedCandidates[convertedCandidates.length - 1];

  return {
    value: readableCandidate.value,
    unitLabel: readableCandidate.unitLabel,
  };
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

function makeAreaName(index: number) {
  return `A${String(index + 1).padStart(2, "0")}`;
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

function polygonArea(points: Point[]) {
  if (points.length < 3) {
    return 0;
  }

  let sum = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }

  return Math.abs(sum) / 2;
}

function polygonCentroid(points: Point[]) {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  if (points.length < 3) {
    const total = points.reduce(
      (accumulator, point) => ({
        x: accumulator.x + point.x,
        y: accumulator.y + point.y,
      }),
      { x: 0, y: 0 },
    );

    return {
      x: total.x / points.length,
      y: total.y / points.length,
    };
  }

  let twiceArea = 0;
  let centroidX = 0;
  let centroidY = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    centroidX += (current.x + next.x) * cross;
    centroidY += (current.y + next.y) * cross;
  }

  if (Math.abs(twiceArea) < 0.000001) {
    const total = points.reduce(
      (accumulator, point) => ({
        x: accumulator.x + point.x,
        y: accumulator.y + point.y,
      }),
      { x: 0, y: 0 },
    );

    return {
      x: total.x / points.length,
      y: total.y / points.length,
    };
  }

  return {
    x: centroidX / (3 * twiceArea),
    y: centroidY / (3 * twiceArea),
  };
}

function measurementPathPosition(
  points: Point[],
  offset = 22,
) {
  if (points.length === 0) {
    return {
      point: { x: 0, y: 0 },
      angle: 0,
    };
  }

  if (points.length === 1) {
    return {
      point: points[0],
      angle: 0,
    };
  }

  const factor = 0.5;
  const totalLength = polylineLength(points);
  const targetLength = totalLength * factor;
  let accumulated = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = distanceBetween(start, end);

    if (segmentLength <= 0) {
      continue;
    }

    if (accumulated + segmentLength >= targetLength || index === points.length - 1) {
      const segmentFactor = clamp((targetLength - accumulated) / segmentLength, 0, 1);
      const center = {
        x: start.x + (end.x - start.x) * segmentFactor,
        y: start.y + (end.y - start.y) * segmentFactor,
      };
      const angle = Math.atan2(end.y - start.y, end.x - start.x);

      return {
        point: {
          x: center.x + Math.sin(angle) * offset,
          y: center.y - Math.cos(angle) * offset,
        },
        angle,
      };
    }

    accumulated += segmentLength;
  }

  const fallbackStart = points[points.length - 2];
  const fallbackEnd = points[points.length - 1];
  const fallbackAngle = Math.atan2(fallbackEnd.y - fallbackStart.y, fallbackEnd.x - fallbackStart.x);

  return {
    point: {
      x: fallbackEnd.x + Math.sin(fallbackAngle) * offset,
      y: fallbackEnd.y - Math.cos(fallbackAngle) * offset,
    },
    angle: fallbackAngle,
  };
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const gestureZoomRef = useRef<{ active: boolean; baseZoom: number } | null>(null);
  const labelDragRef = useRef<
    | { kind: "measurement"; id: string; pointerId: number; offset: Point }
    | { kind: "area"; id: string; pointerId: number; offset: Point }
    | null
  >(null);

  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const [imageAsset, setImageAsset] = useState<ImageAsset | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>("navigate");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showScaleBar, setShowScaleBar] = useState(true);
  const [calibrationDraft, setCalibrationDraft] = useState<Point[]>([]);
  const [measurementDraft, setMeasurementDraft] = useState<Point[]>([]);
  const [areaDraft, setAreaDraft] = useState<Point[]>([]);
  const [calibrationMethod, setCalibrationMethod] = useState<CalibrationMethod>("points");
  const [knownDistance, setKnownDistance] = useState("100");
  const [manualPixels, setManualPixels] = useState("100");
  const [unit, setUnit] = useState("um");
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [savedCalibrations, setSavedCalibrations] = useState<SavedCalibrationPreset[]>([]);
  const [lastCalibration, setLastCalibration] = useState<SavedCalibrationPreset | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [areas, setAreas] = useState<AreaMeasurement[]>([]);
  const [areaDisplayUnit, setAreaDisplayUnit] = useState<AreaDisplayUnit>("auto");
  const [labelSize, setLabelSize] = useState(1);
  const [lineSize, setLineSize] = useState(1);
  const [scaleSize, setScaleSize] = useState(1);
  const [isOffline, setIsOffline] = useState(() => (typeof navigator === "undefined" ? false : !navigator.onLine));
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [panelLayout, setPanelLayout] = useState<PanelLayout>(DEFAULT_PANEL_LAYOUT);
  const [draggedPanel, setDraggedPanel] = useState<PanelId | null>(null);
  const [dropTarget, setDropTarget] = useState<{ panelId: PanelId; position: DropPosition } | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<CollapsibleSection, boolean>>({
    tool: false,
    calibration: false,
    size: false,
    output: false,
    measurements: false,
    areas: false,
  });

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

      try {
        const storedPanelLayout = window.localStorage.getItem(PANEL_LAYOUT_KEY);
        const parsedPanelLayout = storedPanelLayout ? JSON.parse(storedPanelLayout) : null;
        setPanelLayout(isPanelLayout(parsedPanelLayout) ? parsedPanelLayout : DEFAULT_PANEL_LAYOUT);
      } catch {
        setPanelLayout(DEFAULT_PANEL_LAYOUT);
      }

      setStorageReady(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
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
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "[::1]";

    if (!("serviceWorker" in navigator) || (process.env.NODE_ENV !== "production" && !isLocalhost)) {
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
    window.addEventListener("wheel", handleGlobalWheel, { passive: false, capture: true });

    return () => {
      window.removeEventListener("wheel", handleGlobalWheel, { capture: true });
    };
  }, [imageAsset, pan.x, pan.y, viewport.height, viewport.width, zoom]);

  const handleGlobalWheel = useEffectEvent((event: WheelEvent) => {
    if (!imageAsset || !event.ctrlKey) {
      return;
    }

    event.preventDefault();

    const rect = viewportRef.current?.getBoundingClientRect();

    if (!rect || !isPointInsideStage(event.clientX, event.clientY)) {
      return;
    }

    const sensitivity = 0.0024;

    applyZoom(zoom * Math.exp(-event.deltaY * sensitivity), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  });

  useEffect(() => {
    const element = viewportRef.current;

    if (!element) {
      return;
    }

    const blockViewerScroll = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    element.addEventListener("wheel", blockViewerScroll, { passive: false });

    return () => {
      element.removeEventListener("wheel", blockViewerScroll);
    };
  }, []);

  useEffect(() => {
    window.addEventListener("gesturestart", handleGestureStart, { passive: false, capture: true });
    window.addEventListener("gesturechange", handleGestureChange, { passive: false, capture: true });
    window.addEventListener("gestureend", handleGestureEnd, { passive: false, capture: true });

    return () => {
      window.removeEventListener("gesturestart", handleGestureStart, { capture: true });
      window.removeEventListener("gesturechange", handleGestureChange, { capture: true });
      window.removeEventListener("gestureend", handleGestureEnd, { capture: true });
    };
  }, [imageAsset, pan.x, pan.y, viewport.height, viewport.width, zoom]);

  const handleGestureStart = useEffectEvent((event: Event) => {
    const gestureEvent = event as TrackpadGestureEvent;

    if (!imageAsset) {
      return;
    }

    event.preventDefault();
    gestureZoomRef.current = {
      active: isPointInsideStage(gestureEvent.clientX, gestureEvent.clientY),
      baseZoom: zoom,
    };
  });

  const handleGestureChange = useEffectEvent((event: Event) => {
    const gestureEvent = event as TrackpadGestureEvent;
    const activeGesture = gestureZoomRef.current;

    if (!imageAsset || !activeGesture?.active) {
      return;
    }

    const rect = viewportRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    event.preventDefault();

    applyZoom(activeGesture.baseZoom * gestureEvent.scale, {
      x: gestureEvent.clientX - rect.left,
      y: gestureEvent.clientY - rect.top,
    });
  });

  const handleGestureEnd = useEffectEvent((event: Event) => {
    if (gestureZoomRef.current) {
      event.preventDefault();
    }

    gestureZoomRef.current = null;
  });

  const handleLabelPointerMove = useEffectEvent((event: PointerEvent) => {
    const activeDrag = labelDragRef.current;

    if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
      return;
    }

    const point = screenToImage(event.clientX, event.clientY);

    if (!point || !imageAsset) {
      return;
    }

    const nextPoint = {
      x: clamp(point.x - activeDrag.offset.x, 0, imageAsset.width),
      y: clamp(point.y - activeDrag.offset.y, 0, imageAsset.height),
    };

    if (activeDrag.kind === "measurement") {
      setMeasurements((current) =>
        current.map((measurement) =>
          measurement.id === activeDrag.id
            ? {
                ...measurement,
                manualLabelPosition: nextPoint,
              }
            : measurement,
        ),
      );
      return;
    }

    setAreas((current) =>
      current.map((area) =>
        area.id === activeDrag.id
          ? {
              ...area,
              manualLabelPosition: nextPoint,
            }
          : area,
      ),
    );
  });

  const handleLabelPointerEnd = useEffectEvent((event: PointerEvent) => {
    if (labelDragRef.current?.pointerId === event.pointerId) {
      labelDragRef.current = null;
    }
  });

  useEffect(() => {
    window.addEventListener("pointermove", handleLabelPointerMove, { passive: true });
    window.addEventListener("pointerup", handleLabelPointerEnd);
    window.addEventListener("pointercancel", handleLabelPointerEnd);

    return () => {
      window.removeEventListener("pointermove", handleLabelPointerMove);
      window.removeEventListener("pointerup", handleLabelPointerEnd);
      window.removeEventListener("pointercancel", handleLabelPointerEnd);
    };
  }, [handleLabelPointerEnd, handleLabelPointerMove]);

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

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    window.localStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify(panelLayout));
  }, [panelLayout, storageReady]);

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
    setMeasurementDraft([]);
    setAreaDraft([]);
    setCalibration(null);
    setMeasurements([]);
    setAreas([]);
  }

  function setActiveTool(mode: ToolMode) {
    setToolMode(mode);

    if (mode !== "calibrate") {
      setCalibrationDraft([]);
    }

    if (mode !== "measure") {
      setMeasurementDraft([]);
    }

    if (mode !== "area") {
      setAreaDraft([]);
    }
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
    const parsedDistance = Number(knownDistance);
    const pixels =
      calibrationMethod === "manual"
        ? Number(manualPixels)
        : calibrationDraft.length === 2
          ? distanceBetween(calibrationDraft[0], calibrationDraft[1])
          : 0;

    if (!Number.isFinite(parsedDistance) || parsedDistance <= 0 || pixels <= 0) {
      return;
    }

    const nextCalibration = {
      start: calibrationMethod === "points" ? calibrationDraft[0] : null,
      end: calibrationMethod === "points" ? calibrationDraft[1] : null,
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

    setMeasurementDraft([]);
    setAreaDraft([]);
    setToolMode("measure");
  }

  function applySavedCalibration(preset: SavedCalibrationPreset) {
    setCalibration(applyCalibrationPresetValues(preset));
    setKnownDistance(String(preset.knownDistance));
    setManualPixels(formatNumber(preset.pixelsPerUnit * preset.knownDistance));
    setUnit(preset.unit);
    setCalibrationDraft([]);
    setMeasurementDraft([]);
    setAreaDraft([]);
    setShowScaleBar(true);
    setCalibrationMethod("manual");
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

    if (toolMode === "calibrate" && calibrationMethod === "points") {
      setMeasurementDraft([]);
      setAreaDraft([]);
      setCalibrationDraft((current) => (current.length >= 2 ? [point] : [...current, point]));
      return;
    }

    if (toolMode === "measure" && calibration) {
      setAreaDraft([]);
      setMeasurementDraft((current) => [...current, point]);
      return;
    }

    if (toolMode === "area" && calibration) {
      setMeasurementDraft([]);
      setAreaDraft((current) => [...current, point]);
    }
  }

  function isPointInsideStage(clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();

    if (!rect || renderedWidth <= 0 || renderedHeight <= 0) {
      return false;
    }

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    return (
      localX >= stageX &&
      localX <= stageX + renderedWidth &&
      localY >= stageY &&
      localY <= stageY + renderedHeight
    );
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
    if (!imageAsset || event.ctrlKey) {
      return;
    }

    const isInsideStage = isPointInsideStage(event.clientX, event.clientY);

    if (!isInsideStage) {
      if (event.ctrlKey) {
        event.preventDefault();
      }

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

  function toggleSection(section: CollapsibleSection) {
    setCollapsedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }

  function findPanelLocation(layout: PanelLayout, panelId: PanelId) {
    for (const column of ["left", "right"] as PanelColumn[]) {
      const index = layout[column].indexOf(panelId);
      if (index !== -1) {
        return { column, index };
      }
    }

    return null;
  }

  function movePanel(panelId: PanelId, targetColumn: PanelColumn, targetIndex: number) {
    setPanelLayout((current) => {
      const source = findPanelLocation(current, panelId);

      if (!source) {
        return current;
      }

      const nextLayout: PanelLayout = {
        left: [...current.left],
        right: [...current.right],
      };

      nextLayout[source.column].splice(source.index, 1);

      const boundedTargetIndex = Math.max(0, Math.min(targetIndex, nextLayout[targetColumn].length));
      nextLayout[targetColumn].splice(boundedTargetIndex, 0, panelId);

      const nextSource = findPanelLocation(nextLayout, panelId);
      if (nextSource?.column === source.column && nextSource.index === source.index) {
        return current;
      }

      return nextLayout;
    });
  }

  function handlePanelDragStart(event: React.DragEvent<HTMLDivElement>, panelId: PanelId) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", panelId);
    setDraggedPanel(panelId);
  }

  function handlePanelDragEnd() {
    setDraggedPanel(null);
    setDropTarget(null);
  }

  function handlePanelDragOver(event: React.DragEvent<HTMLDivElement>, panelId: PanelId) {
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const position: DropPosition = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
    setDropTarget({ panelId, position });
  }

  function handlePanelDragLeave(event: React.DragEvent<HTMLDivElement>, panelId: PanelId) {
    const relatedTarget = event.relatedTarget as Node | null;

    if (relatedTarget && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    setDropTarget((current) => (current?.panelId === panelId ? null : current));
  }

  function handlePanelDrop(
    event: React.DragEvent<HTMLDivElement>,
    targetColumn: PanelColumn,
    targetPanelId: PanelId,
  ) {
    event.preventDefault();

    if (!draggedPanel) {
      return;
    }

    const targetIndex = panelLayout[targetColumn].indexOf(targetPanelId);
    if (targetIndex === -1) {
      return;
    }

    const insertAfter = dropTarget?.panelId === targetPanelId ? dropTarget.position === "after" : false;
    movePanel(draggedPanel, targetColumn, targetIndex + (insertAfter ? 1 : 0));
    setDraggedPanel(null);
    setDropTarget(null);
  }

  function handleColumnDrop(event: React.DragEvent<HTMLDivElement>, column: PanelColumn) {
    event.preventDefault();

    if (!draggedPanel) {
      return;
    }

    movePanel(draggedPanel, column, panelLayout[column].length);
    setDraggedPanel(null);
    setDropTarget(null);
  }

  function clearDrafts() {
    setCalibrationDraft([]);
    setMeasurementDraft([]);
    setAreaDraft([]);
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

  function updateMeasurementLabelOrientation(id: string, labelOrientation: MeasurementLabelOrientation) {
    setMeasurements((current) =>
      current.map((measurement) =>
        measurement.id === id
          ? {
              ...measurement,
              labelOrientation,
            }
          : measurement,
      ),
    );
  }

  function updateMeasurementEndCap(id: string, endCap: MeasurementEndCap) {
    setMeasurements((current) =>
      current.map((measurement) =>
        measurement.id === id
          ? {
              ...measurement,
              endCap,
            }
          : measurement,
      ),
    );
  }

  function resetMeasurementLabelPosition(id: string) {
    setMeasurements((current) =>
      current.map((measurement) =>
        measurement.id === id
          ? {
              ...measurement,
              manualLabelPosition: null,
            }
          : measurement,
      ),
    );
  }

  function toggleMeasurementLabelVisibility(id: string) {
    setMeasurements((current) =>
      current.map((measurement) =>
        measurement.id === id
          ? {
              ...measurement,
              showLabel: !measurement.showLabel,
            }
          : measurement,
      ),
    );
  }

  function finishMeasurementDraft() {
    if (!calibration || measurementDraft.length < 2) {
      return;
    }

    const value = polylineLength(measurementDraft) / calibration.pixelsPerUnit;

    setMeasurements((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: makeMeasurementName(current.length),
        points: measurementDraft,
        value,
        unit: calibration.unit,
        color: MEASUREMENT_COLORS[current.length % MEASUREMENT_COLORS.length],
        labelOrientation: "horizontal",
        endCap: "circle",
        manualLabelPosition: null,
        showLabel: true,
      },
    ]);

    setMeasurementDraft([]);
  }

  function undoMeasurementPoint() {
    setMeasurementDraft((current) => current.slice(0, -1));
  }

  function startMeasurementLabelDrag(
    event: React.PointerEvent<SVGGElement>,
    measurementId: string,
    labelPoint: Point,
  ) {
    const point = screenToImage(event.clientX, event.clientY);

    if (!point) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    labelDragRef.current = {
      kind: "measurement",
      id: measurementId,
      pointerId: event.pointerId,
      offset: {
        x: point.x - labelPoint.x,
        y: point.y - labelPoint.y,
      },
    };
  }

  function startAreaLabelDrag(
    event: React.PointerEvent<SVGGElement>,
    areaId: string,
    labelPoint: Point,
  ) {
    const point = screenToImage(event.clientX, event.clientY);

    if (!point) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    labelDragRef.current = {
      kind: "area",
      id: areaId,
      pointerId: event.pointerId,
      offset: {
        x: point.x - labelPoint.x,
        y: point.y - labelPoint.y,
      },
    };
  }

  function finishAreaDraft() {
    if (!calibration || areaDraft.length < 3) {
      return;
    }

    const value = polygonArea(areaDraft) / calibration.pixelsPerUnit ** 2;

    setAreas((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: makeAreaName(current.length),
        points: areaDraft,
        value,
        unit: calibration.unit,
        color: MEASUREMENT_COLORS[current.length % MEASUREMENT_COLORS.length],
        manualLabelPosition: null,
        showLabel: true,
      },
    ]);

    setAreaDraft([]);
  }

  function undoAreaPoint() {
    setAreaDraft((current) => current.slice(0, -1));
  }

  function removeArea(id: string) {
    setAreas((current) => current.filter((area) => area.id !== id));
  }

  function updateAreaName(id: string, name: string) {
    setAreas((current) =>
      current.map((area) =>
        area.id === id
          ? {
              ...area,
              name,
            }
          : area,
      ),
    );
  }

  function resetAreaLabelPosition(id: string) {
    setAreas((current) =>
      current.map((area) =>
        area.id === id
          ? {
              ...area,
              manualLabelPosition: null,
            }
          : area,
      ),
    );
  }

  function toggleAreaLabelVisibility(id: string) {
    setAreas((current) =>
      current.map((area) =>
        area.id === id
          ? {
              ...area,
              showLabel: !area.showLabel,
            }
          : area,
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

    for (const area of areas) {
      const displayArea = getAreaDisplayValue(area.value, area.unit, areaDisplayUnit);
      drawArea(context, area.points, {
        label: `${area.name} - ${formatNumber(displayArea.value)} ${displayArea.unitLabel}`,
        color: area.color,
        metrics: exportMeasurementMetrics,
        scale: exportScale,
        manualLabelPosition: area.manualLabelPosition,
        showLabel: area.showLabel,
      });
    }

    for (const measurement of measurements) {
      drawMeasurement(context, measurement.points, {
        label: `${measurement.name} - ${formatNumber(measurement.value)} ${measurement.unit}`,
        color: measurement.color,
        metrics: exportMeasurementMetrics,
        scale: exportScale,
        labelOrientation: measurement.labelOrientation,
        endCap: measurement.endCap,
        manualLabelPosition: measurement.manualLabelPosition,
        showLabel: measurement.showLabel,
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
  const draftMeasurementPixels = polylineLength(measurementDraft);
  const draftMeasurementValue = calibration ? draftMeasurementPixels / calibration.pixelsPerUnit : 0;
  const draftAreaPixels = polygonArea(areaDraft);
  const draftAreaValue = calibration ? draftAreaPixels / calibration.pixelsPerUnit ** 2 : 0;
  const draftAreaDisplay = calibration
    ? getAreaDisplayValue(draftAreaValue, calibration.unit, areaDisplayUnit)
    : null;
  const displayedAreas = areas.map((area) => ({
    ...area,
    display: getAreaDisplayValue(area.value, area.unit, areaDisplayUnit),
  }));
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
  const viewerHintItems = [
    calibration ? `Escala: ${formatNumber(calibration.knownDistance)} ${calibration.unit}` : "Sin escala activa",
    calibration ? `1 ${calibration.unit} = ${formatPixels(calibration.pixelsPerUnit)}` : "Calibra para medir con precision",
    `Mediciones: ${measurements.length}`,
    `Areas: ${areas.length}`,
    measurements.some((measurement) => measurement.showLabel) || areas.some((area) => area.showLabel)
      ? "Arrastra cualquier etiqueta para moverla"
      : null,
    TOOL_HINTS[toolMode],
  ].filter((item): item is string => Boolean(item));

  function renderPanel(panelId: PanelId) {
    switch (panelId) {
      case "tool":
        return (
          <div className={styles.block}>
            <button className={styles.blockHeader} onClick={() => toggleSection("tool")} type="button" aria-expanded={!collapsedSections.tool}>
              <span className={styles.blockHeaderTitle}>
                <DragHandleIcon />
                <span className={styles.label}>Herramienta</span>
              </span>
              <CollapseIcon collapsed={collapsedSections.tool} />
            </button>
            {!collapsedSections.tool ? (
              <>
                <div className={styles.toolGrid}>
                  {(["navigate", "calibrate", "measure", "area"] as ToolMode[]).map((mode) => (
                    <button
                      key={mode}
                      className={mode === toolMode ? styles.toolButtonActive : styles.toolButton}
                      onClick={() => setActiveTool(mode)}
                      disabled={(mode === "measure" || mode === "area") && !calibration}
                    >
                      {TOOL_LABELS[mode]}
                    </button>
                  ))}
                </div>
                {toolMode === "measure" ? (
                  <div className={styles.toolActions}>
                    <div className={styles.metaRow}>
                      <span>Puntos medicion</span>
                      <strong>{measurementDraft.length}</strong>
                    </div>
                    <div className={styles.metaRow}>
                      <span>Longitud actual</span>
                      <strong>{measurementDraft.length >= 2 && calibration ? `${formatNumber(draftMeasurementValue)} ${calibration.unit}` : "-"}</strong>
                    </div>
                    <div className={styles.buttonStack}>
                      <button className={styles.ghostButton} onClick={undoMeasurementPoint} disabled={measurementDraft.length === 0}>
                        <span className={styles.buttonContent}>
                          <ActionIcon type="undo" />
                          <span>Deshacer punto</span>
                        </span>
                      </button>
                      <button className={styles.secondaryButton} onClick={finishMeasurementDraft} disabled={measurementDraft.length < 2 || !calibration}>
                        <span className={styles.buttonContent}>
                          <ActionIcon type="close" />
                          <span>Cerrar medicion</span>
                        </span>
                      </button>
                    </div>
                  </div>
                ) : null}
                {toolMode === "area" ? (
                  <div className={styles.toolActions}>
                    <label className={styles.selectField}>
                      <span>Mostrar areas en</span>
                      <select value={areaDisplayUnit} onChange={(event) => setAreaDisplayUnit(event.target.value as AreaDisplayUnit)}>
                        {AREA_UNIT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className={styles.metaRow}>
                      <span>Vertices area</span>
                      <strong>{areaDraft.length}</strong>
                    </div>
                    <div className={styles.metaRow}>
                      <span>Area actual</span>
                      <strong>
                        {draftAreaPixels && draftAreaDisplay ? `${formatNumber(draftAreaDisplay.value)} ${draftAreaDisplay.unitLabel}` : "-"}
                      </strong>
                    </div>
                    <div className={styles.buttonStack}>
                      <button className={styles.ghostButton} onClick={undoAreaPoint} disabled={areaDraft.length === 0}>
                        <span className={styles.buttonContent}>
                          <ActionIcon type="undo" />
                          <span>Deshacer punto area</span>
                        </span>
                      </button>
                      <button className={styles.secondaryButton} onClick={finishAreaDraft} disabled={areaDraft.length < 3 || !calibration}>
                        <span className={styles.buttonContent}>
                          <ActionIcon type="close" />
                          <span>Cerrar area</span>
                        </span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        );
      case "calibration":
        return (
          <div className={styles.block}>
            <button className={styles.blockHeader} onClick={() => toggleSection("calibration")} type="button" aria-expanded={!collapsedSections.calibration}>
              <span className={styles.blockHeaderTitle}>
                <DragHandleIcon />
                <span className={styles.label}>Calibracion</span>
              </span>
              <CollapseIcon collapsed={collapsedSections.calibration} />
            </button>
            {!collapsedSections.calibration ? (
              <>
                <div className={`${styles.toolGrid} ${styles.calibrationModes}`}>
                  {(["points", "manual"] as CalibrationMethod[]).map((method) => (
                    <button
                      key={method}
                      className={method === calibrationMethod ? styles.toolButtonActive : styles.toolButton}
                      onClick={() => {
                        setCalibrationMethod(method);
                        setCalibrationDraft([]);
                      }}
                    >
                      {method === "points" ? "Con puntos" : "Manual"}
                    </button>
                  ))}
                </div>
                {calibrationMethod === "manual" ? (
                  <>
                    <div className={styles.manualEquation}>
                      <label className={styles.selectField}>
                        <span>Pixeles</span>
                        <input value={manualPixels} onChange={(event) => setManualPixels(event.target.value)} inputMode="decimal" placeholder="Ej. 250" />
                      </label>
                      <div className={styles.equationSign}>=</div>
                      <label className={styles.selectField}>
                        <span>Medida real</span>
                        <input value={knownDistance} onChange={(event) => setKnownDistance(event.target.value)} inputMode="decimal" placeholder="Ej. 100" />
                      </label>
                      <label className={styles.selectField}>
                        <span>Unidad</span>
                        <input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="um" />
                      </label>
                    </div>
                    <div className={styles.helperText}>Ejemplo: `250 px = 100 um`</div>
                  </>
                ) : (
                  <div className={`${styles.formRow} ${styles.calibrationInputs}`}>
                    <input value={knownDistance} onChange={(event) => setKnownDistance(event.target.value)} inputMode="decimal" placeholder="Distancia" />
                    <input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Unidad" />
                  </div>
                )}
                <div className={styles.metaRow}>
                  <span>{calibrationMethod === "points" ? "Puntos" : "Modo"}</span>
                  <strong>{calibrationMethod === "points" ? `${calibrationDraft.length}/2` : "Manual"}</strong>
                </div>
                <div className={styles.metaRow}>
                  <span>Pixels</span>
                  <strong>
                    {calibrationMethod === "manual"
                      ? Number.isFinite(Number(manualPixels)) && Number(manualPixels) > 0
                        ? formatPixels(Number(manualPixels))
                        : "-"
                      : draftCalibrationPixels
                        ? formatPixels(draftCalibrationPixels)
                        : "-"}
                  </strong>
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
                    disabled={
                      calibrationMethod === "manual"
                        ? !Number.isFinite(Number(manualPixels)) || Number(manualPixels) <= 0
                        : calibrationDraft.length !== 2
                    }
                  >
                    <span className={styles.buttonContent}>
                      <ActionIcon type="apply" />
                      <span>Aplicar escala</span>
                    </span>
                  </button>
                  <div className={styles.presetSaveRow}>
                    <label className={styles.presetNameField}>
                      <span>Nombre de calibracion</span>
                      <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Ej. Regla 10 mm" disabled={!calibration} />
                    </label>
                    <button className={styles.ghostButton} onClick={saveCurrentCalibration} disabled={!calibration}>
                      <span className={styles.buttonContent}>
                        <ActionIcon type="save" />
                        <span>Guardar</span>
                      </span>
                    </button>
                  </div>
                  <button className={styles.ghostButton} onClick={() => lastCalibration && applySavedCalibration(lastCalibration)} disabled={!lastCalibration}>
                    <span className={styles.buttonContent}>
                      <ActionIcon type="restore" />
                      <span>Recuperar ultima</span>
                    </span>
                  </button>
                  <button className={styles.ghostButton} onClick={clearDrafts}>
                    <span className={styles.buttonContent}>
                      <ActionIcon type="clear" />
                      <span>Limpiar puntos</span>
                    </span>
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
              </>
            ) : null}
          </div>
        );
      case "size":
        return (
          <div className={styles.block}>
            <button className={styles.blockHeader} onClick={() => toggleSection("size")} type="button" aria-expanded={!collapsedSections.size}>
              <span className={styles.blockHeaderTitle}>
                <DragHandleIcon />
                <span className={styles.label}>Tamano</span>
              </span>
              <CollapseIcon collapsed={collapsedSections.size} />
            </button>
            {!collapsedSections.size ? (
              <div className={styles.sliderGroup}>
                <label className={styles.sliderField}>
                  <span>Etiquetas</span>
                  <input type="range" min="0.2" max="4" step="0.1" value={labelSize} onChange={(event) => setLabelSize(Number(event.target.value))} />
                  <strong>{labelSize.toFixed(1)}x</strong>
                </label>
                <label className={styles.sliderField}>
                  <span>Lineas</span>
                  <input type="range" min="0.2" max="4" step="0.1" value={lineSize} onChange={(event) => setLineSize(Number(event.target.value))} />
                  <strong>{lineSize.toFixed(1)}x</strong>
                </label>
                <label className={styles.sliderField}>
                  <span>Escala</span>
                  <input type="range" min="0.2" max="4" step="0.1" value={scaleSize} onChange={(event) => setScaleSize(Number(event.target.value))} />
                  <strong>{scaleSize.toFixed(1)}x</strong>
                </label>
              </div>
            ) : null}
          </div>
        );
      case "output":
        return (
          <div className={styles.block}>
            <button className={styles.blockHeader} onClick={() => toggleSection("output")} type="button" aria-expanded={!collapsedSections.output}>
              <span className={styles.blockHeaderTitle}>
                <DragHandleIcon />
                <span className={styles.label}>Salida</span>
              </span>
              <CollapseIcon collapsed={collapsedSections.output} />
            </button>
            {!collapsedSections.output ? (
              <div className={styles.buttonStack}>
                <button className={styles.secondaryButton} onClick={() => exportAnnotatedImage("png")} disabled={!imageAsset}>
                  <span className={styles.buttonContent}>
                    <ActionIcon type="png" />
                    <span>Exportar PNG</span>
                  </span>
                </button>
                <button className={styles.secondaryButton} onClick={() => exportAnnotatedImage("jpeg")} disabled={!imageAsset}>
                  <span className={styles.buttonContent}>
                    <ActionIcon type="jpg" />
                    <span>Exportar JPG</span>
                  </span>
                </button>
                <button className={styles.ghostButton} onClick={() => setShowScaleBar((current) => !current)} disabled={!calibration}>
                  <span className={styles.buttonContent}>
                    <ActionIcon type={showScaleBar ? "hide" : "show"} />
                    <span>{showScaleBar ? "Ocultar escala" : "Mostrar escala"}</span>
                  </span>
                </button>
                <button className={styles.ghostButton} onClick={resetView} disabled={!imageAsset}>
                  <span className={styles.buttonContent}>
                    <ActionIcon type="reset" />
                    <span>Reset vista</span>
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        );
      case "measurements":
        return (
          <div className={styles.block}>
            <button className={styles.blockHeader} onClick={() => toggleSection("measurements")} type="button" aria-expanded={!collapsedSections.measurements}>
              <span className={styles.blockHeaderTitle}>
                <DragHandleIcon />
                <span className={styles.label}>Mediciones</span>
              </span>
              <CollapseIcon collapsed={collapsedSections.measurements} />
            </button>
            {!collapsedSections.measurements ? (
              measurements.length ? (
                <div className={styles.measurementList}>
                  {measurements.map((measurement) => (
                    <div key={measurement.id} className={styles.measurementItem}>
                      <div className={styles.measurementHeaderRow}>
                        <div className={styles.measurementIdentity}>
                          <span className={styles.measurementDot} style={{ backgroundColor: measurement.color }} aria-hidden="true" />
                          <input className={styles.measurementNameInput} value={measurement.name} onChange={(event) => updateMeasurementName(measurement.id, event.target.value)} aria-label="Nombre de medicion" />
                        </div>
                      </div>
                      <div className={styles.measurementContent}>
                        <span className={styles.measurementValue}>
                          {formatNumber(measurement.value)} {measurement.unit}
                        </span>
                        <div className={styles.measurementActionRow}>
                          <button
                            className={styles.measurementIconButton}
                            onClick={() => toggleMeasurementLabelVisibility(measurement.id)}
                            aria-label={measurement.showLabel ? "Ocultar etiqueta" : "Mostrar etiqueta"}
                            title={measurement.showLabel ? "Ocultar etiqueta" : "Mostrar etiqueta"}
                            type="button"
                          >
                            <ActionIcon type={measurement.showLabel ? "hide" : "show"} />
                          </button>
                          <button
                            className={styles.measurementIconButton}
                            onClick={() => resetMeasurementLabelPosition(measurement.id)}
                            aria-label="Resetear posicion de etiqueta"
                            title="Resetear posicion de etiqueta"
                            type="button"
                            disabled={!measurement.manualLabelPosition}
                          >
                            <ActionIcon type="reset" />
                          </button>
                          <button
                            className={`${styles.measurementIconButton} ${styles.measurementIconButtonDanger}`}
                            onClick={() => removeMeasurement(measurement.id)}
                            aria-label="Quitar medicion"
                            title="Quitar medicion"
                            type="button"
                          >
                            <ActionIcon type="clear" />
                          </button>
                        </div>
                        <div className={styles.measurementControlsGrid}>
                          <label className={styles.measurementControl}>
                            <span>Etiqueta</span>
                            <select
                              className={styles.measurementSelect}
                              value={measurement.labelOrientation}
                              onChange={(event) => updateMeasurementLabelOrientation(measurement.id, event.target.value as MeasurementLabelOrientation)}
                              aria-label="Orientacion de etiqueta"
                            >
                              {MEASUREMENT_ORIENTATION_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={styles.measurementControl}>
                            <span>Extremos</span>
                            <select
                              className={styles.measurementSelect}
                              value={measurement.endCap}
                              onChange={(event) => updateMeasurementEndCap(measurement.id, event.target.value as MeasurementEndCap)}
                              aria-label="Terminacion de medicion"
                            >
                              {MEASUREMENT_END_CAP_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>Sin mediciones</div>
              )
            ) : null}
          </div>
        );
      case "areas":
        return (
          <div className={styles.block}>
            <button className={styles.blockHeader} onClick={() => toggleSection("areas")} type="button" aria-expanded={!collapsedSections.areas}>
              <span className={styles.blockHeaderTitle}>
                <DragHandleIcon />
                <span className={styles.label}>Areas</span>
              </span>
              <CollapseIcon collapsed={collapsedSections.areas} />
            </button>
            {!collapsedSections.areas ? (
              areas.length ? (
                <div className={styles.measurementList}>
                  {displayedAreas.map((area) => (
                    <div key={area.id} className={styles.measurementItem}>
                      <div className={styles.measurementHeaderRow}>
                        <div className={styles.measurementIdentity}>
                          <span className={styles.measurementDot} style={{ backgroundColor: area.color }} aria-hidden="true" />
                          <input className={styles.measurementNameInput} value={area.name} onChange={(event) => updateAreaName(area.id, event.target.value)} aria-label="Nombre de area" />
                        </div>
                      </div>
                      <div className={styles.measurementContent}>
                        <span className={styles.measurementValue}>
                          {formatNumber(area.display.value)} {area.display.unitLabel}
                        </span>
                        <div className={styles.measurementActionRow}>
                          <button
                            className={styles.measurementIconButton}
                            onClick={() => toggleAreaLabelVisibility(area.id)}
                            aria-label={area.showLabel ? "Ocultar etiqueta de area" : "Mostrar etiqueta de area"}
                            title={area.showLabel ? "Ocultar etiqueta de area" : "Mostrar etiqueta de area"}
                            type="button"
                          >
                            <ActionIcon type={area.showLabel ? "hide" : "show"} />
                          </button>
                          <button
                            className={styles.measurementIconButton}
                            onClick={() => resetAreaLabelPosition(area.id)}
                            aria-label="Resetear posicion de etiqueta de area"
                            title="Resetear posicion de etiqueta de area"
                            type="button"
                            disabled={!area.manualLabelPosition}
                          >
                            <ActionIcon type="reset" />
                          </button>
                          <button
                            className={`${styles.measurementIconButton} ${styles.measurementIconButtonDanger}`}
                            onClick={() => removeArea(area.id)}
                            aria-label="Quitar area"
                            title="Quitar area"
                            type="button"
                          >
                            <ActionIcon type="clear" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>Sin areas</div>
              )
            ) : null}
          </div>
        );
      default:
        return null;
    }
  }

  function renderPanelColumn(column: PanelColumn) {
    return (
      <>
        {panelLayout[column].map((panelId) => (
          <div
            key={panelId}
            className={styles.panelShell}
            draggable
            onDragStart={(event) => handlePanelDragStart(event, panelId)}
            onDragEnd={handlePanelDragEnd}
            onDragOver={(event) => handlePanelDragOver(event, panelId)}
            onDragLeave={(event) => handlePanelDragLeave(event, panelId)}
            onDrop={(event) => handlePanelDrop(event, column, panelId)}
            data-dragging={draggedPanel === panelId ? "true" : "false"}
            data-drop-position={
              dropTarget?.panelId === panelId
                ? dropTarget.position
                : "none"
            }
            title="Arrastra para mover este panel"
          >
            {renderPanel(panelId)}
          </div>
        ))}
        <div
          className={styles.sidebarDropZone}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => handleColumnDrop(event, column)}
          data-active={draggedPanel ? "true" : "false"}
        >
          {draggedPanel ? "Soltar aqui" : ""}
        </div>
      </>
    );
  }

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
              <button className={styles.primaryButton} onClick={openFilePicker}>
                <span className={styles.buttonContent}>
                  <ActionIcon type="upload" />
                  <span>{imageAsset ? "Cambiar imagen" : "Subir imagen"}</span>
                </span>
              </button>
            </div>
            {renderPanelColumn("left")}

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
                {installPrompt && !isInstalled ? (
                  <button className={styles.installBadge} onClick={installApp} type="button">
                    <span className={styles.buttonContent}>
                      <ActionIcon type="install" />
                      <span>Instalar app</span>
                    </span>
                  </button>
                ) : null}
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
                        points={[calibration.start, calibration.end]}
                        label={`${formatNumber(calibration.knownDistance)} ${calibration.unit}`}
                        color="#f4d35e"
                        dashed
                        metrics={screenMetrics}
                      />
                    )}

                    {calibrationDraft.length === 2 && !calibration && (
                      <MeasurementLine
                        points={calibrationDraft}
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
                        points={measurement.points}
                        label={`${measurement.name} - ${formatNumber(measurement.value)} ${measurement.unit}`}
                        color={measurement.color}
                        metrics={screenMetrics}
                        labelOrientation={measurement.labelOrientation}
                        endCap={measurement.endCap}
                        manualLabelPosition={measurement.manualLabelPosition}
                        showLabel={measurement.showLabel}
                        onLabelPointerDown={
                          measurement.showLabel
                            ? (event, labelPoint) => startMeasurementLabelDrag(event, measurement.id, labelPoint)
                            : undefined
                        }
                      />
                    ))}

                    {displayedAreas.map((area) => (
                      <AreaShape
                        key={area.id}
                        points={area.points}
                        label={`${area.name} - ${formatNumber(area.display.value)} ${area.display.unitLabel}`}
                        color={area.color}
                        metrics={screenMetrics}
                        manualLabelPosition={area.manualLabelPosition}
                        showLabel={area.showLabel}
                        onLabelPointerDown={
                          area.showLabel
                            ? (event, labelPoint) => startAreaLabelDrag(event, area.id, labelPoint)
                            : undefined
                        }
                      />
                    ))}

                    {areaDraft.length >= 2 && (
                      <AreaShape
                        points={areaDraft}
                        label={
                          areaDraft.length >= 3 && draftAreaDisplay
                            ? `${formatNumber(draftAreaDisplay.value)} ${draftAreaDisplay.unitLabel}`
                            : `${areaDraft.length} puntos`
                        }
                        color="#4cd7b2"
                        metrics={screenMetrics}
                        open
                      />
                    )}

                    {measurementDraft.length >= 2 && calibration && (
                      <MeasurementLine
                        points={measurementDraft}
                        label={`${formatNumber(draftMeasurementValue)} ${calibration.unit}`}
                        color="#ffb347"
                        dashed
                        metrics={screenMetrics}
                      />
                    )}

                    {measurementDraft.length === 1 && (
                      <PointHandle point={measurementDraft[0]} color="#ffb347" metrics={screenMetrics} />
                    )}

                    {areaDraft.length === 1 && (
                      <PointHandle point={areaDraft[0]} color="#4cd7b2" metrics={screenMetrics} />
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
                  <strong>Sube una imagen para empezar</strong>
                  <span>Calibra escalas, registra mediciones, calcula areas y exporta resultados con una vista limpia.</span>
                </div>
              )}
            </div>

            <div className={styles.viewerHint}>
              {viewerHintItems.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>

          <aside className={styles.sidebar}>{renderPanelColumn("right")}</aside>
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
  points,
  label,
  color,
  dashed = false,
  metrics,
  labelOrientation = "horizontal",
  endCap = "circle",
  manualLabelPosition = null,
  showLabel = true,
  onLabelPointerDown,
}: {
  points: Point[];
  label: string;
  color: string;
  dashed?: boolean;
  metrics: AnnotationMetrics;
  labelOrientation?: MeasurementLabelOrientation;
  endCap?: MeasurementEndCap;
  manualLabelPosition?: Point | null;
  showLabel?: boolean;
  onLabelPointerDown?: (event: React.PointerEvent<SVGGElement>, labelPoint: Point) => void;
}) {
  if (points.length === 0) {
    return null;
  }

  if (points.length === 1) {
    return <PointHandle point={points[0]} color={color} metrics={metrics} />;
  }

  const { point: automaticLabelPosition, angle } = measurementPathPosition(points, metrics.labelOffset);
  const computedLabelPosition = manualLabelPosition ?? automaticLabelPosition;
  const labelBox = getLabelBox(label, metrics);
  const tickLength = metrics.pointRadius * 2.2;
  const tickDx = Math.sin(angle) * (tickLength / 2);
  const tickDy = -Math.cos(angle) * (tickLength / 2);
  const labelRotation = labelOrientation === "aligned" ? (angle * 180) / Math.PI : 0;

  return (
    <g>
      <polyline
        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={metrics.lineWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashed ? "8 6" : "0"}
        pointerEvents="none"
      />
      {endCap === "circle" ? (
        <>
          {points.map((point, index) => (
            <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r={metrics.pointRadius} fill={color} pointerEvents="none" />
          ))}
        </>
      ) : (
        <>
          <line
            x1={points[0].x - tickDx}
            y1={points[0].y - tickDy}
            x2={points[0].x + tickDx}
            y2={points[0].y + tickDy}
            stroke={color}
            strokeWidth={metrics.lineWidth}
            strokeLinecap="round"
            pointerEvents="none"
          />
          <line
            x1={points[points.length - 1].x - tickDx}
            y1={points[points.length - 1].y - tickDy}
            x2={points[points.length - 1].x + tickDx}
            y2={points[points.length - 1].y + tickDy}
            stroke={color}
            strokeWidth={metrics.lineWidth}
            strokeLinecap="round"
            pointerEvents="none"
          />
        </>
      )}
      {showLabel ? (
        <g
          className={onLabelPointerDown ? styles.measurementLabelDraggable : undefined}
          transform={`translate(${computedLabelPosition.x} ${computedLabelPosition.y}) rotate(${labelRotation})`}
          onPointerDown={onLabelPointerDown ? (event) => onLabelPointerDown(event, computedLabelPosition) : undefined}
          onClick={onLabelPointerDown ? (event) => event.stopPropagation() : undefined}
          pointerEvents={onLabelPointerDown ? "all" : "none"}
        >
          <rect
            x={-labelBox.width / 2}
            y={-labelBox.height / 2}
            width={labelBox.width}
            height={labelBox.height}
            rx={labelBox.radius}
            fill="rgba(6, 10, 17, 0.84)"
            stroke={onLabelPointerDown ? "rgba(255, 255, 255, 0.28)" : "rgba(255, 255, 255, 0.08)"}
            strokeDasharray={onLabelPointerDown ? "4 3" : undefined}
          />
          {onLabelPointerDown ? (
            <>
              <circle cx={-labelBox.width / 2 + 12} cy="-4" r="1.3" fill="rgba(249, 246, 239, 0.78)" />
              <circle cx={-labelBox.width / 2 + 12} cy="4" r="1.3" fill="rgba(249, 246, 239, 0.78)" />
              <circle cx={-labelBox.width / 2 + 18} cy="-4" r="1.3" fill="rgba(249, 246, 239, 0.78)" />
              <circle cx={-labelBox.width / 2 + 18} cy="4" r="1.3" fill="rgba(249, 246, 239, 0.78)" />
            </>
          ) : null}
          <text
            x="0"
            y={metrics.labelFontSize * 0.33}
            textAnchor="middle"
            fill="#f9f6ef"
            fontSize={metrics.labelFontSize}
            fontWeight="600"
            pointerEvents="none"
          >
            {label}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function AreaShape({
  points,
  label,
  color,
  metrics,
  open = false,
  manualLabelPosition = null,
  showLabel = true,
  onLabelPointerDown,
}: {
  points: Point[];
  label: string;
  color: string;
  metrics: AnnotationMetrics;
  open?: boolean;
  manualLabelPosition?: Point | null;
  showLabel?: boolean;
  onLabelPointerDown?: (event: React.PointerEvent<SVGGElement>, labelPoint: Point) => void;
}) {
  if (points.length === 0) {
    return null;
  }

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const finalPath = open ? path : `${path} Z`;
  const labelPosition = manualLabelPosition ?? polygonCentroid(points);
  const labelBox = getLabelBox(label, metrics);

  return (
    <g>
      <path
        d={finalPath}
        fill={open ? "transparent" : color}
        fillOpacity={open ? 0 : 0.16}
        stroke={color}
        strokeWidth={metrics.lineWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={open ? "8 6" : "0"}
      />
      {points.map((point, index) => (
        <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r={metrics.pointRadius} fill={color} />
      ))}
      {showLabel ? (
        <g
          className={onLabelPointerDown ? styles.measurementLabelDraggable : undefined}
          transform={`translate(${labelPosition.x} ${labelPosition.y})`}
          onPointerDown={onLabelPointerDown ? (event) => onLabelPointerDown(event, labelPosition) : undefined}
          onClick={onLabelPointerDown ? (event) => event.stopPropagation() : undefined}
          pointerEvents={onLabelPointerDown ? "all" : "none"}
        >
          <rect
            x={-labelBox.width / 2}
            y={-labelBox.height / 2}
            width={labelBox.width}
            height={labelBox.height}
            rx={labelBox.radius}
            fill="rgba(6, 10, 17, 0.84)"
            stroke={onLabelPointerDown ? "rgba(255, 255, 255, 0.28)" : "rgba(255, 255, 255, 0.08)"}
            strokeDasharray={onLabelPointerDown ? "4 3" : undefined}
          />
          {onLabelPointerDown ? (
            <>
              <circle cx={-labelBox.width / 2 + 12} cy="-4" r="1.3" fill="rgba(249, 246, 239, 0.78)" />
              <circle cx={-labelBox.width / 2 + 12} cy="4" r="1.3" fill="rgba(249, 246, 239, 0.78)" />
              <circle cx={-labelBox.width / 2 + 18} cy="-4" r="1.3" fill="rgba(249, 246, 239, 0.78)" />
              <circle cx={-labelBox.width / 2 + 18} cy="4" r="1.3" fill="rgba(249, 246, 239, 0.78)" />
            </>
          ) : null}
          <text
            x="0"
            y={metrics.labelFontSize * 0.33}
            textAnchor="middle"
            fill="#f9f6ef"
            fontSize={metrics.labelFontSize}
            fontWeight="600"
            pointerEvents="none"
          >
            {label}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function drawMeasurement(
  context: CanvasRenderingContext2D,
  points: Point[],
  options: {
    label: string;
    color: string;
    dashed?: boolean;
    metrics: AnnotationMetrics;
    scale?: number;
    labelOrientation?: MeasurementLabelOrientation;
    endCap?: MeasurementEndCap;
    manualLabelPosition?: Point | null;
    showLabel?: boolean;
  },
) {
  if (points.length === 0) {
    return;
  }

  const scale = options.scale ?? 1;
  const scaledPoints = points.map((point) => ({ x: point.x * scale, y: point.y * scale }));
  const { point: automaticLabelPosition, angle } = measurementPathPosition(scaledPoints, options.metrics.labelOffset);
  const labelPosition = options.manualLabelPosition
    ? {
        x: options.manualLabelPosition.x * scale,
        y: options.manualLabelPosition.y * scale,
      }
    : automaticLabelPosition;
  const labelBox = getLabelBox(options.label, options.metrics);
  const tickLength = options.metrics.pointRadius * 2.2;
  const tickDx = Math.sin(angle) * (tickLength / 2);
  const tickDy = -Math.cos(angle) * (tickLength / 2);
  const labelRotation = options.labelOrientation === "aligned" ? angle : 0;

  context.save();
  context.strokeStyle = options.color;
  context.fillStyle = options.color;
  context.lineWidth = options.metrics.lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash(options.dashed ? [12, 8] : []);
  context.beginPath();
  context.moveTo(scaledPoints[0].x, scaledPoints[0].y);
  for (let index = 1; index < scaledPoints.length; index += 1) {
    context.lineTo(scaledPoints[index].x, scaledPoints[index].y);
  }
  context.stroke();
  context.setLineDash([]);

  if ((options.endCap ?? "circle") === "circle") {
    for (const point of scaledPoints) {
      context.beginPath();
      context.arc(point.x, point.y, options.metrics.pointRadius, 0, Math.PI * 2);
      context.fill();
    }
  } else {
    context.beginPath();
    context.moveTo(scaledPoints[0].x - tickDx, scaledPoints[0].y - tickDy);
    context.lineTo(scaledPoints[0].x + tickDx, scaledPoints[0].y + tickDy);
    context.moveTo(scaledPoints[scaledPoints.length - 1].x - tickDx, scaledPoints[scaledPoints.length - 1].y - tickDy);
    context.lineTo(scaledPoints[scaledPoints.length - 1].x + tickDx, scaledPoints[scaledPoints.length - 1].y + tickDy);
    context.stroke();
  }

  if (options.showLabel ?? true) {
    context.translate(labelPosition.x, labelPosition.y);
    context.rotate(labelRotation);
    context.fillStyle = "rgba(6, 10, 17, 0.84)";
    roundRect(context, -labelBox.width / 2, -labelBox.height / 2, labelBox.width, labelBox.height, labelBox.radius);
    context.fill();

    context.fillStyle = "#f9f6ef";
    context.font = `600 ${Math.round(options.metrics.labelFontSize)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(options.label, 0, options.metrics.labelFontSize * 0.04);
  }
  context.restore();
}

function drawArea(
  context: CanvasRenderingContext2D,
  points: Point[],
  options: {
    label: string;
    color: string;
    metrics: AnnotationMetrics;
    scale?: number;
    manualLabelPosition?: Point | null;
    showLabel?: boolean;
  },
) {
  if (points.length === 0) {
    return;
  }

  const scale = options.scale ?? 1;
  const scaledPoints = points.map((point) => ({ x: point.x * scale, y: point.y * scale }));
  const labelPosition = options.manualLabelPosition
    ? {
        x: options.manualLabelPosition.x * scale,
        y: options.manualLabelPosition.y * scale,
      }
    : polygonCentroid(scaledPoints);
  const labelBox = getLabelBox(options.label, options.metrics);

  context.save();
  context.strokeStyle = options.color;
  context.fillStyle = options.color;
  context.lineWidth = options.metrics.lineWidth;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.globalAlpha = 0.16;
  context.beginPath();
  context.moveTo(scaledPoints[0].x, scaledPoints[0].y);

  for (let index = 1; index < scaledPoints.length; index += 1) {
    context.lineTo(scaledPoints[index].x, scaledPoints[index].y);
  }

  context.closePath();
  context.fill();
  context.globalAlpha = 1;
  context.stroke();

  for (const point of scaledPoints) {
    context.beginPath();
    context.arc(point.x, point.y, options.metrics.pointRadius, 0, Math.PI * 2);
    context.fill();
  }

  if (options.showLabel ?? true) {
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
  }
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
