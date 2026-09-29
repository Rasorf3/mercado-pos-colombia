# AI handoff

Guía breve para continuar el trabajo en este repositorio. Es un resumen operativo, no sustituye las instrucciones del proyecto: lee primero el [`AGENTS.md`](../AGENTS.md) y respeta sus límites. Si este documento y el código no coinciden, inspecciona el estado actual del repositorio y actualiza la documentación correspondiente.

## Proyecto y estado actual

Mercado POS Colombia es una caja de escritorio local-first. El monorepo usa Node.js 24, npm workspaces, Electron Forge + Webpack + TypeScript + React, Fastify y SQLite. La API solo tiene `/health`; PostgreSQL y la sincronización no están implementados. Electron está en la línea 44 (`^44.4.5`).

Ya existen:

- Catálogo local: crear, editar, buscar y desactivar productos; código de barras único.
- Inventario local: existencias iniciales, entradas, ajustes y salidas de venta como movimientos trazables. No cambies el stock sin insertar el movimiento correspondiente.
- Venta local mínima offline: un método de pago por venta, instantánea de las líneas, descuento de inventario y persistencia dentro de una transacción SQLite. El estado es `local_pending_invoice`; no es factura electrónica ni acredita envío, validación o aceptación por la DIAN.
- Clientes locales: crear, editar, buscar y desactivar perfiles; ventas pueden omitir comprador o guardar una instantánea inmutable del cliente elegido dentro de la transacción de venta. Solo se guardan nombre, tipo/número de identificación y correo opcional.
- Historial local paginado y filtrado por días de Colombia (UTC−5), con detalle de las instantáneas guardadas. Reutiliza las tablas e índice existentes, sin migración nueva.
- Comprobante local de 58/80 mm con impresión mediante diálogo y PDF mediante selección de ubicación, accesibles al cerrar la venta y desde su detalle. Los márgenes/largo por página son configurables; no hay recursos de internet ni efectos sobre ventas o inventario al reimprimir.
- Acceso local con alta única del primer Admin, hash de contraseñas `scrypt`, cierre de sesión, administración de usuarios y permisos verificados en handlers IPC. Empleado solo ve el flujo de ventas, puede crear clientes y recibe una proyección de productos sin costo. Las cuentas solo se guardan localmente.
- Migración SQLite v4: cuentas/roles y atribución del actor en operaciones nuevas de venta, inventario, productos y clientes. Históricos se mantienen con actor nulo.
- Pruebas de dominio, contratos, persistencia SQLite, migraciones y reversión completa de una venta ante error.

La verificación del 2026-09-28 pasó `npm test` (27 pruebas), `npm run typecheck`, `npm run build`, `git diff --check` y el inicio de `npm run dev:pos` con una ventana visible. Se generaron y revisaron visualmente PDFs reales de 58/80 mm, incluidos 40 productos con nombres largos; también se probó navegación y PDF desde cierre/detalle con perfil aislado y red bloqueada. No se probó una impresora física ni la interacción manual con los diálogos del controlador: cancelaciones y selección de ruta se simularon. Solo se detectaron impresoras virtuales. La compilación y las pruebas pueden mostrar avisos no bloqueantes `MODULE_TYPELESS_PACKAGE_JSON` relacionados con la detección de módulos. Repite las verificaciones después de modificar el código; el árbol de trabajo puede haber cambiado desde esa ejecución.

El 2026-09-29, tras añadir autenticación local y roles, pasaron `npm test` (31 pruebas), `npm run typecheck`, `npm run build` y `git diff --check`. Un smoke test de Electron aisló `userData` en una carpeta temporal y comprobó configuración del primer Admin, alta de Empleado, logout/login, navegación limitada y rechazo de IPC para historial/directorios; también comprobó la búsqueda de producto de venta sin costo y alta de cliente. La prueba usó solo datos ficticios y no probó impresora física. El comando de desarrollo se abrió durante la verificación; se cerró antes de repetir la compilación para evitar que Forge compartiera `.webpack` entre ambos procesos.

## Mapa del código

- `apps/pos/src/renderer/`: React; no accede directamente a Node, Electron ni SQLite.
- `apps/pos/src/preload.ts`: API acotada expuesta al renderer.
- `apps/pos/src/main.ts` y `apps/pos/src/main/`: ciclo de vida Electron, IPC, servicios y SQLite.
- `apps/pos/src/main/database/`: apertura de SQLite y migraciones versionadas.
- `apps/pos/src/main/sales/`: lecturas de historial/detalle, cierre de ventas y validación de solicitudes IPC. `main/receipts/`: plantilla escapada, servicio de solo lectura y adaptador Electron de impresión/PDF.
- `apps/pos/src/renderer/SalesHistoryScreen.tsx`, `SaleDetail.tsx`, `ReceiptActions.tsx`: historial, detalle y controles de salida. `packages/contracts/src/salesHistory.ts`: contratos de consulta y comprobante.
- `apps/api/`: Fastify independiente, actualmente con `/health`.
- `packages/domain/`: reglas puras de catálogo, cantidades, pagos y totales.
- `packages/contracts/`: esquemas TypeBox compartidos.
- `docs/architecture.md`, `docs/offline-sale-flow.md`, `docs/dian.md`: arquitectura, venta offline y límites DIAN.
- `docs/maintenance-electron-44.md`: actualización de Electron y fotografía histórica de `npm audit`; vuelve a ejecutar el audit antes de tomar decisiones de seguridad.
- `docs/local-sales-history-and-receipts.md`: uso, tamaños/márgenes, límites del controlador y verificación PDF/física. `apps/pos/scripts/verify-receipts.cjs` reproduce PDFs sintéticos usando Electron, sin imprimir en dispositivos.

