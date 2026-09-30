# Flujo de venta offline

La caja ya implementa la captura local mínima descrita abajo. La sincronización y facturación electrónica siguen pendientes.

## Flujo propuesto

1. El renderer carga productos activos desde SQLite por una capacidad limitada de `preload`.
2. El cajero arma un carrito con cantidades de hasta tres decimales, puede buscar y asociar un cliente existente (opcional) y termina con un método de pago o activa explícitamente **Fiar esta venta**. El fiado exige un cliente activo y cupo suficiente.
3. El proceso principal relee productos, precios y existencias; el dominio valida cantidades, total COP y pago.
4. Una transacción SQLite inserta venta local, instantáneas de sus líneas y del comprador elegido, pago declarado o cargo de cartera, salidas de inventario y descuento de stock.
5. Si una escritura falla, SQLite revierte la venta, instantáneas, pago/cargo, movimientos y descuento de stock.
6. La pantalla informa `local_pending_invoice`: no es factura electrónica y no se ha emitido ni aceptado por la DIAN.
7. No se procesa la tarjeta ni se verifica transferencia, Nequi, DaviPlata o Bre-B. Las referencias y códigos de autorización son solo datos opcionales declarados.
8. La sincronización hacia la API/PostgreSQL y la facturación electrónica son trabajo futuro.

Después del cierre, la pantalla permite imprimir o guardar un comprobante local en PDF. El historial permite volver a consultar la venta por fecha y abrir su detalle; todos los importes, líneas, pago y comprador provienen de las instantáneas guardadas en SQLite. La edición posterior de productos/clientes no interviene en estas lecturas.

Las solicitudes de impresión/exportación incluyen solo el identificador de la venta y las preferencias de papel. El proceso principal vuelve a leer esa venta existente; no registra otra venta ni modifica inventario, pagos o estado fiscal. Cancelar el diálogo o fallar la impresora/PDF deja la venta disponible para reintentar. Ver [`local-sales-history-and-receipts.md`](local-sales-history-and-receipts.md).

El módulo local de clientes permite crear, editar, buscar y desactivar perfiles con nombre/razón social, identificación, correo, teléfono, dirección y cupo de fiado. Un cliente se puede omitir al pagar; no se puede omitir al fiar. El límite inicial es $300.000 COP y se puede ampliar por cliente. El saldo procede de cargos de venta y abonos registrados en un ledger inmutable. Un abono en efectivo requiere caja abierta y se suma al efectivo esperado; otros medios no se procesan ni verifican. Las instantáneas de comprador no se reescriben cuando cambia el perfil. Ver [`client-credit.md`](client-credit.md).

## Estados previstos

```text
borrador → local_pending_invoice → (integración fiscal futura)
```

No se declara estado de sincronización o estado DIAN en esta etapa. El total suma subtotales por línea; cada línea se redondea half-up al peso COP más cercano. No se calculan impuestos.

## Reglas de seguridad

- Una caída de red no debe borrar una operación confirmada localmente.
- Los reintentos deben ser idempotentes.
- Nunca guardar secretos de infraestructura ni certificados dentro de SQLite o del repositorio.
- La conciliación y los errores de sincronización deben ser visibles para el operador.
