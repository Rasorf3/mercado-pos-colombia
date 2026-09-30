# Fiados y cuentas por cobrar locales

Estado: implementado para operación local offline. No procesa pagos ni cambia el estado de facturación electrónica.

## Reglas de operación

- Un fiado se activa expresamente en cada venta. Requiere un cliente existente y activo; todo el total de la venta queda pendiente. No se crea un pago inicial. Una venta fiada debe tener total mayor que cero.
- El límite inicial es **$300.000 COP**. Puede configurarse al crear el cliente y ampliarse después. La aplicación impide registrar un fiado si saldo actual + venta supera el cupo; el límite tampoco puede reducirse por debajo de lo adeudado. Un límite de cero deshabilita nuevos fiados.
- Los roles que pueden vender —Admin, EmpleadoJefe y Empleado— pueden consultar cuentas, autorizar fiados, registrar abonos y ampliar el límite del cliente. AdminMaster conserva todas las capacidades. Las operaciones están protegidas en IPC, no solo ocultas en React.
- Un abono se registra como operación aparte, con monto positivo no superior al saldo, usuario, fecha y medio declarado. La app no procesa tarjetas ni valida transferencias. Referencia para transferencia/Nequi/DaviPlata/Bre-B y autorización para tarjeta son opcionales.
- No se deben guardar número de tarjeta, CVV/CVC, PIN, claves, contraseñas ni credenciales bancarias. El sistema valida entradas sensibles comunes y no ofrece campos para credenciales.
- Si el abono es en efectivo, debe existir un turno abierto. El abono queda vinculado al turno y se suma al efectivo esperado. Los abonos no monetarios también se incluyen en el desglose del turno cuando se reciben mientras hay una caja abierta, pero no aumentan el efectivo esperado. Un abono no monetario puede registrarse sin turno.

## Persistencia e integridad

La migración SQLite v8 agrega teléfono, dirección y límite a clientes; teléfono y dirección a la instantánea inmutable de comprador; y tipo de liquidación a ventas antiguas con valor `paid`. La tabla `client_credit_entries` guarda cargos de venta y abonos como un libro inmutable; el saldo se calcula como cargos menos abonos. Los cambios posteriores de perfil no reescriben las ventas ni los movimientos de cuenta anteriores.

Venta fiada, comprador congelado, líneas/precios, cargo en cartera, salidas de inventario y descuento de stock se confirman en una única transacción SQLite. Un fallo revierte todo. Los abonos, auditoría de ampliación de cupo y su vinculación a la caja también se guardan transaccionalmente; los cierres congelan total y desglose por medio de pago. La base evita sobrepasar el cupo, abonar más del saldo y editar/borrar movimientos del libro.

La venta sigue en estado interno `local_pending_invoice`. Un cargo por fiado no es pago recibido, factura ni documento aceptado por la DIAN. Los comprobantes siguen diciendo **COMPROBANTE LOCAL — NO ES FACTURA ELECTRÓNICA**.

## Límites

- No hay cobro automático, integración con bancos, recordatorios, intereses, cuotas, vencimientos, cartera compartida, informes de antigüedad, notas crédito ni sincronización entre equipos.
- Las cuentas y su libro viven en el SQLite local de la caja. Se requiere una estrategia de copia de seguridad/restauración antes de usarlo como registro contable principal.
- El máximo visible por consulta es 100 clientes y los últimos 100 movimientos del cliente elegido.
