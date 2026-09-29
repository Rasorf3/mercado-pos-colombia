# Historial de ventas y comprobante local

Implementado y verificado el 2026-09-28 con Electron 44.4.5. Funciona offline y utiliza SQLite local. La integración DIAN continúa pendiente de configuración fiscal confirmada.

## Uso

1. Abre **Historial** para listar ventas, filtrar desde/hasta y elegir 20, 50 o 100 resultados por página. Las fechas incluyen el día completo en Colombia (UTC−5), aunque el equipo use otra zona horaria. El orden es fecha descendente y orden de inserción para desempates.
2. **Abrir** muestra el identificador completo, fecha, estado, líneas, cantidades, precios unitarios, descuento aplicado e importes guardados, total, pago, cambio y comprador de esa operación, si existe. Los datos no se reconstruyen desde el catálogo o el perfil actual.
3. **Imprimir comprobante** abre el diálogo de impresión para elegir impresora y opciones. **Guardar PDF** abre un diálogo de ubicación. Ambas acciones están en el cierre de una venta, en su detalle y en el detalle accesible desde las ventas recientes.
4. Una cancelación es un resultado normal y visible. Si no hay impresoras instaladas, se informa que puede usarse PDF. Un error permite reintentar sobre la misma venta. Una solicitud concurrente se rechaza mientras otra tenga el diálogo abierto.

## Formato y límites del papel

- Anchos disponibles: 58 y 80 mm. El valor inicial es 80 mm; no representa ninguna configuración fiscal.
- Margen por lado configurable: entero de 2 a 8 mm, inicialmente 3 mm. El ancho del contenido se calcula restando ambos márgenes al ancho del papel.
- Largo por página configurable: entero de 100 a 400 mm, inicialmente 200 mm. Las ventas largas continúan en nuevas páginas, con el identificador y el aviso local repetidos. No se implementa corte automático, cajón monedero ni protocolo ESC/POS.
- Los ajustes válidos se recuerdan en `localStorage` de la caja. No modifican la venta. Una preferencia inválida o un almacenamiento no disponible vuelve al formato inicial.
- El controlador puede rechazar, sustituir o escalar tamaños personalizados, imponer márgenes o usar un área imprimible menor al ancho nominal. Elegir el mismo papel en sus propiedades, escala 100 % y comprobar el resultado en el dispositivo. No se garantiza un formato continuo de longitud ilimitada.
- Electron recibe tamaño en micras para `webContents.print`, márgenes en píxeles enteros y tamaño/márgenes en pulgadas para `printToPDF`. No reutilizar las unidades de una API en la otra.

La plantilla es HTML/CSS sin recursos externos y usa fuentes del sistema. Productos, comprador, identificadores y referencias se escapan como texto. Encabeza cada página con **COMPROBANTE LOCAL — NO ES FACTURA ELECTRÓNICA** y **Facturación electrónica pendiente**. Muestra el descuento y los importes persistidos en COP, no recalcula totales/impuestos ni agrega numeración fiscal, CUFE, CUDE o datos DIAN. El cambio se imprime para efectivo; el detalle conserva también el valor guardado para los demás medios.

## Descuentos de producto

En el formulario del catálogo se puede guardar una promoción porcentual (hasta dos decimales) o un valor fijo en COP por unidad/empaque, con fechas inicial y final. Ambas fechas cuentan como días completos de Colombia. En caja se activa automáticamente cuando está vigente; durante el paso de pago el cajero puede quitarla o sustituir el tipo/valor solo para esa venta. El descuento fijo se multiplica por la cantidad vendida, incluso si es fraccionaria; no puede superar el precio de venta de una unidad.

Los porcentajes se almacenan como puntos básicos; los importes fijos y resultantes son enteros COP. El bruto de cada línea y su descuento se redondean por separado al COP más cercano, mitad hacia arriba; el neto de línea es bruto menos descuento. El historial y el comprobante usan la instantánea guardada. Estos descuentos comerciales no determinan ni sustituyen impuestos.

## Datos, IPC y seguridad

- `packages/contracts/src/salesHistory.ts`: solicitudes de listado y salida; UUID, paginación, fechas y tamaño de papel acotados. No se aceptan propiedades adicionales.
- `SalesService.listSales` y `getSale`: lecturas de las tablas de ventas e instantáneas. Se mantiene `listRecentSales` para compatibilidad. No fue necesaria una migración: ya existen las tablas, instantáneas e índice por fecha.
- `salesHandlers.ts`: requiere la ventana principal y su frame principal. El renderer solo dispone de funciones explícitas del preload. La ventana principal bloquea navegación solicitada a otros documentos.
- `ReceiptService`: relee la venta en main usando su UUID y solo recibe la capacidad `getSale`. El adaptador de salida no tiene acceso a SQLite. Los archivos se guardan exclusivamente en la ubicación seleccionada en el diálogo nativo.
- La ventana de comprobante tiene `contextIsolation`, sandbox, `nodeIntegration: false`, `javascript: false` y ningún preload. Aplica CSP sin scripts ni recursos externos, bloquea permisos/navegación y se destruye incluso al fallar o cerrar la caja.
- El proceso de salida no llama a `createSale`, no inserta movimientos, no vuelve a cobrar y no cambia `local_pending_invoice`. Imprimir o guardar un PDF no acredita recepción en papel ni facturación electrónica.

