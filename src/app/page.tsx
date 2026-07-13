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
  navigate: "Navegar",
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

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

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
  const imageX = (viewport.width - renderedWidth) / 2 + pan.x;
  const imageY = (viewport.height - renderedHeight) / 2 + pan.y;

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

  function screenToImage(clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();

    if (!rect || !imageAsset || renderedWidth <= 0 || renderedHeight <= 0) {
      return null;
    }

    const x = ((clientX - rect.left) - imageX) / (fitScale * zoom);
    const y = ((clientY - rect.top) - imageY) / (fitScale * zoom);

    if (Number.isNaN(x) || Number.isNaN(y)) {
      return null;
    }

    return {
      x: clamp(x, 0, imageAsset.width),
      y: clamp(y, 0, imageAsset.height),
    };
  }

  function imageToScreen(point: Point) {
    return {
      x: imageX + point.x * fitScale * zoom,
      y: imageY + point.y * fitScale * zoom,
    };
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
      setCalibrationDraft((current) => {
        if (current.length >= 2) {
          return [point];
        }

        return [...current, point];
      });

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

    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };

    setPan((current) => ({
      x: current.x + deltaX,
      y: current.y + deltaY,
    }));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!imageAsset) {
      return;
    }

    event.preventDefault();

    const pointBefore = screenToImage(event.clientX, event.clientY);
    const nextZoom = clamp(zoom * (event.deltaY < 0 ? 1.1 : 0.92), 0.6, 8);

    if (!pointBefore || nextZoom === zoom) {
      return;
    }

    const rect = viewportRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const nextRenderedWidth = imageAsset.width * fitScale * nextZoom;
    const nextRenderedHeight = imageAsset.height * fitScale * nextZoom;
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;

    setPan({
      x: cursorX - (viewport.width - nextRenderedWidth) / 2 - pointBefore.x * fitScale * nextZoom,
      y: cursorY - (viewport.height - nextRenderedHeight) / 2 - pointBefore.y * fitScale * nextZoom,
    });

    setZoom(nextZoom);
  }

  function removeMeasurement(id: string) {
    setMeasurements((current) => current.filter((measurement) => measurement.id !== id));
  }

  const draftCalibrationPixels =
    calibrationDraft.length === 2 ? distanceBetween(calibrationDraft[0], calibrationDraft[1]) : 0;

  const viewerPhysicalWidth =
    calibration && fitScale > 0 && zoom > 0
      ? viewport.width / (fitScale * zoom * calibration.pixelsPerUnit)
      : 0;

  const scaleBarUnits = calibration ? niceScaleLength(viewerPhysicalWidth * 0.22) : 0;
  const scaleBarPixels = calibration ? scaleBarUnits * calibration.pixelsPerUnit * fitScale * zoom : 0;

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
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>Microscopy Measurement Studio</span>
            <h1>Calibracion visual y metrologia sobre fotografias microscopicas.</h1>
          </div>

          <p>
            Sube una imagen, define una referencia real entre dos puntos y mide dentro de la
            fotografia con anotaciones limpias, barra de escala y un layout pensado como software
            cientifico serio.
          </p>

          <div className={styles.heroStats}>
            <div className={styles.statCard}>
              <strong>{calibration ? calibration.unit : "Listo"}</strong>
              <span>Unidad activa</span>
            </div>
            <div className={styles.statCard}>
              <strong>{measurements.length}</strong>
              <span>Marcas guardadas</span>
            </div>
            <div className={styles.statCard}>
              <strong>{Math.round(zoom * 100)}%</strong>
              <span>Zoom del visor</span>
            </div>
          </div>
        </section>

        <section className={styles.workspace}>
          <aside className={styles.panel}>
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardIndex}>01</span>
                <div>
                  <h2>Imagen</h2>
                  <p>Carga una foto del microscopio o lupa y abre el espacio de trabajo.</p>
                </div>
              </div>

              <button className={styles.primaryButton} onClick={openFilePicker}>
                {imageAsset ? "Reemplazar imagen" : "Subir fotografia"}
              </button>

              {imageAsset ? (
                <div className={styles.metaBlock}>
                  <span>{imageAsset.name}</span>
                  <span>
                    {imageAsset.width} x {imageAsset.height} px
                  </span>
                </div>
              ) : (
                <div className={styles.emptyNote}>
                  Trabaja mejor con imagenes donde la muestra y la referencia esten en el mismo
                  plano focal.
                </div>
              )}
            </div>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardIndex}>02</span>
                <div>
                  <h2>Herramienta</h2>
                  <p>Alterna entre navegacion, calibracion y medicion.</p>
                </div>
              </div>

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

              <div className={styles.metaBlock}>
                <span>Modo actual</span>
                <span>{TOOL_LABELS[toolMode]}</span>
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardIndex}>03</span>
                <div>
                  <h2>Calibracion</h2>
                  <p>Marca dos puntos cuya distancia real conozcas para fijar la escala.</p>
                </div>
              </div>

              <div className={styles.formRow}>
                <label>
                  <span>Distancia real</span>
                  <input
                    value={knownDistance}
                    onChange={(event) => setKnownDistance(event.target.value)}
                    inputMode="decimal"
                  />
                </label>
                <label>
                  <span>Unidad</span>
                  <input value={unit} onChange={(event) => setUnit(event.target.value)} />
                </label>
              </div>

              <div className={styles.metaBlock}>
                <span>Puntos seleccionados</span>
                <span>{calibrationDraft.length}/2</span>
              </div>

              <div className={styles.metaBlock}>
                <span>Longitud en pixeles</span>
                <span>{draftCalibrationPixels ? formatPixels(draftCalibrationPixels) : "Pendiente"}</span>
              </div>

              <div className={styles.buttonRow}>
                <button
                  className={styles.primaryButton}
                  onClick={applyCalibration}
                  disabled={calibrationDraft.length !== 2}
                >
                  Aplicar escala
                </button>
                <button className={styles.secondaryButton} onClick={() => setCalibrationDraft([])}>
                  Limpiar
                </button>
              </div>

              {calibration ? (
                <div className={styles.calibrationBadge}>
                  1 {calibration.unit} = {formatPixels(calibration.pixelsPerUnit)}
                </div>
              ) : null}
            </div>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardIndex}>04</span>
                <div>
                  <h2>Patrones de producto</h2>
                  <p>La propuesta se apoya en convenciones de software cientifico ya asentadas.</p>
                </div>
              </div>

              <ul className={styles.insightList}>
                <li>Calibracion explicita con una longitud conocida antes de medir.</li>
                <li>Overlays no destructivos para mostrar marcas sin alterar la imagen original.</li>
                <li>Objetos y anotaciones persistentes con lectura inmediata del valor medido.</li>
                <li>Barra de escala visible en pantalla para contexto continuo durante la revision.</li>
              </ul>
            </div>
          </aside>

          <section className={styles.viewerColumn}>
            <div className={styles.viewerHeader}>
              <div>
                <span className={styles.viewerLabel}>Workbench</span>
                <h2>Visor calibrado</h2>
              </div>

              <div className={styles.viewerActions}>
                <button className={styles.secondaryButton} onClick={() => setZoom(1)}>
                  Ajustar zoom
                </button>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setShowScaleBar((current) => !current)}
                  disabled={!calibration}
                >
                  {showScaleBar ? "Ocultar escala" : "Mostrar escala"}
                </button>
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
                if (toolMode !== "navigate") {
                  handleCanvasClick(event.clientX, event.clientY);
                }
              }}
              data-mode={toolMode}
            >
              {imageAsset ? (
                <>
                  <Image
                    className={styles.stageImage}
                    src={imageAsset.src}
                    alt="Microscopy sample"
                    width={imageAsset.width}
                    height={imageAsset.height}
                    unoptimized
                    style={{
                      width: `${renderedWidth}px`,
                      height: `${renderedHeight}px`,
                      left: `${imageX}px`,
                      top: `${imageY}px`,
                    }}
                  />

                  <svg className={styles.overlay} viewBox={`0 0 ${viewport.width} ${viewport.height}`}>
                    {calibration && (
                      <MeasurementLine
                        start={imageToScreen(calibration.start)}
                        end={imageToScreen(calibration.end)}
                        label={`${formatNumber(calibration.knownDistance)} ${calibration.unit}`}
                        color="#f4d35e"
                        dashed
                      />
                    )}

                    {calibrationDraft.length === 2 && !calibration && (
                      <MeasurementLine
                        start={imageToScreen(calibrationDraft[0])}
                        end={imageToScreen(calibrationDraft[1])}
                        label={formatPixels(draftCalibrationPixels)}
                        color="#f4d35e"
                        dashed
                      />
                    )}

                    {calibrationDraft.length === 1 && (
                      <PointHandle point={imageToScreen(calibrationDraft[0])} color="#f4d35e" />
                    )}

                    {measurements.map((measurement) => (
                      <MeasurementLine
                        key={measurement.id}
                        start={imageToScreen(measurement.start)}
                        end={imageToScreen(measurement.end)}
                        label={`${measurement.name} - ${formatNumber(measurement.value)} ${measurement.unit}`}
                        color={measurement.color}
                      />
                    ))}

                    {measurementDraft && (
                      <PointHandle point={imageToScreen(measurementDraft)} color="#ffb347" />
                    )}

                    {showScaleBar && calibration && scaleBarPixels > 0 ? (
                      <g transform={`translate(36 ${viewport.height - 42})`}>
                        <line
                          x1="0"
                          y1="0"
                          x2={scaleBarPixels}
                          y2="0"
                          stroke="#f9f6ef"
                          strokeWidth="4"
                          strokeLinecap="round"
                        />
                        <line x1="0" y1="-8" x2="0" y2="8" stroke="#f9f6ef" strokeWidth="3" />
                        <line
                          x1={scaleBarPixels}
                          y1="-8"
                          x2={scaleBarPixels}
                          y2="8"
                          stroke="#f9f6ef"
                          strokeWidth="3"
                        />
                        <rect
                          x="-12"
                          y="-34"
                          width={Math.max(scaleBarPixels + 24, 148)}
                          height="52"
                          rx="18"
                          fill="rgba(7, 11, 18, 0.68)"
                        />
                        <text x="0" y="-12" fill="#f9f6ef" fontSize="13" fontWeight="600">
                          {formatNumber(scaleBarUnits)} {calibration.unit}
                        </text>
                      </g>
                    ) : null}
                  </svg>
                </>
              ) : (
                <div className={styles.viewerEmpty}>
                  <div className={styles.viewerEmptyBadge}>Precision Ready</div>
                  <h3>Sube una imagen para iniciar el laboratorio visual.</h3>
                  <p>
                    El visor esta preparado para calibrar desde una referencia conocida y dejar
                    marcas de medicion limpias sobre la fotografia.
                  </p>
                </div>
              )}
            </div>

            <div className={styles.viewerFooter}>
              <span>Rueda del mouse: zoom</span>
              <span>Modo navegar: arrastra para desplazar</span>
              <span>Modo calibrar/medir: clic sobre dos puntos</span>
            </div>
          </section>

          <aside className={styles.panel}>
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardIndex}>05</span>
                <div>
                  <h2>Mediciones</h2>
                  <p>Las marcas quedan registradas con su valor y se pueden retirar una a una.</p>
                </div>
              </div>

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
                <div className={styles.emptyNote}>
                  No hay marcas todavia. Despues de calibrar, cambia a medir y selecciona pares de
                  puntos.
                </div>
              )}
            </div>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardIndex}>06</span>
                <div>
                  <h2>Criterio tecnico</h2>
                  <p>Que hace solida la solucion y donde conviene ir mas lejos.</p>
                </div>
              </div>

              <ul className={styles.insightList}>
                <li>
                  La medicion actual asume que referencia y muestra comparten plano y magnificacion.
                </li>
                <li>
                  Para tomas con perspectiva o inclinacion, el siguiente paso correcto es
                  rectificacion planar por homografia.
                </li>
                <li>
                  Para produccion real, conviene guardar proyectos, exportar capturas y soportar
                  unidades predefinidas como um, mm y nm.
                </li>
              </ul>
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
      <circle cx={point.x} cy={point.y} r="8" fill={color} fillOpacity="0.2" />
      <circle cx={point.x} cy={point.y} r="4" fill={color} />
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
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const offsetX = Math.sin(angle) * 20;
  const offsetY = -Math.cos(angle) * 20;

  return (
    <g>
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={dashed ? "8 6" : "0"}
      />
      <circle cx={start.x} cy={start.y} r="5" fill={color} />
      <circle cx={end.x} cy={end.y} r="5" fill={color} />
      <g transform={`translate(${midX + offsetX} ${midY + offsetY})`}>
        <rect
          x="-74"
          y="-17"
          width="148"
          height="34"
          rx="17"
          fill="rgba(6, 10, 17, 0.85)"
          stroke="rgba(255, 255, 255, 0.08)"
        />
        <text
          x="0"
          y="4"
          textAnchor="middle"
          fill="#f9f6ef"
          fontSize="12"
          fontWeight="600"
        >
          {label}
        </text>
      </g>
    </g>
  );
}
