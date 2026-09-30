# Mercado POS Colombia

Aplicación de punto de venta local para mercados en Colombia. Usa Node.js 24, npm workspaces, Electron Forge, Webpack, TypeScript y React para la caja, SQLite para sus datos y Fastify para una API separada.

El acceso requiere usuario y contraseña. El primer inicio configura una única cuenta Admin; después Admin puede crear cuentas Admin, EmpleadoJefe o Empleado, pero no AdminMaster. Los permisos se comprueban también en el proceso principal, no solo en la interfaz.

La caja registra ventas locales offline, pagadas o expresamente fiadas, con descuento de existencias y trazabilidad. Incluye catálogo, promociones, clientes, cartera con abonos, apertura/cierre de caja, historial e impresión/PDF de comprobantes de 58 y 80 mm. Las ventas quedan pendientes de integración con facturación electrónica: no se emiten ni se envían a la DIAN. La API actual solo ofrece `/health` y no participa en estas operaciones.

## Requisitos

- Node.js 24.x
- npm 11 o superior

## Instalación

```bash
npm install
```

En el primer inicio del POS, crea la cuenta Admin e inicia sesión. Abre un turno de caja antes de registrar la primera venta. Los datos se guardan en el perfil local de Electron de ese equipo.

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

No hay actualmente un script raíz `lint`; no se debe informar que pasó sin configurarlo y ejecutarlo. En Windows x64, `npm run build` deja la aplicación desempaquetada en `apps/pos/out/@mercado-pos-pos-win32-x64/`, incluido `@mercado-pos-pos.exe`. Mantén juntos el ejecutable y el resto de esa carpeta. No es un instalador ni está firmado; Windows podría mostrar una advertencia de editor desconocido. La ruta puede variar según plataforma o arquitectura.

Para comprobar la API:

```bash
curl http://127.0.0.1:3000/health
```

La respuesta esperada tiene `status: "ok"`, identifica el servicio `api` y contiene una marca de tiempo ISO-8601.
En PowerShell también puedes usar `Invoke-RestMethod http://127.0.0.1:3000/health`.

## Operación local disponible

- **Acceso:** cuenta inicial Admin, contraseña de 5 a 128 caracteres (se recomienda una frase larga y única), aviso de Bloq Mayús y sesión que termina al cerrar la aplicación. AdminMaster es un rol reservado sin cuenta preinstalada ni alta desde la interfaz. EmpleadoJefe puede vender; Empleado puede vender y crear clientes, pero no administrar inventario ni caja. Consulta la [matriz de permisos](docs/users-and-roles.md).
- **Catálogo e inventario:** crear, editar, buscar y desactivar productos, incluido código de barras único y lectura USB tipo teclado. Existencias iniciales, entradas, ajustes y salidas de venta se registran como movimientos con actor. Las cantidades admiten hasta tres decimales. El peso opcional por unidad/empaque en g, kg o lb permite mostrar equivalencias, sin asumir conversiones por empaque.
- **Promociones y venta:** descuentos porcentuales o COP fijo por unidad con vigencia; se aplican automáticamente en caja y pueden editarse para una venta concreta. La venta ocupa dos pasos a ancho completo: carrito y luego pago. En efectivo se debe digitar el monto recibido; el campo inicia en cero y limpia ese cero al enfocarse. Se declara un método por venta: efectivo, débito, crédito, transferencia, Nequi, DaviPlata o Bre-B. El sistema no procesa tarjetas ni verifica transferencias.
- **Clientes y cartera:** perfiles con nombre, identificación, correo, teléfono y dirección cuando se proporcionen. Cliente opcional para venta pagada y obligatorio para fiado. Cada fiado se activa expresamente y carga el total completo, sin pago inicial. Cupo inicial de $300.000 COP por cliente, ajustable sin quedar debajo de su saldo; los abonos posteriores se guardan en un libro trazable. Todos los roles que pueden vender pueden consultar cartera, fiar, registrar abonos y ampliar cupos. Consulta [fiados y abonos](docs/client-credit.md).
- **Caja:** una caja abierta por instalación. Admin y EmpleadoJefe pueden abrir y cerrar turnos; vender exige turno abierto. El cierre conserva fondo inicial, efectivo esperado, conteo real y diferencia. Los abonos en efectivo requieren turno y aumentan el efectivo esperado; los no monetarios no lo aumentan. Consulta [apertura y cierre](docs/cash-opening-and-closing.md).
- **Historial:** ventas paginadas, filtrables por fecha y comprador; detalle de las instantáneas de productos, descuentos, pago o fiado, cambio y comprador. Muestra qué usuario registró la venta; registros anteriores a esta atribución pueden figurar sin usuario identificado. Editar productos o clientes después no altera el historial.

## Historial y comprobantes locales

En **Historial**, filtra por fechas inclusivas del calendario colombiano (UTC−5) y por comprador, elige 20, 50 o 100 ventas por página y abre una venta para consultar sus datos guardados.

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
- Los importes se guardan como enteros COP y se calculan con aritmética exacta; cantidades como milésimas enteras. Bruto y descuento se redondean half-up al peso por línea; no se calculan impuestos ni se supone una tarifa tributaria.
- Cada venta conserva nombre, unidad, precio, cantidad y descuento aplicado en sus líneas. La venta pagada puede omitir cliente; la fiada exige uno activo. La instantánea del comprador no cambia si luego se edita o desactiva el perfil.
- Venta, instantáneas, pago **o** cargo de fiado, turno, salidas de inventario y stock se guardan en una transacción SQLite; el estado es `local_pending_invoice`, nunca una factura DIAN. Los abonos también son transaccionales y no modifican la venta original.
- Solo se registra un método por venta pagada o por abono. No se procesan tarjetas ni se verifican transferencias; las referencias/códigos opcionales no prueban el pago.
- El acceso a SQLite ocurre solo en el proceso principal de Electron. El renderer recibe operaciones limitadas mediante `preload`.
- Las contraseñas se almacenan como hashes `scrypt` con sal individual; la sesión no persiste al reiniciar la aplicación. AdminMaster no tiene cuenta o secreto integrado y no se puede asignar desde la interfaz.
- No se guardan certificados digitales, credenciales ni tokens. No se guardan números de tarjeta, CVV, PIN o claves bancarias. Los datos de clientes viven solo en la SQLite local de la caja, que no está cifrada; protege el perfil del sistema operativo y planifica respaldos.
- La documentación de DIAN describe decisiones pendientes y no habilita llamadas externas.

Faltan sincronización/PostgreSQL, emisión DIAN, datos fiscales confirmados, proveedores, procesamiento bancario, respaldos integrados, movimientos manuales de caja, instalador firmado y validación con impresora física. Lee [arquitectura](docs/architecture.md), [venta offline](docs/offline-sale-flow.md), [diseño DIAN](docs/dian/electronic-invoicing-design.md), [datos pendientes del comercio](docs/dian/merchant-onboarding-checklist.md), [guía de continuidad](docs/AI_HANDOFF.md) y [`AGENTS.md`](AGENTS.md) antes de ampliar el proyecto.
