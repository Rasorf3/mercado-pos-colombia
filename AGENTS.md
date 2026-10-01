# Instrucciones del proyecto

## Objetivo

Crear una aplicación de punto de venta e inventario para mercados en Colombia. Funciona offline localmente y tiene sincronización optativa entre instalaciones con API/PostgreSQL. Sin `DATABASE_URL`, la API solo expone `/health`; con configuración central habilita `/sync/*`. La facturación electrónica sigue pendiente. Una venta `local_pending_invoice`, un fiado y un comprobante local **no** son facturas emitidas ni aceptadas por la DIAN.

Antes de editar, revisa `git status` y los documentos pertinentes de `docs/`, incluido `docs/AI_HANDOFF.md` cuando continúes trabajo previo. Conserva cambios existentes. No hagas commit ni push salvo petición explícita.

## Tecnologías acordadas

- Node.js 24 LTS y npm 11 o superior.
- Monorepo con npm workspaces.
- Caja de escritorio: Electron Forge, Webpack, TypeScript y React.
- Base de datos local de la caja: SQLite.
- API: Fastify y TypeScript.
- Base de datos central optativa: PostgreSQL (`pg`); PGlite se usa únicamente como motor aislado de pruebas.
- Contratos y validaciones compartidos: TypeBox.

No cambies estas tecnologías ni agregues dependencias importantes sin explicar el motivo en el resumen del trabajo.

## Límites entre componentes

- `apps/pos/src/renderer`: interfaz React. No accede directamente a Node.js, Electron ni SQLite.
- `apps/pos/src/preload.ts` y los bridges: exponen a la interfaz solo funciones necesarias mediante una API limitada.
- `apps/pos/src/main`: operaciones de Electron, impresión, comunicación segura con la interfaz y acceso a SQLite.
- `apps/api`: `/health` y sincronización optativa `/sync/*`, autenticación de dispositivos y aislamiento por comercio en PostgreSQL. No autentica sesiones centrales de empleados; confía en los actores/roles declarados por el POS vinculado. Licencias y DIAN siguen pendientes.
- `packages/domain`: reglas de negocio, sin depender de la interfaz ni de la base de datos.
- `packages/contracts`: tipos y esquemas compartidos entre la caja y la API.
- Mantén cada módulo enfocado y evita archivos excesivamente grandes.

## Reglas de datos y ventas

- No uses `number` de JavaScript para calcular o guardar dinero: COP enteros y aritmética exacta (`bigint` o equivalente). Las cantidades admiten hasta tres decimales y se representan en milésimas enteras. El bruto y el descuento se redondean por línea al peso, mitad hacia arriba; el neto es bruto menos descuento.
- No supongas IVA ni tratamiento tributario. Hoy no se calculan impuestos fiscales. Si se implementan, exige configuración confirmada y conserva los impuestos efectivamente aplicados en la instantánea de cada línea.
- Al registrar una venta, conserva descripción, unidad, cantidad, precio, descuento y total efectivos de cada línea, además de la instantánea opcional del comprador. Editar después un producto o cliente no debe cambiar historial ni comprobante.
- Código de barras único cuando exista; desactiva productos/clientes en vez de borrar sus referencias. Los cambios de stock requieren movimiento trazable, actor cuando exista y la misma transacción SQLite. No permitas stock negativo. El peso opcional en g/kg/lb es equivalencia por unidad/empaque; el stock sigue en unidades y no se deben suponer conversiones de empaques.
- Las promociones del catálogo pueden ser porcentuales o COP fijo **por unidad**, con vigencia. Se aplican automáticamente si están vigentes y pueden modificarse para la venta concreta; congela el descuento efectivo en la línea.
- La venta pagada declara un solo método (`cash`, `debit_card`, `credit_card`, `bank_transfer`, `nequi`, `daviplata`, `bre_b`). El efectivo recibido debe ser digitado por el usuario y permitir calcular cambio. Referencias/autorizaciones opcionales no prueban la recepción del pago; no hay procesamiento bancario.
- Una venta fiada se activa expresamente, requiere cliente activo y total positivo, deja todo el total pendiente y no crea pago inicial. Cupo inicial de cliente: $300.000 COP; puede ajustarse sin quedar debajo del saldo. Saldo = cargos de fiado menos abonos de un libro inmutable; prohíbe exceder cupo o abonar más del saldo.
- Una venta nueva exige turno abierto. Guarda venta, turno, instantáneas, pago **o** cargo de fiado, movimientos y stock en una transacción local; un fallo revierte todo. Los abonos y su vinculación a caja también son transaccionales. Solo un turno abierto por instalación. El cierre conserva instantánea inmutable; efectivo esperado = fondo inicial + ventas en efectivo netas de cambio + abonos en efectivo del turno.
- Historial, impresión y PDF obtienen instantáneas e importes guardados desde SQLite. Reimpresión/exportación no crean ni modifican ventas, pagos, cartera, inventario o estado fiscal. Escapa textos de productos y compradores y conserva la leyenda «COMPROBANTE LOCAL — NO ES FACTURA ELECTRÓNICA».
- Cada operación pendiente de sincronización debe tener un identificador único y poder reintentarse sin duplicarse.
- En cajas vinculadas, negocio y outbox se guardan juntos. Stock se consolida sumando movimientos inmutables, no replicando el saldo del producto. No vendas más que la disponibilidad local; una sobreventa global por desconexión conserva ventas/pagos y genera faltante. Mantén disponibilidad no negativa y evidencia del saldo firmado. Admin concilia mediante conteo/movimiento después de sincronizar todas las cajas, sin borrar ventas. Documenta esta excepción acordada en `docs/multi-register-sync.md`.
- Fiados y abonos compartidos exigen conexión y reserva central de saldo/cupo antes del commit local; no hagas excepciones offline ni expiren reservas de operaciones ya confirmadas. Reintentos consumen la autorización una sola vez. Conserva turnos separados por `origin_device_id` y snapshots de cierre.
- Vinculación optativa con respaldo SQLite verificado previo a migración v10 y a primera vinculación. No clones perfiles/UUID de instalación ni mezcles dos bases históricas. Conflictos de perfiles/códigos se conservan para revisión; no se fusionan automáticamente.
- No edites ni elimines una factura validada para corregirla. Implementa el proceso fiscal correspondiente, como la nota crédito, cuando esté definido.

