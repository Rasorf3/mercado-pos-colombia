# Apertura y cierre de caja local

Estado: primera versión funcional, offline y limitada a una caja por instalación.

## Criterio de operación

- Solo puede existir un turno abierto en la base SQLite de esta instalación. No es una caja compartida entre equipos ni una sesión individual por empleado.
- Admin y EmpleadoJefe pueden abrir y cerrar turnos. Empleado no administra turnos, pero puede registrar ventas mientras haya uno abierto.
- El fondo inicial y el conteo final son valores enteros COP. Se guardan como enteros SQLite y se manejan como `bigint` en cálculos; no se admite fracción de peso.
- El cierre puede guardarse aunque el conteo real no coincida con el saldo esperado. La diferencia queda registrada con signo: positivo = sobrante, negativo = faltante.

## Cálculo y relación con ventas

`efectivo esperado = fondo inicial + pagos en efectivo aplicados`

Para pagos en efectivo, el valor aplicado se obtiene del pago guardado como `amount_paid_cop - change_cop`. Los pagos con tarjeta, transferencias, Nequi, DaviPlata y Bre-B se muestran en el resumen por medio de pago, pero no incrementan el efectivo esperado.

Cada venta nueva exige que haya un turno abierto y guarda su `cash_session_id` dentro de la misma transacción SQLite que registra venta, líneas, pago, movimientos y descuento de inventario. Si el turno se cierra o falta, la venta no se guarda ni se descuenta inventario. Al cerrarse el turno, se congela una instantánea del fondo, esperado, conteo real, diferencia, número/total de ventas, efectivo y totales por medio de pago. Las ventas del turno no se editan para corregir una diferencia.

Las ventas preexistentes a la migración 7 conservan `cash_session_id = NULL`; no se atribuyen a un turno nuevo ni se suman retroactivamente a la apertura.

## Límites de esta versión

- No hay operaciones de ingreso/retiro, gastos, depósitos, retiros de caja, apertura de cajón ni conciliación bancaria. El efectivo esperado no puede explicar esos movimientos todavía; el cajero/administrador debe considerar esa limitación al analizar la diferencia.
- El historial de Caja muestra el turno activo y hasta 20 cierres recientes. El detalle de venta identifica el turno cuando la venta fue creada después de la migración.
- El cierre local es un control operativo. No es cierre fiscal, informe DIAN, factura electrónica, conciliación de pagos ni sincronización central.
- Los turnos se guardan en SQLite local y no se sincronizan; una pérdida o daño del perfil local exige una estrategia de respaldo/restauración, que sigue pendiente.

## Integridad y seguridad

- La migración SQLite 7 crea sesiones y totales inmutables de cierre, restringe a un solo turno abierto y asocia las ventas nuevas mediante clave foránea.
- Las operaciones se exponen por funciones explícitas de preload. El proceso principal valida el frame IPC, sesión, capacidad del rol, contratos y montos; el renderer no accede a SQLite.
- El cierre y la escritura del desglose por método ocurren en una única transacción. Si falla cualquier parte, el turno permanece abierto y se puede reintentar sin cierre parcial.
- El saldo esperado, los totales y la diferencia se calculan con enteros exactos. La diferencia se conserva como texto decimal firmado en los contratos.
