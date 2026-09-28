# Flujo de venta offline

Este documento describe el flujo previsto; todavía no es una implementación.

## Flujo propuesto

1. La caja carga productos y configuración previamente sincronizados.
2. El cajero arma un carrito en el renderer.
3. Un comando explícito atraviesa `preload` hacia el proceso principal.
4. El dominio valida la operación y calcula los totales.
5. La operación se guarda en SQLite local con un identificador único.
6. La pantalla muestra el comprobante local y el estado `pending_sync`.
7. Un sincronizador futuro enviará operaciones pendientes a la API cuando exista conectividad.
8. La API validará contratos y persistirá en PostgreSQL cuando esa etapa sea implementada.

## Estados previstos

```text
draft → committed_local → pending_sync → synced
                         ↘ rejected
```

Los nombres y las transiciones son de diseño inicial y no deben interpretarse como contratos estables todavía.

## Reglas de seguridad

- Una caída de red no debe borrar una operación confirmada localmente.
- Los reintentos deben ser idempotentes.
- Nunca guardar secretos de infraestructura ni certificados dentro de SQLite o del repositorio.
- La conciliación y los errores de sincronización deben ser visibles para el operador.