Los PDFs pueden contener datos personales del comprador que ya estaban asociados a la venta. El cajero elige dónde guardarlos; no se añaden al repositorio ni se envían a servicios externos.

## Verificación de esta ronda

- `npm test`: 27 pruebas pasaron (14 POS, 4 contratos, 8 dominio y 1 API). Las nuevas pruebas cubren persistencia al reabrir SQLite, instantáneas tras editar/desactivar producto y comprador, exactitud mayor que `Number.MAX_SAFE_INTEGER`, paginación, límites de día colombiano, fechas inválidas, origen IPC, solicitudes manipuladas, escape HTML y reintentos sin efectos sobre la base.
- Cancelaciones, falta de impresoras, fallo de carga, fallo de PDF/escritura e impresión fallida se prueban con un adaptador simulado. Se comparan filas completas de ventas, líneas, pagos, comprador, movimientos, productos y clientes antes/después.
- `npm run typecheck` y `npm run build`: correctos. La compilación conserva el aviso previo `MODULE_TYPELESS_PACKAGE_JSON`.
- `npm run dev:pos`: arrancó y abrió una ventana `Mercado POS Colombia`.
- Prueba de interfaz con el código empaquetado, perfil SQLite aislado y acceso HTTP/HTTPS bloqueado: navegación del historial con 23 ventas (20/3 por página), apertura de detalle tras editar producto/cliente y PDF real desde el detalle y desde una venta recién cerrada. Se comprobó el estado de ventas/pagos/stock antes/después. La selección de archivo, cancelación de impresión y ausencia de impresoras se simularon; se comprobó que la llamada de impresión usa `silent: false`.
- PDF real con el motor de Electron instalado: ventas sintéticas de 3 y 40 productos, nombres de 120 caracteres, cadenas sin espacios, cantidades fraccionarias y comprador con caracteres HTML. Se exportó cada combinación de tamaño/venta dos veces después de editar productos y cliente; las filas SQLite permanecieron iguales.
- Revisión visual: cuatro PDFs de 58/80 mm, márgenes de 3 mm y largo de 200 mm. Se inspeccionaron sus páginas renderizadas; nombres largos ajustados al ancho, sin superposición ni texto fuera de márgenes, avisos repetidos y totales presentes. Se verificaron dimensiones, número de líneas e importes por extracción. Con esta prueba de estrés: 58 mm produce 2/14 páginas y 80 mm produce 2/11 páginas para 3/40 productos, respectivamente.
- Impresora física: **no comprobada**. El equipo solo enumeró `OneNote (Desktop)` y `Microsoft Print to PDF`. Falta comprobar selección y cancelación del diálogo nativo con el controlador final, área imprimible, escala, márgenes y salida real en papel de ambos anchos. La aceptación de un trabajo por el sistema no prueba que la impresora haya entregado papel.
- `git diff --check`: correcto; Git informa avisos de conversión LF/CRLF en archivos con cambios previos. También se revisaron espacios finales de archivos nuevos, que todavía no están rastreados.

### Reproducir los PDFs de prueba

Desde la raíz, con las dependencias existentes:

```bash
npm run build:packages
node apps/pos/scripts/verify-receipts.cjs
```

El script utiliza Webpack, Electron y SQLite ya instalados; genera cuatro PDFs y `results.json` en `tmp/pdfs/receipt-qa/` (ignorado por Git). Usa una base sintética en memoria y un perfil Electron aislado. La ubicación de guardado se simula para automatizar la prueba; el PDF se genera con la misma implementación real de salida. No envía trabajos a impresoras. Renderizar estos PDFs con Poppler para repetir la inspección visual; los archivos de prueba no sustituyen una calibración física.

## Referencias técnicas

Consultadas el 2026-09-28 y contrastadas con `electron/electron.d.ts` de la versión instalada 44.4.5:

- [Electron webContents: impresión, impresoras y PDF](https://www.electronjs.org/docs/latest/api/web-contents#contentsprintoptions-callback).
- [Electron printToPDF](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions).
- [Electron diálogo de guardado](https://www.electronjs.org/docs/latest/api/dialog#dialogshowsavedialogbrowserwindow-options).
