Aplicacion web construida con [Next.js](https://nextjs.org) y preparada como PWA para instalacion en navegador.

## Desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Produccion

```bash
npm run build
```

## PWA

La app incluye:

- `manifest.webmanifest` desde `src/app/manifest.ts`
- `service worker` en `public/sw.js`
- modo instalable desde navegadores compatibles

## Notas

Se elimino toda la integracion de Tauri. El proyecto ahora es solo webapp + PWA.
