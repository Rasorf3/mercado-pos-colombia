# Mantenimiento: actualización a Electron 44

Fecha de revisión: 2026-09-28

## Estado y alcance

- Antes de esta ronda, `git status` mostraba únicamente los cambios locales ya existentes en `apps/pos/tsconfig.json`, `apps/pos/webpack.main.config.ts` y `apps/pos/webpack.renderer.config.ts`. Se conservaron.
- El lockfile era `lockfileVersion: 3`; la resolución instalada era Electron 37.10.3 y Electron Forge/plugin-webpack 7.11.2.
- No se implementó inventario, venta, facturación, sincronización ni funcionalidad de DIAN.
- Se actualizó `apps/pos/package.json` a Electron `^44.4.5`, se regeneró `package-lock.json` y se quitó de `allowScripts` la excepción de `electron@37.10.3`. Electron 42+ ya no descarga el binario mediante `postinstall`: lo descarga perezosamente al ejecutar Electron por primera vez. La primera ejecución de `dev:pos` descargó el binario 44.4.5 correctamente.
- No se añadieron `overrides`, `resolutions`, versiones alpha ni credenciales.

## Motivo, soporte y compatibilidad

Electron 37 llegó al fin de soporte el 2026-01-15. Al consultar el calendario oficial, Electron 44.4.5 era la versión estable más reciente, compatible con el Node incluido 24.21.0 y con soporte programado hasta el 2027-03-02. Electron 45 todavía no era estable en la fecha de revisión. Fuentes: [versión 44.4.5](https://releases.electronjs.org/release/v44.4.5), [calendario y política de soporte](https://releases.electronjs.org/schedule) y [política de releases](https://www.electronjs.org/docs/latest/tutorial/electron-timelines).

El audit previo recomendaba `electron@44.4.5`; al fijarlo en la línea 44 se eliminó el hallazgo alto de Electron. Electron Forge y `@electron-forge/plugin-webpack` permanecen en 7.11.2, la versión estable más reciente consultada. Sus manifiestos declaran Node `>=16.4.0`, no restringen Electron con `peerDependencies`, y el plugin sigue usando Webpack 5. La configuración actual sigue el patrón documentado por [Forge Webpack Plugin](https://www.electronforge.io/config/plugins/webpack). La compatibilidad se comprobó además en este repositorio: Forge empaquetó la aplicación y `dev:pos` arrancó una ventana con Electron 44.4.5.

Cambios acumulados relevantes entre 37 y 44, contrastados con los [breaking changes oficiales](https://www.electronjs.org/docs/latest/breaking-changes) y las notas de [38](https://www.electronjs.org/blog/electron-38-0), [39](https://www.electronjs.org/blog/electron-39-0), [40](https://www.electronjs.org/blog/electron-40-0), [41](https://www.electronjs.org/blog/electron-41-0), [42](https://releases.electronjs.org/release/v42.0.0), [43](https://www.electronjs.org/blog/electron-43-0) y [44](https://www.electronjs.org/blog/electron-44-0):

- El runtime pasa a Node 24, Chromium 152 y V8 15.2 en Electron 44.4.5.
- Electron 38 dejó de soportar macOS 11 y cambió el comportamiento Wayland en Linux; Electron 44 requiere macOS 13 o posterior y ya no publica binarios de 32 bits.
- Electron 39 cambió el tamaño/redimensionamiento de ventanas abiertas con `window.open`; Electron 43 cambió el destino predeterminado de descargas y las esquinas de ventanas sin marco en Linux.
- Electron 40 deprecó el acceso a `clipboard` desde renderer; Electron 44 lo retiró. La aplicación no usa Clipboard.
- Electron 41 cambió el ciclo de vida de PDFs como `WebContents` y los valores de causa de cookies; no se usan esas APIs aquí.
- Electron 42 retiró la descarga del binario en `postinstall`, cambió el factor de escala predeterminado en offscreen rendering y exige firma para notificaciones macOS. El POS no usa offscreen rendering ni notificaciones; la descarga perezosa se verificó al iniciar.
- Electron 44 puede entregar `webContents: null` en `select-client-certificate`, cambió validaciones de `net.request`, y modificó Clipboard/ANGLE; el esqueleto no usa esas APIs.

El código Electron actual solo usa `app`, `BrowserWindow` y `contextBridge`; mantiene `contextIsolation: true` y `nodeIntegration: false`. El build y el arranque real validan el flujo que sí existe. Antes de añadir APIs de impresión, notificaciones, permisos, red o extensiones, revisar sus cambios de versión específicos.

## Auditoría final de npm

Resultado de `npm audit --json` después de actualizar Electron: **27 paquetes afectados: 1 crítico, 20 altos, 3 moderados y 3 bajos**. No hay hallazgos altos/críticos en el binario Electron que se ejecuta con el POS. Los 27 paquetes enumerados abajo pertenecen a herramientas de desarrollo, descarga/compilación, empaquetado o servidor HMR; no son dependencias incluidas en la interfaz desplegada. Electron se declara como `devDependency` por el proceso de empaquetado, pero su binario sí forma parte de la aplicación distribuida y ya quedó actualizado a 44.4.5.

Los rangos «afectados» son los informados por npm audit. Las versiones corregidas indican la primera línea/versiones seguras consultadas cuando existe una publicada; no implican que se hayan instalado. npm audit representa también a los paquetes padres afectados por dependencias vulnerables.

### Crítica

| Paquete instalado | Aviso / ruta | Corrección disponible y motivo para dejarlo pendiente |
| --- | --- | --- |
| `tar@6.2.1` | 12 avisos de traversal/escritura arbitraria con hardlinks y symlinks, parseo diferencial de archivos y DoS. Ruta principal: Forge CLI → Forge Core → `@electron/rebuild@3.7.2` → `@electron/node-gyp@10.2.0-electron.1` → `make-fetch-happen@10.2.1` → `cacache@16.1.3` → tar. | Corregido desde `7.5.21` (latest consultado `7.5.22`). Los consumidores actuales declaran tar 6; forzar tar 7 sería un cambio mayor sin compatibilidad probada. |

### Altas

| Paquete instalado | Aviso / ruta | Corrección disponible y motivo para dejarlo pendiente |
| --- | --- | --- |
| `@electron-forge/cli@7.11.2` | Vulnerabilidad heredada de Forge Core/Core Utils/Shared Types y `@inquirer/prompts`; el audit incluye rango Forge `7.0.0 – 8.0.0-alpha.8`. | No hay Forge 7 corregido consultado. `npm audit` propone degradar a 6.4.2; no se aplicó. Forge 8 solo estaba disponible como alpha y se descartó. |
| `@electron-forge/core@7.11.2` | Vulnerabilidades heredadas de `@electron/packager` y `@electron/rebuild`. | El arreglo sugerido por npm es degradar el árbol de Forge; la alternativa requiere actualizar dependencias mayores. |
| `@electron-forge/core-utils@7.11.2` | Heredada de `@electron/rebuild`/`@electron/node-gyp` y sus dependencias. | Sin parche compatible de Forge 7 identificado. |
| `@electron-forge/maker-base@7.11.2` | Heredada de `@electron-forge/shared-types` → packager/rebuild. | Sin parche compatible de Forge 7 identificado. |
| `@electron-forge/plugin-base@7.11.2` | Heredada de Shared Types/rebuild. | Sin parche compatible de Forge 7 identificado. |
| `@electron-forge/plugin-webpack@7.11.2` | Heredada de Forge Core Utils, `webpack-dev-server` y sus dependencias. | npm propone `0.0.2`, una degradación incompatible. No se aplicó. |
| `@electron-forge/publisher-base@7.11.2` | Heredada de Shared Types/packager/rebuild. | Sin parche compatible de Forge 7 identificado. |
| `@electron-forge/shared-types@7.11.2` | Heredada de packager, rebuild y extract-zip. | Requiere una nueva versión compatible de Forge. |
| `@electron-forge/template-base@7.11.2` | Heredada de Forge Core Utils/Shared Types. | Sin parche compatible de Forge 7 identificado. |
| `@electron-forge/template-vite@7.11.2` | Heredada de Forge Core Utils/Shared Types. | Sin parche compatible de Forge 7 identificado. |
| `@electron-forge/template-vite-typescript@7.11.2` | Heredada de Forge Core Utils/Shared Types. | Sin parche compatible de Forge 7 identificado. |
| `@electron-forge/template-webpack@7.11.2` | Heredada de Forge Core Utils/Shared Types. | Sin parche compatible de Forge 7 identificado. |
| `@electron-forge/template-webpack-typescript@7.11.2` | Heredada de Forge Core Utils/Shared Types. | Sin parche compatible de Forge 7 identificado. |
| `@electron/node-gyp@10.2.0-electron.1` | Hereda los avisos de `make-fetch-happen@10.2.1` y `tar@6.2.1`; solo lo usa rebuild en compilación/reconstrucción. | La versión siguiente consultada (`10.2.0-electron.2`) conserva los rangos vulnerables de make-fetch-happen 10 y tar 6; no resuelve el hallazgo. |
| `@electron/packager@18.4.4` | Hereda traversal/escritura de `extract-zip@2.0.1`; ruta Forge Core/Shared Types → Packager → extract-zip. | Packager `20.0.1+` (latest `20.3.0`), pero Forge 7 declara `^18.3.5`; cambiarlo por override no se verificó. |
| `@electron/rebuild@3.7.2` | Hereda node-gyp/tar; Forge Core, Core Utils y Shared Types lo usan durante build. Rango auditado `3.2.10 – 4.0.2`. | `4.0.3+` (latest `4.2.0`), línea mayor que la requerida `^3.7.0` por Forge 7. |
| `cacache@16.1.3` | Hereda los avisos críticos de tar; ruta make-fetch-happen → cacache → tar. | `19.0.0+` (latest `21.0.1`), cambio mayor. |
| `extract-zip@2.0.1` | Dos avisos: symlink path traversal y escritura arbitraria a través de symlinks en archivos extraídos. Ruta restante: Packager 18.4.4 → extract-zip. | El registry sigue ofreciendo `2.0.1` como latest, sin versión corregida. Electron 44 pasó a `@electron-internal/extract-zip`, pero Forge Packager todavía trae el paquete vulnerable aparte. |
| `make-fetch-happen@10.2.1` | Vulnerabilidad heredada de cacache/tar; ruta node-gyp → make-fetch-happen → cacache → tar. | `14.0.1+` (latest `16.0.1`), fuera de la rama 10 requerida. |
| `tmp@0.0.33` | Dos avisos de creación/escritura insegura de temporales: symlink y traversal de prefijo/sufijo. Ruta Forge CLI → prompts/editor → `external-editor@3.1.0` → tmp. | Corregido desde `0.2.6` (latest `0.2.7`), pero external-editor declara `^0.0.33`. |

### Moderadas y bajas

| Paquete instalado | Severidad y aviso/ruta | Corrección disponible |
| --- | --- | --- |
| `webpack-dev-server@4.15.2` | Moderada; seis avisos sobre exposición de código fuente, CSRF, intercepción de WebSocket HMR y DoS. Ruta plugin-webpack → webpack-dev-server. | Audit afecta `<=5.2.6`; el latest consultado es `5.2.6`, aún afectado. Forge plugin declara `^4.0.0`; no se cambió a la línea 5. |
| `sockjs@0.3.24` | Moderada, heredada de uuid; ruta webpack-dev-server → sockjs → uuid. | Latest consultado sigue en `0.3.24`; no hay actualización publicada que elimine el aviso. |
| `uuid@8.3.2` | Moderada; falta comprobación de límites de buffer en variantes v3/v5/v6, heredada de sockjs. | `11.1.1+` (latest `14.0.2`), incompatible con el rango `^8.3.2` de sockjs. |
| `@inquirer/editor@3.0.1` | Baja, heredada de `external-editor`/tmp; ruta Forge CLI → prompts → editor → external-editor → tmp. | El rango auditado llega hasta `4.2.15`; latest consultado `5.3.3`, pero exige actualizar la cadena Inquirer mayor. |
| `@inquirer/prompts@6.0.1` | Baja, heredada de editor/tmp; ruta Forge CLI → prompts → editor → external-editor → tmp. | El audit afecta `<=6.0.1`; la línea publicada 6 consultada no tiene parche, latest `8.7.2` requiere otra generación mayor de Forge/Inquirer. |
| `external-editor@3.1.0` | Baja, heredada de `tmp@0.0.33`; es el consumidor directo del rango vulnerable `^0.0.33`. | Latest consultado continúa en `3.1.0`; se necesita una versión que cambie el rango de tmp o una actualización coordinada de Inquirer/Forge. |

El total npm cuenta paquetes/rutas afectadas, no CVE únicos. Por eso los avisos heredados aparecen en varios padres de Forge. `npm audit fix` no se usó para forzar estos cambios: las soluciones automáticas restantes proponían degradaciones incompatibles. No se introdujeron overrides para simular un cierre que las dependencias de Forge no han validado.

## Verificación ejecutada

- `npm install --workspace @mercado-pos/pos`: correcto; añadió 3 paquetes, quitó 6 y cambió 2.
- `npm test`: correcto; 1 prueba de API aprobada; los demás workspaces no tienen pruebas definidas.
- `npm run build`: correcto; Forge empaquetó para Windows x64.
- `npm run dev:pos`: correcto; descargó Electron 44.4.5 en el primer inicio y abrió una ventana `Mercado POS Colombia`, responsiva.
- `npm run dev:api`: correcto; `GET http://127.0.0.1:3000/health` devolvió `{"status":"ok","service":"api"}`.
- `npm audit --json`: 27 avisos de paquete (1 crítico, 20 altos, 3 moderados, 3 bajos); todos son herramientas de desarrollo/compilación. No quedan vulnerabilidades reportadas para Electron en runtime.

La compilación sigue mostrando el aviso no bloqueante `MODULE_TYPELESS_PACKAGE_JSON` para `webpack.rules.ts`. Se conservó la corrección ESM existente y no se cambió el tipo de módulo del paquete porque eso podría afectar el formato de salida del proceso main.