## Invariantes de datos y seguridad

- Dinero: enteros COP; no usar `number` de JavaScript para cálculos monetarios. Las cantidades se almacenan como milésimas enteras y se aceptan hasta tres decimales.
- Total de venta: subtotales calculados exactamente y redondeados por línea al peso COP más cercano, mitad hacia arriba. No se aplica ni se presume IVA.
- La venta conserva una instantánea de nombre, unidad, precio y cantidad. El proceso principal vuelve a leer producto, precio y stock al cerrar la venta.
- La venta conserva una instantánea del comprador opcional. Actualizar o desactivar el perfil nunca cambia el comprador guardado en una venta histórica.
- Historial, detalle y comprobante usan exclusivamente importes/instantáneas guardados. El renderer envía UUID y formato, nunca HTML, rutas ni importes a imprimir; main valida, relee SQLite y escapa texto. Reintentar imprimir/exportar no cambia datos ni estado fiscal. La plantilla muestra “COMPROBANTE LOCAL — NO ES FACTURA ELECTRÓNICA” y facturación pendiente.
- Venta, pago, movimientos `sale_out` y actualización de stock pertenecen a una sola transacción SQLite. Un fallo debe revertirlo todo.
- Los IDs persistidos para métodos de pago son `cash`, `debit_card`, `credit_card`, `bank_transfer`, `nequi`, `daviplata` y `bre_b`. La interfaz usa etiquetas en español.
- Solo se registra el medio declarado; no se procesan tarjetas ni se verifican transferencias. No guardar números de tarjeta, CVV, claves, PIN ni credenciales bancarias. Referencias y códigos de autorización son opcionales y no prueban el pago.
- Mantener `contextIsolation` habilitado, `nodeIntegration` deshabilitado y exponer solo capacidades explícitas por preload.
- La sesión identifica al usuario autenticado por `webContents.id`; cada operación protegida vuelve a consultar que la cuenta esté activa y comprueba su capacidad en main. No confíes solo en botones/secciones ocultos en React.
- Roles estables: `admin_master`, `admin`, `employee_manager`, `employee`. AdminMaster no se asigna desde UI ni existe una credencial de desarrollador integrada. El selector Admin crea solo Admin o Empleado; aprovisionamiento EmpleadoJefe aún requiere decisión.
- Contraseñas: sal aleatoria y hash scrypt, mínimo 12 caracteres; no registrar contraseñas ni hashes en renderer o logs. La SQLite no está cifrada; la cuenta del sistema operativo sigue siendo parte de la frontera de seguridad.
- No añadir secretos, certificados reales, bases SQLite de usuario ni datos reales al repositorio. No hacer llamadas productivas a DIAN.

## Comandos desde la raíz

```bash
npm install
npm run dev:pos
npm run dev:api
npm test
npm run typecheck
npm run build
npm run verify
```

`npm run verify` ejecuta build y pruebas. No hay actualmente un script raíz `lint`; no informes que lint pasó salvo que se configure y ejecute.

## Trabajo pendiente y límites de alcance

No están implementados: emisión electrónica o integración DIAN, sincronización/idempotencia con PostgreSQL, autenticación y aislamiento multi-comercio en la API, proveedores, cierres de caja, suscripciones ni procesamiento/conciliación de pagos. La administración local de usuarios no autentica la API. Faltan recuperación/cambio de contraseñas, bloqueo por inactividad, aprovisionamiento seguro de AdminMaster y alta de EmpleadoJefe. La impresión local/PDF sí existe; calibración física, corte de papel y cajón quedan pendientes. Antes de trabajar requisitos tributarios, consulta fuentes oficiales vigentes y registra fuente, versión y fecha en `docs/dian/`. La integración DIAN sigue pendiente de configuración fiscal confirmada. Mantén cualquier integración externa aislada y empieza en ambiente de pruebas.

Antes de editar, revisa `git status` y los cambios locales para preservar trabajo previo; no presupongas que el checkout está limpio. No hagas commit, push, cambios de dependencias de seguridad ni amplíes el alcance sin autorización explícita.
