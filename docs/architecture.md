# Arquitectura inicial

## Objetivo

Separar la experiencia de caja local, la API y las reglas de negocio para que cada parte pueda evolucionar sin mezclar responsabilidades.

```text
┌──────────────────────────────┐
│ apps/pos                     │
│ Electron main + preload      │
│ React renderer                │
│ SQLite local (futuro)         │
└──────────────┬───────────────┘
               │ contratos TypeBox
               ▼
┌──────────────────────────────┐
│ apps/api                     │
│ Fastify + TypeScript          │
│ /health y futuras rutas       │
└──────────────┬───────────────┘
               │ futura sincronización
               ▼
┌──────────────────────────────┐
│ PostgreSQL                   │
│ Se añadirá después            │
└──────────────────────────────┘
```

## Límites

- El renderer React solo habla con capacidades explícitas expuestas por `preload`.
- `contextIsolation` está habilitado y `nodeIntegration` deshabilitado.
- La API es un proceso independiente; la pantalla inicial no depende de que la API esté levantada.
- `packages/contracts` contiene esquemas y tipos de frontera.
- `packages/domain` será el lugar de las reglas puras de ventas, inventario e impuestos.
- SQLite se reservará para el almacenamiento local de la caja. No hay una base incluida en el repositorio.

## Evolución prevista

1. Definir el modelo de operación offline y sus estados de sincronización.
2. Implementar el dominio sin acoplarlo a Electron, Fastify o una base concreta.
3. Persistir la cola local en SQLite.
4. Añadir sincronización autenticada hacia PostgreSQL.
5. Diseñar la integración DIAN después de cerrar requisitos fiscales y de seguridad.
