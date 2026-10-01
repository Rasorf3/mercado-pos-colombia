# Varias cajas: sincronización optativa y conciliación

Estado: primera implementación, 2026-10-01. Funciona con una SQLite independiente por instalación y una API Fastify conectada a PostgreSQL. **No es facturación electrónica.** No se activó ningún servidor del comercio ni se modificó su base real durante las pruebas.

## Reglas acordadas

| Operación | Instalación sin vincular | Caja vinculada, servidor caído |
|---|---|---|
| Ventas pagadas | Local, offline | Local, con cola durable |
| Catálogo, entradas, ajustes, clientes | Local | Local, con revisión de conflictos al reconectar |
| Apertura/cierre de caja | Un turno por instalación | Un turno propio; no mezcla dinero de otra caja |
| Fiados y abonos | Cupo/saldo local | No se admiten nuevas operaciones compartidas sin autorización central |
| Modificar cupo por operación específica | Local | Requiere recuperar conexión; el servidor valida saldo y reservas |
| Historial/comprobante | Instantáneas locales | Instantáneas locales; incluye otras cajas después de sincronizarlas |

Las ventas pagadas se admiten solo con existencia **local** suficiente. Es imposible garantizar existencias globales mientras varias cajas venden desconectadas. Al reconectar se conservan todas las ventas y pagos válidos y se suman los movimientos; un saldo consolidado negativo genera un faltante, no una venta borrada. Esta excepción no se aplica al cupo de fiado.

## Arquitectura y persistencia

```text
React → preload explícito → main → SQLite + outbox
                                      │ reintento autenticado
                                      ▼
                              Fastify → PostgreSQL
                                      │ eventos por comercio
                                      ▼
                       otras cajas → inbox + SQLite
```

- La migración SQLite v10 asigna un UUID de instalación, añade cola, versiones de filas, deduplicación, incidencias y autorizaciones pendientes de cartera. El stock del producto **no** se replica como un valor a sobrescribir: se reconstruye desde las cantidades firmadas de los movimientos inmutables.
- Operación de negocio y evento `outbox` se confirman juntos en la misma transacción inmediata. Un fallo revierte ambos. Importaciones no se vuelven a encolar.
- El servidor guarda eventos/entidades JSONB con importes y cantidades como cadenas enteras exactas. Todos los accesos se limitan por comercio. La escritura central usa una transacción y bloqueo del comercio; nunca convierte dinero a `number`.
- UUID de operación + huella del contenido + UUID del dispositivo permiten reintentar una respuesta perdida: la operación se confirma una sola vez. Reutilizar el mismo ID con otro contenido se rechaza.
- La respuesta canónica se aplica antes de descargar otras filas. El `inbox` y la aplicación local se confirman juntos; el cursor avanza transaccionalmente. La cola sobrevive al cierre y reinicio.
- Se intenta sincronizar cada 15 segundos, con espera progresiva hasta 60 segundos al fallar, timeout por solicitud y botón manual para Admin. «Conectada» indica el último intercambio exitoso, no una garantía permanente: cada nuevo fiado/abono vuelve a consultar al servidor.
- La migración conserva turnos anteriores como propios de esa instalación. Cada turno tiene `origin_device_id`; ventas/abonos nuevos solo pueden usar el turno abierto del equipo que los registra. La pantalla Caja muestra únicamente sus turnos. El historial de ventas puede incluir otras cajas tras descargar sus operaciones.

## Faltantes y conflictos

El saldo firmado conserva la evidencia del faltante. La disponibilidad para nuevas ventas se presenta como `max(0, saldo)`, sin ocultar la incidencia. Los `stock_before/after` de movimientos de otra caja son observaciones de su origen, no saldos globales; la existencia consolidada se obtiene de la suma de deltas.

Admin entra en **Sincronización** y:

1. Verifica que todas las cajas enviaron sus pendientes; pausa ventas/entradas del producto durante el conteo. La casilla exige confirmación humana, no detecta automáticamente un equipo todavía desconectado.
2. Cuenta físicamente. El ajuste es `conteo − saldo firmado`; se registra un movimiento ordinario con actor, motivo, conteo y saldo previo en la nota, junto con su evento. Si el envío falla después, se informa que el ajuste está guardado y pendiente: no se repite el conteo para reenviarlo.
3. Sincroniza las otras cajas. Si posteriormente llega otra operación, se recalcula el saldo y podría requerirse una revisión nueva.

Las modificaciones concurrentes de un perfil/producto **no** usan «último cambio gana». Si la versión de base quedó antigua, se conserva la versión central y se guarda la propuesta como incidencia. Admin ve los datos propuestos, abre catálogo/clientes para decidir y guarda una nota de revisión. Marcar como revisada no reaplica la propuesta ni modifica una venta.

Si dos cajas crean códigos de barras o identificaciones iguales, se conservan ambos IDs, sus movimientos y sus compradores históricos. El registro que llega después queda sin el código/identificación duplicado y genera una incidencia. No se fusionan automáticamente productos, saldos ni clientes. Se debe corregir/desactivar el perfil correspondiente con criterio del comercio. Los eventos de cupo conservan el intento local; si el servidor no pudo aplicarlo, la incidencia y el perfil central son la evidencia del cupo vigente, no el valor solicitado.

