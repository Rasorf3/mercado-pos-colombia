# Mercado POS Colombia

Aplicación local de catálogo, inventario y ventas mínimas para un punto de venta en Colombia. Usa Node.js 24, npm workspaces, Electron Forge con React para la caja y Fastify para una API separada.

El acceso a la caja requiere usuario y contraseña. El primer inicio configura un Admin; Admin puede crear cuentas Admin o Empleado. Las funciones de catálogo, inventario, ventas, clientes e historial se habilitan según rol y se autorizan también en el proceso principal.

La caja registra ventas locales offline en SQLite con descuento de existencias y un medio de pago declarado. Permite mantener clientes locales opcionales y asociarlos a una venta; las ventas conservan una instantánea histórica del comprador. Incluye historial paginado, detalle e impresión o exportación PDF de comprobantes locales de 58 y 80 mm. Las ventas quedan pendientes de integración con facturación electrónica: no se emiten ni se envían a la DIAN. No incluye procesamiento o verificación de pagos, sincronización con PostgreSQL, proveedores ni suscripciones.

## Requisitos

- Node.js 24.x
- npm incluido con Node.js

## Instalación

```bash
npm install
```

## Comandos

Desde la raíz del repositorio:

```bash
npm run dev:pos     # compila contratos/dominio e inicia la caja Electron + React
npm run dev:api     # inicia la API Fastify en http://127.0.0.1:3000
npm run typecheck   # valida los tipos de la API y la caja
npm run test        # ejecuta las pruebas configuradas
npm run build       # compila los workspaces
npm run verify      # build + pruebas
```

Para comprobar la API:

```bash
curl http://127.0.0.1:3000/health
```

La respuesta esperada tiene `status: "ok"`, identifica el servicio `api` y contiene una marca de tiempo ISO-8601.

## Historial y comprobantes locales

En **Historial**, filtra por fechas inclusivas del calendario colombiano (UTC−5), elige 20, 50 o 100 ventas por página y abre una venta para consultar sus datos guardados. Cambiar luego el catálogo o el cliente no modifica esa información.

Puedes **Imprimir comprobante** o **Guardar PDF** al terminar una venta y desde su detalle. Elige papel de 58/80 mm; en los ajustes puedes indicar márgenes de 2–8 mm y largo por página de 100–400 mm. La impresión abre el diálogo del sistema y el PDF pide una ubicación. Los ajustes se recuerdan localmente. Revisa el mismo tamaño en el controlador y la escala al 100 %; el área imprimible depende de la impresora.

El documento muestra **COMPROBANTE LOCAL — NO ES FACTURA ELECTRÓNICA** y mantiene visible la facturación electrónica pendiente. Reimprimir no crea ventas ni descuenta existencias.

Consulta los límites, las pruebas y la reproducción de PDFs sintéticos en [`docs/local-sales-history-and-receipts.md`](docs/local-sales-history-and-receipts.md).

Consulta [`docs/users-and-roles.md`](docs/users-and-roles.md) para la matriz de permisos, la cuenta inicial, las decisiones de AdminMaster y los límites de seguridad local.

En cualquier sección, usa **A−** y **A+** en la barra superior para ajustar el tamaño de letra entre 100 % y 150 %; **↺** lo restablece. La preferencia se guarda localmente en esta caja.

## Estructura

```text
.
├── apps/
│   ├── api/          # API Fastify + TypeScript
│   └── pos/          # Electron Forge + React + TypeScript
├── packages/
│   ├── contracts/    # Contratos TypeBox compartidos
│   └── domain/       # Reglas puras de catálogo, inventario y ventas
├── docs/             # Arquitectura, offline y DIAN
├── package.json      # Workspaces y comandos raíz
└── tsconfig.base.json
```

## Límites de seguridad de esta etapa

- `.env.example` contiene únicamente valores locales de ejemplo.
- La base SQLite se crea en el directorio local de datos de Electron, nunca dentro del repositorio.
- Los importes se guardan como enteros COP; cantidades como milésimas enteras para evitar cálculos de punto flotante.
- Cada venta conserva nombre, unidad, precio y cantidad en sus líneas. Se redondea half-up al peso por línea y se suman las líneas; no se calculan impuestos.
- Nombre/razón social, tipo y número de identificación y correo son los únicos datos del perfil local de cliente; identificación y correo son opcionales y no se recopilan dirección ni teléfono. Una venta no requiere cliente.
- Venta, instantánea opcional del comprador, pago y salidas de inventario se guardan en una transacción SQLite; el estado es `local_pending_invoice`, nunca una factura DIAN. La instantánea no cambia si luego se edita o desactiva el perfil.
- Solo se registra un método por venta. No se procesan tarjetas ni se verifican transferencias; las referencias/códigos opcionales no reemplazan credenciales.
- El acceso a SQLite ocurre solo en el proceso principal de Electron. El renderer recibe operaciones limitadas mediante `preload`.
- Las contraseñas se almacenan como hashes `scrypt` con sal individual; la sesión no persiste al reiniciar la aplicación. AdminMaster no tiene cuenta o secreto integrado y no se puede asignar desde la interfaz.
- No se guardan certificados digitales, credenciales ni tokens. Los datos de clientes viven solo en la SQLite local de la caja.
- La documentación de DIAN describe decisiones pendientes y no habilita llamadas externas.

Consulta [`AGENTS.md`](AGENTS.md) antes de ampliar el proyecto.
