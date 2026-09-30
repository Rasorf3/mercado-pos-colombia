# Arquitectura inicial

## Objetivo

Separar la experiencia de caja local, la API y las reglas de negocio para que cada parte pueda evolucionar sin mezclar responsabilidades.

```text
┌──────────────────────────────┐
│ apps/pos                     │
│ Electron main + preload      │
│ React renderer                │
│ SQLite local                   │
│ catálogo, stock, clientes, caja y ventas │
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
- `packages/domain` aloja reglas puras de catálogo, inventario y ventas, sin acceso a interfaz o persistencia.
- SQLite persiste catálogo, movimientos, clientes, turnos de caja, ventas locales, líneas congeladas, instantánea de comprador opcional y un pago por venta en el directorio local de Electron, fuera del repositorio.
- Para productos registrados por unidad se puede definir un peso opcional por empaque en g, kg o lb. El stock y los movimientos permanecen en unidades; la interfaz muestra el equivalente calculado con aritmética entera.
- El renderer llama operaciones explícitas de catálogo y ventas por `preload`; solo el proceso principal accede a SQLite.
- El costo y precio se guardan como enteros COP. Las cantidades se guardan en milésimas enteras (1 unidad = 1000 milésimas) y se convierten a texto decimal en las fronteras.
- El catálogo puede guardar una promoción de producto (porcentaje con hasta dos decimales, o descuento entero COP por unidad/empaque) con fechas inicial y final inclusivas del calendario `America/Bogota`. Se activa automáticamente al agregar el producto a una venta durante esas fechas; en el paso de pago el cajero puede cambiarla para esa operación sin alterar la promoción del catálogo.
- La creación, entradas y ajustes escriben el saldo y su movimiento en una sola transacción SQLite. La migración versionada crea las tablas e índices.
- El cierre de una venta inserta venta, instantánea de productos, pago y movimientos de salida, y descuenta existencias en una transacción inmediata. Cualquier fallo revierte el conjunto completo.
- Cada venta conserva el tipo y valor efectivo del descuento y su importe por línea; editar después el precio o la promoción del producto no cambia el historial ni el comprobante.
- Dinero y descuentos se calculan con `bigint`: primero se redondea el importe bruto de cada línea al COP más cercano (mitad hacia arriba); el descuento porcentual o fijo por unidad se calcula para la cantidad de esa línea y se redondea con la misma regla; el subtotal neto es bruto menos descuento. El total es la suma de subtotales netos. No se aplica ni se supone IVA.
- Las ventas locales usan `local_pending_invoice`; este estado no afirma emisión, validación ni aceptación de la DIAN. No hay conexión fiscal ni procesamiento/verificación del pago.
- `main/cash/CashService` mantiene un turno de caja abierto como máximo por instalación. Las ventas nuevas requieren ese turno y conservan su ID; cierre y desglose por método son una instantánea inmutable SQLite. El efectivo esperado es fondo inicial más ventas en efectivo netas de cambio. Empleado vende con caja abierta, pero solo Admin/EmpleadoJefe abren o cierran. Las ventas anteriores a la migración 7 quedan sin asociación.
- Los perfiles locales guardan nombre/razón social, tipo y número de identificación y correo opcional; no se recopilan dirección o teléfono. Una venta puede no tener comprador y congela los datos del cliente seleccionado en una instantánea inmutable.
- Los métodos se persisten con IDs estables (`cash`, `debit_card`, `credit_card`, `bank_transfer`, `nequi`, `daviplata`, `bre_b`); la UI presenta etiquetas en español.
- Un código de barras no puede repetirse. El código interno no es único en este alcance; solo se exige unicidad al código de barras.
- El acceso al POS exige sesión local. Auth, contratos y permisos atraviesan React → preload → IPC → proceso principal; contraseñas se derivan con `scrypt` y permisos se vuelven a validar en cada operación protegida.
- La migración v4 crea cuentas/roles y atribuye nuevas ventas, movimientos, altas y ediciones a un usuario; la v5 añade peso opcional por unidad sin alterar existencias históricas. Datos anteriores conservan su actor como `NULL` y peso no definido.
- El historial de ventas y la ficha de producto muestran el nombre de quien registró la venta, creó el producto o realizó cada movimiento de stock. Admin puede asignar Admin, EmpleadoJefe o Empleado; AdminMaster sigue reservado.
- AdminMaster no se asigna ni aprovisiona desde la interfaz. Su identidad está reservada, sin contraseña compartida ni puerta trasera distribuida.

## Historial y comprobantes locales

- `SalesService.listSales` consulta SQLite con paginación y rango de fechas inclusivas en Colombia (UTC−5). Reutiliza el índice `sales_created_at`; no requiere migración. `getSale` lee `sales`, `sale_items`, `sale_payments` y `sale_buyer_snapshots`, sin consultar nombres o precios actuales del catálogo/directorio.
- React usa `sales.listSales`, `getSale`, `printReceipt` y `exportReceiptPdf` por el preload explícito. Los handlers del proceso principal verifican ventana/frame de origen y contratos TypeBox; la paginación, fechas reales, UUID y formato de papel tienen límites. El renderer no envía HTML, rutas de archivo ni importes para impresión.
- `main/receipts/receiptService.ts` solo recibe capacidad de lectura de ventas y un adaptador de salida. Obtiene la instantánea en SQLite y genera el documento escapando texto. Exportar/reimprimir no escribe ventas, pagos, estados o stock.
- `electronReceiptOutput.ts` usa una ventana temporal sin preload, con aislamiento, sandbox, Node y JavaScript deshabilitados. HTML/CSS y fuentes de sistema funcionan offline; CSP, bloqueo de navegación y de recursos externos protegen el documento. Se destruye la ventana al finalizar o fallar.
- Electron abre el diálogo de impresión (`silent: false`) y el de ubicación del PDF. El formato de 58/80 mm, margen y largo por página se validan; son preferencias locales del renderer, independientes de SQLite. El controlador físico puede imponer límites distintos. Solo un comprobante puede estar en proceso a la vez.

Ver [`local-sales-history-and-receipts.md`](local-sales-history-and-receipts.md) para uso, pruebas y límites físicos. La integración DIAN sigue pendiente de configuración fiscal confirmada.

La matriz y los límites de autenticación se describen en [`users-and-roles.md`](users-and-roles.md).

El alcance, la fórmula del saldo, las limitaciones y la operación de Caja se documentan en [`cash-opening-and-closing.md`](cash-opening-and-closing.md).

## Evolución prevista

1. Definir idempotencia y estados de sincronización para ventas locales.
2. Añadir sincronización autenticada hacia PostgreSQL.
3. Diseñar la integración DIAN después de cerrar requisitos fiscales y de seguridad.