## Cartera estricta

Antes de un fiado/abono, main sincroniza y solicita una reserva central por cliente y delta COP. PostgreSQL serializa el cálculo de saldo/cupo e incluye reservas del mismo signo todavía pendientes: una promesa de abono aún no confirmada no libera cupo; un cargo pendiente no permite pagar deuda todavía inexistente.

La reserva se vincula al evento en la transacción SQLite. Si cae la red después de autorizar pero antes de enviar, esa operación ya autorizada se conserva y su reserva sigue retenida. El servidor consume la reserva solo junto con el evento correcto. Sin autorización no hay venta fiada, abono ni cambios parciales de stock/cartera.

Intentos abandonados antes del commit se cancelan al recuperar conexión. No expiran automáticamente: expirar una autorización de una venta local ya confirmada sería inseguro. Una caja perdida con reservas pendientes requiere recuperación administrada; no existe todavía una pantalla central para ese caso. Una pérdida definitiva de su SQLite/cola no se resuelve clonando otro equipo.

## Preparación del servidor y vinculación

PostgreSQL se instala **solo en el servidor**, no en cada caja. Puede ser un computador dedicado de la red local; si se apaga, las ventas pagadas siguen en cada equipo. No compartas `catalog.sqlite` por una carpeta de red ni copies un perfil Electron para crear otra caja.

1. Prepara una base PostgreSQL dedicada y un usuario de base con permisos mínimos suficientes para sus migraciones. Define respaldos, almacenamiento, cuenta del servicio, firewall y un servidor estable; estos aspectos de despliegue no se instalan automáticamente.
2. En `.env` raíz, ignorado por Git, completa `DATABASE_URL` y una `SYNC_PAIRING_KEY` aleatoria de 32–256 caracteres. No guardes sus valores en documentación, capturas, logs ni Git. `HOST`/`PORT` se documentan en `.env.example`. La API carga ese archivo sin reemplazar variables ya existentes del entorno.
3. Ejecuta `npm install`, `npm run build:packages` y `npm run dev:api` para desarrollo. Para ejecutar lo compilado: `npm run build` y `npm run start --workspace @mercado-pos/api`. Al configurar PostgreSQL, se aplica la migración central v1 y se habilitan `/sync/*`. Sin `DATABASE_URL`, únicamente existe `/health`.
4. Para otros computadores, publica la API detrás de **HTTPS** con certificado de servidor confiable. La implementación no configura TLS directamente. HTTP solo se acepta en loopback (`localhost`, `127.0.0.1`, `::1`) para pruebas en el mismo computador. Esto no requiere un certificado DIAN ni firma del ejecutable.
5. Define un UUID de comercio compartido por esas cajas; no es el NIT. Inicia sesión como Admin y abre **Sincronización**. Vincula primero la instalación que conserva los datos, con URL, UUID, nombre de caja y clave de vinculación. Espera a que su cola quede vacía. Las cajas adicionales deben partir sin productos/clientes/ventas locales: combinar dos bases históricas independientes necesita un proceso de migración que no está incluido.
6. En cada caja adicional crea sus propias cuentas locales y vincula con el mismo UUID y servidor, pero identidad de instalación distinta. Verifica descarga de catálogo y clientes antes de abrir su turno. Prueba cortes de red con datos ficticios antes del uso diario.

La clave de vinculación es una credencial administrativa del servidor para incorporar o recuperar dispositivos y crear el espacio del comercio. No se distribuye a empleados. El token aleatorio del dispositivo se guarda cifrado mediante Electron `safeStorage`, en `userData/sync/device-credential.bin`, fuera de SQLite/Git; el servidor almacena solo su hash SHA-256. Se rechaza custodia sin cifrado o backend Linux `basic_text`. **Recuperar credencial** mantiene el mismo servidor/comercio/UUID y rota el token; no borra la cola ni cambia el comercio.

## Respaldo, recuperación y frontera de seguridad