## Trabajo sin conexión y DIAN

- El estado implementado de venta es `local_pending_invoice`. Al integrar facturación/sincronización, distingue local, pendiente, contingencia, enviada, validada y rechazada solo cuando esos estados existan realmente y estén respaldados por evidencias.
- Nunca presentes un registro interno pendiente como si fuera una factura validada por la DIAN.
- Antes de implementar requisitos tributarios, consulta la documentación oficial vigente de la DIAN y registra en `docs/dian/` fuente, versión y fecha. FEV y DEE POS dependen de la operación y de decisiones confirmadas por comercio/contador; no inventes tarifas, responsabilidades, numeración, códigos, CUFE/CUDE ni certificados.
- En desarrollo utiliza el ambiente de pruebas de la DIAN.
- No hagas llamadas al ambiente de producción ni uses certificados reales, salvo que la tarea lo solicite explícitamente.
- No guardes certificados, claves privadas, contraseñas ni tokens en el repositorio, el código o los registros de depuración.

## Seguridad

- Mantén `contextIsolation` habilitado y `nodeIntegration` deshabilitado en Electron.
- No expongas módulos completos de Electron o Node a la interfaz.
- Valida frame, sesión, permiso, identificadores e inputs de cada IPC en el proceso principal; ocultar controles en React no es autorización.
- Roles estables: `admin_master`, `admin`, `employee_manager` (EmpleadoJefe), `employee`. AdminMaster no tiene cuenta ni credencial integrada y no puede asignarse desde UI; Admin puede crear Admin, EmpleadoJefe y Empleado, no AdminMaster. Deniega por defecto capacidades nuevas y consulta `docs/users-and-roles.md`. Los roles que venden también pueden consultar cartera, fiar, registrar abonos y ampliar cupos; Admin y EmpleadoJefe administran caja, catálogo, inventario y clientes.
- El perfil local del comercio requiere `company:manage`: solo Admin y AdminMaster pueden consultarlo o editarlo. Los empleados del apartado se obtienen de las cuentas de usuario existentes, sin duplicar datos laborales. Guardar NIT/DV no verifica ni habilita facturación; no se añaden a comprobantes históricos.
- Contraseñas de 5 a 128 caracteres, hash `scrypt` con sal individual; no registres secretos en renderer o logs. La sesión es temporal y SQLite no está cifrada. No almacenes números de tarjeta, CVV/CVC, PIN o credenciales bancarias.
- Al añadir operaciones a la API, valida entradas y verifica permisos en cada operación; el `/health` actual no autentica usuarios.
- Al implementar varios comercios, aísla sus datos en cada consulta del servidor.
- `sync:manage` es Admin/AdminMaster; `sync:status` permite estado sin incidencias detalladas a todos los roles. Credenciales de dispositivo se cifran con `safeStorage` fuera de SQLite/Git; la clave de vinculación solo se usa al enrolar/recuperar. HTTPS obligatorio fuera de loopback. No repliques cuentas, hashes de contraseñas ni Mi empresa: actores remotos son referencias de auditoría desactivadas, nunca cuentas de acceso.
- Usa `.env.example` para documentar nombres de variables. Nunca subas archivos `.env` ni secretos.

## Verificación

Mantén documentados en el `README.md` los comandos de instalación, desarrollo, pruebas y compilación. Configura desde la raíz estos scripts cuando corresponda:

- `npm run dev:pos`
- `npm run dev:api`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run verify` (build + pruebas)

No existe actualmente `npm run lint` en la raíz; configúralo antes de exigirlo o afirmar que pasó. Para cambios de código ejecuta verificaciones proporcionales, incluidas pruebas, typecheck, build y `git diff --check`; para cambios solo documentales comprueba enlaces/comandos y `git diff --check`. En tu resumen indica archivos cambiados, comandos ejecutados y qué quedó pendiente.

Consulta `docs/architecture.md`, `docs/offline-sale-flow.md`, `docs/cash-opening-and-closing.md`, `docs/client-credit.md`, `docs/users-and-roles.md`, `docs/multi-register-sync.md`, `docs/local-sales-history-and-receipts.md`, `docs/dian/electronic-invoicing-design.md` y `docs/dian/merchant-onboarding-checklist.md` según el área de trabajo. Distingue pruebas SQLite/PGlite de despliegue real multi-equipo/PostgreSQL. La impresión/PDF de 58/80 mm existe, pero falta validación con impresora física; Forge genera una carpeta de aplicación, no un instalador firmado.
