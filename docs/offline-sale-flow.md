# Flujo de venta offline

La caja ya implementa la captura local mínima descrita abajo. La sincronización y facturación electrónica siguen pendientes.

## Flujo propuesto

1. El renderer carga productos activos desde SQLite por una capacidad limitada de `preload`.
2. El cajero arma un carrito con cantidades de hasta tres decimales, puede buscar y asociar un cliente existente (opcional) y elige un solo método de pago.
3. El proceso principal relee productos, precios y existencias; el dominio valida cantidades, total COP y pago.
4. Una transacción SQLite inserta venta local, instantáneas de sus líneas y del comprador elegido, pago, salidas de inventario y saldos nuevos.
5. Si una escritura falla, SQLite revierte la venta, instantáneas, pago, movimientos y saldos.
6. La pantalla informa `local_pending_invoice`: no es factura electrónica y no se ha emitido ni aceptado por la DIAN.
7. No se procesa la tarjeta ni se verifica transferencia, Nequi, DaviPlata o Bre-B. Las referencias y códigos de autorización son solo datos opcionales declarados.
8. La sincronización hacia la API/PostgreSQL y la facturación electrónica son trabajo futuro.

Después del cierre, la pantalla permite imprimir o guardar un comprobante local en PDF. El historial permite volver a consultar la venta por fecha y abrir su detalle; todos los importes, líneas, pago y comprador provienen de las instantáneas guardadas en SQLite. La edición posterior de productos/clientes no interviene en estas lecturas.

Las solicitudes de impresión/exportación incluyen solo el identificador de la venta y las preferencias de papel. El proceso principal vuelve a leer esa venta existente; no registra otra venta ni modifica inventario, pagos o estado fiscal. Cancelar el diálogo o fallar la impresora/PDF deja la venta disponible para reintentar. Ver [`local-sales-history-and-receipts.md`](local-sales-history-and-receipts.md).

El módulo local de clientes permite crear, editar, buscar y desactivar perfiles. Solo conserva nombre/razón social, tipo y número de identificación y correo; el cliente puede omitirse al vender. Las instantáneas de comprador no se reescriben cuando cambia el perfil.

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
