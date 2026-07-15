# Escala y Medicion

Aplicacion web para calibrar imagenes, medir distancias, calcular areas y exportar resultados anotados sobre fotografias de microscopio u otras imagenes tecnicas.

El proyecto esta construido con Next.js App Router y funciona como una PWA instalable. No depende de Tauri ni de ningun contenedor de escritorio: hoy es una webapp pura.

## Que hace

- Carga imagenes locales desde el navegador.
- Calibra escala con dos puntos sobre la imagen o con equivalencia manual en pixeles.
- Mide distancias sobre la imagen calibrada.
- Calcula areas poligonales.
- Muestra una barra de escala visual.
- Permite ajustar tamano de etiquetas, lineas y escala.
- Guarda calibraciones en el navegador para reutilizarlas.
- Exporta la imagen anotada en PNG o JPG.
- Puede instalarse como PWA y seguir funcionando sin conexion despues de la primera carga.

## Casos de uso

- Medicion de muestras en imagenes de microscopio.
- Revision visual de escalas en capturas tecnicas.
- Generacion rapida de imagenes anotadas para informes o laboratorio.
- Trabajo offline en terreno o en entornos con conectividad limitada.

## Stack tecnico

- Next.js 16
- React 19
- TypeScript
- CSS Modules
- Service Worker manual en `public/sw.js`
- Web App Manifest en `src/app/manifest.ts`

## Requisitos

- Node.js LTS recomendado
- npm
- Navegador moderno con soporte para:
  - Canvas
  - Service Workers
  - Local Storage
  - PWA install prompt en navegadores compatibles

## Instalacion

Clona el repositorio e instala dependencias:

```bash
npm install
```

## Desarrollo local

Inicia el servidor:

```bash
npm run dev
```

Luego abre:

```text
http://localhost:3000
```

## Scripts disponibles

- `npm run dev`: inicia el entorno de desarrollo.
- `npm run build`: genera el build de produccion.
- `npm run start`: sirve el build de produccion.
- `npm run lint`: ejecuta ESLint.

## Uso de la aplicacion

### 1. Cargar una imagen

Pulsa `Subir imagen` y selecciona un archivo local.

Formatos aceptados por la interfaz:

- PNG
- JPEG / JPG
- WebP
- TIFF

### 2. Calibrar la escala

La app necesita una escala activa antes de medir distancias o areas.

Opciones disponibles:

- `Con puntos`: haces clic en dos puntos de referencia dentro de la imagen y defines la distancia real entre ellos.
- `Manual`: introduces una equivalencia del tipo `250 px = 100 um`.

Campos usados en la calibracion:

- `Distancia` o `Medida real`
- `Unidad`
- `Pixeles`

Ejemplo:

```text
250 px = 100 um
```

### 3. Medir distancias

Con la herramienta `Medir`:

- haz clic en el punto inicial
- haz clic en el punto final
- la app crea una medicion con nombre automatico como `M01`, `M02`, etc.

Cada medicion puede editarse despues:

- nombre
- posicion de etiqueta
- orientacion de etiqueta
- tipo de terminacion

### 4. Medir areas

Con la herramienta `Area`:

- haz clic para marcar vertices
- pulsa `Cerrar area` cuando tengas al menos 3 puntos
- la app calcula el area usando la escala activa

Las areas se nombran automaticamente como `A01`, `A02`, etc. y luego pueden renombrarse.

### 5. Ajustar la visualizacion

La app permite ajustar:

- tamano de etiquetas
- grosor de lineas
- tamano visual de la barra de escala
- zoom
- paneo de la imagen

Tambien puedes:

- ocultar o mostrar la barra de escala
- resetear la vista
- cambiar la unidad de visualizacion de areas

### 6. Exportar resultados

Puedes exportar la imagen anotada como:

- PNG
- JPG

La exportacion incluye:

- imagen original
- mediciones
- areas
- etiquetas
- barra de escala, si esta visible

En navegadores compatibles se usa `showSaveFilePicker`. Si no esta disponible, la app descarga el archivo automaticamente.

## PWA y modo offline

La aplicacion incluye soporte PWA:

- `manifest.webmanifest` generado desde `src/app/manifest.ts`
- `service worker` en `public/sw.js`
- modo `standalone`

Comportamiento esperado:

- la app debe abrirse al menos una vez con conexion para cachear los recursos principales
- despues de esa primera carga puede seguir funcionando offline
- el boton `Instalar app` aparece cuando el navegador ofrece instalacion

### Que se cachea

El service worker cachea principalmente:

- `/`
- `manifest.webmanifest`
- iconos principales
- assets estaticos de Next bajo `/_next/static/`

## Persistencia de datos

La aplicacion no usa backend ni base de datos.

Todo se procesa del lado del cliente y las calibraciones guardadas se almacenan en `localStorage` del navegador.

Actualmente se persiste:

- lista de calibraciones guardadas
- ultima calibracion usada

Esto implica:

- los datos no se sincronizan entre dispositivos
- si el usuario limpia el almacenamiento del navegador, se pierden esas calibraciones
- las imagenes no se suben a un servidor

## Privacidad

El flujo principal de trabajo es local en el navegador:

- la imagen seleccionada se carga mediante APIs del navegador
- las mediciones se calculan localmente
- la exportacion se genera localmente con canvas

Esto reduce dependencia de servicios externos para el uso normal de la app.

## Estructura del proyecto

```text
src/
  app/
    layout.tsx          Layout y metadata base
    manifest.ts         Web App Manifest
    page.tsx            UI principal y logica de medicion
    globals.css         Variables globales y estilos base
    page.module.css     Estilos de la pantalla principal
public/
  sw.js                 Service Worker de la PWA
  icon.png              Icono principal
  apple-icon.png        Icono para dispositivos Apple
```

## Build de produccion

Genera el build:

```bash
npm run build
```

Sirvelo localmente:

```bash
npm run start
```

## Despliegue

Puedes desplegarlo como una aplicacion web Next.js convencional.

Opciones tipicas:

- Vercel
- servidor Node propio
- cualquier plataforma compatible con Next.js

Antes de desplegar, verifica:

- `npm run lint`
- `npm run build`

## Limitaciones conocidas

- La app depende de una calibracion correcta. Si la escala se define mal, las mediciones y areas seran incorrectas.
- Las calibraciones guardadas viven solo en el navegador del usuario.
- El modo offline requiere una primera carga online.
- El soporte de instalacion PWA depende del navegador.
- La exportacion usa las APIs del navegador; el comportamiento de guardado puede variar segun plataforma.

## Desarrollo y mantenimiento

Si vas a extender el proyecto, los puntos principales estan en:

- [src/app/page.tsx](/Users/alfonsomoreno/Developer/medidas/src/app/page.tsx): flujo completo de carga, calibracion, medicion, areas, exportacion e instalacion PWA
- [src/app/manifest.ts](/Users/alfonsomoreno/Developer/medidas/src/app/manifest.ts): manifest de la PWA
- [public/sw.js](/Users/alfonsomoreno/Developer/medidas/public/sw.js): cache offline
- [next.config.ts](/Users/alfonsomoreno/Developer/medidas/next.config.ts): configuracion de Next.js

## Checklist rapida para nuevos usuarios

1. Instala dependencias con `npm install`.
2. Ejecuta `npm run dev`.
3. Abre `http://localhost:3000`.
4. Sube una imagen.
5. Aplica una calibracion.
6. Mide distancias o areas.
7. Exporta el resultado.

## Estado del proyecto

El repositorio esta orientado a una experiencia web + PWA. Toda la integracion anterior de escritorio basada en Tauri fue retirada.
