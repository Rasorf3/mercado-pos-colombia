# Instrucciones del proyecto

## Objetivo

Crear una aplicación de punto de venta e inventario para mercados en Colombia. Debe funcionar sin internet para registrar operaciones locales, sincronizar cuando vuelva la conexión, imprimir comprobantes y soportar facturación electrónica conforme a los requisitos vigentes de la DIAN.

## Tecnologías acordadas

- Node.js 24 LTS y npm.
- Monorepo con npm workspaces.
- Caja de escritorio: Electron Forge, Webpack, TypeScript y React.
- Base de datos local de la caja: SQLite.
- API: Fastify y TypeScript.
- Base de datos central, cuando se implemente el servidor: PostgreSQL.
- Contratos y validaciones compartidos: TypeBox.

No cambies estas tecnologías ni agregues dependencias importantes sin explicar el motivo en el resumen del trabajo.

## Límites entre componentes

- `apps/pos/src/renderer`: interfaz React. No accede directamente a Node.js, Electron ni SQLite.
- `apps/pos/src/preload`: expone a la interfaz solo las funciones necesarias mediante una API limitada.
- `apps/pos/src/main`: operaciones de Electron, impresión, comunicación segura con la interfaz y acceso a SQLite.
- `apps/api`: autenticación, sincronización, licencias y comunicación con la DIAN.
- `packages/domain`: reglas de negocio, sin depender de la interfaz ni de la base de datos.
- `packages/contracts`: tipos y esquemas compartidos entre la caja y la API.
- Mantén cada módulo enfocado y evita archivos excesivamente grandes.

## Reglas de datos y ventas

- No uses `number` de JavaScript para calcular o guardar dinero. Usa aritmética decimal o una representación exacta y define el redondeo.
- No supongas la tarifa de IVA o impuesto de un producto. Su tratamiento tributario debe estar definido explícitamente.
- Al registrar una venta, conserva una copia de la descripción, precio e impuestos aplicados en ese momento.
- Registra los cambios de inventario como movimientos trazables.
- Guarda la venta y sus movimientos relacionados en una transacción local.
- Cada operación pendiente de sincronización debe tener un identificador único y poder reintentarse sin duplicarse.
- No edites ni elimines una factura validada para corregirla. Implementa el proceso fiscal correspondiente, como la nota crédito, cuando esté definido.

## Trabajo sin conexión y DIAN

- Distingue los estados de una operación: local, pendiente de sincronización, en contingencia, enviada, validada o rechazada.
- Nunca presentes un registro interno pendiente como si fuera una factura validada por la DIAN.
- Antes de implementar requisitos tributarios, consulta la documentación oficial vigente de la DIAN y registra en `docs/dian/` la fuente, versión y fecha de consulta.
- En desarrollo utiliza el ambiente de pruebas de la DIAN.
- No hagas llamadas al ambiente de producción ni uses certificados reales, salvo que la tarea lo solicite explícitamente.
- No guardes certificados, claves privadas, contraseñas ni tokens en el repositorio, el código o los registros de depuración.

## Seguridad

- Mantén `contextIsolation` habilitado y `nodeIntegration` deshabilitado en Electron.
- No expongas módulos completos de Electron o Node a la interfaz.
- La API debe validar entradas y verificar permisos en cada operación.
- Al implementar varios comercios, aísla sus datos en cada consulta del servidor.
- Usa `.env.example` para documentar nombres de variables. Nunca subas archivos `.env` ni secretos.

## Verificación

Mantén documentados en el `README.md` los comandos de instalación, desarrollo, pruebas y compilación. Configura desde la raíz estos scripts cuando corresponda:

- `npm run dev:pos`
- `npm run dev:api`
- `npm test`
- `npm run lint`
- `npm run build`

Al terminar una tarea, ejecuta las pruebas o verificaciones relacionadas. En tu resumen indica qué archivos cambiaste, qué comandos ejecutaste y qué quedó pendiente.