- Antes de migrar una base v9 real se conserva un snapshot consistente `catalog.sqlite.pre-sync-v9-<UUID>.sqlite` mediante `VACUUM INTO` y `quick_check`. Antes de la primera vinculación se conserva también `catalog.sqlite.pre-enrollment-<UUID>.sqlite` actualizado. Ambos quedan junto al archivo local, fuera del repositorio. Si falla el respaldo se aborta la operación. Las bases en memoria de prueba no necesitan archivo de respaldo.
- Estos snapshots **no** son respaldo periódico ni backup del servidor y no cubren operaciones posteriores. Protege también contactos e historial contenidos en los respaldos. Aún falta restauración asistida y copia externa programada.
- Para recuperar: cierra todos los procesos POS, preserva primero la SQLite/WAL actual y la credencial, y trabaja con copias. No sobrescribas el único original. Restaurar el snapshot v9 requiere una versión de la aplicación compatible; el snapshot previo a vincular no incluye ventas posteriores. No reconectes un snapshot antiguo como caja nueva: puede duplicar inventario o perder pendientes. La recuperación después de sincronizar debe conciliar con el servidor y preservar la identidad; no hay botón automático de rollback.
- Las cuentas y contraseñas **siguen locales**. Solo se transfieren UUID/nombre públicos de actores para historial; las filas de actores remotos están desactivadas y excluidas del login, bootstrap, lista/administración de cuentas y empleados. No se transfieren contraseñas, hashes de acceso, AdminMaster ni el perfil de Mi empresa.
- La API autentica **dispositivos**, no una sesión central individual de empleado. Acepta la atribución/rol comunicado por un POS autorizado, valida capacidades y operación, y confía en el main y el sistema operativo de esa caja. Un token robado o una caja alterada puede falsificar actores; usuarios centrales, permisos firmados por el servidor, revocación remota inmediata y detección de clonación siguen pendientes. No exponer esta primera versión directamente a internet público.
- Los empleados ven estado/pending; configurar, sincronizar manualmente y revisar/conciliar incidencias exige `sync:manage` (Admin; AdminMaster reservado). Los datos centrales están aislados por UUID de comercio. `/health` sigue público y no autoriza otras rutas.

## Verificación y límites

Las pruebas usan SQLite en memoria y archivos temporales, más **PGlite**, un motor PostgreSQL embebido de pruebas. Ejercitan SQL, migraciones, API Fastify y servicios de dos instalaciones con fallos de transporte simulados. No instalan un servicio PostgreSQL ni reproducen dos computadores físicos.

Se cubren ventas pagadas desconectadas y faltantes, respuesta perdida tras commit, reintento idempotente, turnos independientes, instantáneas históricas, conflicto de código y edición, persistencia al reiniciar, cancelación de reservas abandonadas, cupo/saldo compartido, aislamiento de comercios, rechazo de roles/campos sensibles y rollback central/local. Repetir `npm test`, `npm run typecheck`, `npm run build` y `git diff --check` al cambiar el protocolo.

Antes de despliegue quedan pruebas con **PostgreSQL como servicio real**, HTTPS en LAN, varias máquinas, volumen/duración, recuperación de disco/servidor y administración/revocación de dispositivos. La carga inicial y el historial replican todos los registros: aún no hay retención/compactación ni sincronización incremental por campos. Impresora física, instalador firmado y DIAN siguen fuera de esta ronda.

Referencias técnicas: [consultas parametrizadas de node-postgres](https://node-postgres.com/features/queries), [transacciones sobre un solo cliente](https://node-postgres.com/features/transactions), [PGlite](https://pglite.dev/docs/about) y [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). Consulta: 2026-10-01.

### Dependencias y audit de esta ronda

Se añadieron `pg@8.23.1` (cliente PostgreSQL de ejecución), `@types/pg@8.23.1` (tipos de desarrollo) y `@electric-sql/pglite@0.5.8` (solo pruebas), con versiones exactas en API/lock. La API también reutiliza el workspace domain. No se cambió Electron ni Forge ni se añadieron overrides.

`npm audit --json`, 2026-10-01: **28 paquetes afectados**: 1 crítico, 22 altos, 2 moderados y 3 bajos. Incluye propagación de avisos por la cadena de dependencias, no 28 fallas independientes. `npm audit --omit=dev --json`: **0**. El informe completo no marca Electron `44.4.5`, `pg` ni PGlite; esto no certifica ausencia de vulnerabilidades y Electron se instala como devDependency aunque su binario se distribuya en la app.

| Gravedad | Paquetes del árbol de desarrollo/compilación |
|---|---|
| Crítica | `tar@6.2.1`, usado por reconstrucción/descarga de herramientas nativas |
| Alta (22) | Forge `7.11.2`: cli, core, core-utils, maker-base, plugin-base, plugin-webpack, publisher-base, shared-types, template-base, template-vite, template-vite-typescript, template-webpack, template-webpack-typescript; `@electron/node-gyp@10.2.0-electron.1`, `@electron/packager@18.4.4`, `@electron/rebuild@3.7.2`, `cacache@16.1.3`, `extract-zip@2.0.1`, `make-fetch-happen@10.2.1`, `tmp@0.0.33`, `webpack-dev-middleware@5.3.4`, `webpack-dev-server@4.15.2` |
| Moderada (2) | `sockjs@0.3.24`, `uuid@8.3.2` |
| Baja (3) | `@inquirer/editor@3.0.1`, `@inquirer/prompts@6.0.1`, `external-editor@3.1.0` |

npm propone Forge CLI/plugin Webpack `8.0.1`, una actualización mayor que requiere una ronda propia de compatibilidad y empaquetado. No se aplicó `audit fix`, `--force`, alpha ni actualización de seguridad ajena a esta tarea. Mantener estos hallazgos como pendiente de mantenimiento; no exponer servidores Webpack de desarrollo a la red del comercio. Para volver a ver rutas: `npm explain tar`, `npm explain extract-zip`, `npm explain tmp`, `npm explain webpack-dev-middleware` y `npm audit --json`.
