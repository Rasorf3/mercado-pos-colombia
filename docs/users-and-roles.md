# Acceso local y roles

Estado: primera implementación local. La API y la sincronización no usan esta autenticación.

## Inicio de sesión

- La ventana de caja muestra una pantalla de acceso antes de montar las secciones de catálogo, ventas, clientes, historial o usuarios.
- En una base sin cuentas, el asistente permite crear una sola vez la cuenta inicial **Admin**. Se exige una contraseña de 5 a 128 caracteres; el acceso y la creación de usuarios avisan si Bloq Mayús está activo. Se aceptan letras, números y símbolos; conviene elegir una contraseña más larga y única.
- Las contraseñas se procesan en el proceso principal con `scrypt` (sal aleatoria individual); SQLite guarda la sal y el hash, nunca el texto de la contraseña. Los intentos fallidos se limitan temporalmente en memoria.
- Cerrar sesión invalida la sesión del renderer. La sesión vive en memoria y se pierde al cerrar/reiniciar la aplicación, por lo que se vuelve a pedir contraseña.
- No se implementaron recuperación/cambio de contraseña ni bloqueo automático por inactividad.

## Permisos

| Capacidad | AdminMaster | Admin | EmpleadoJefe | Empleado |
|---|---:|---:|---:|---:|
| Catálogo y costos | Todo | Todo | Consultar y administrar | No |
| Consulta acotada de productos para vender | Todo | Sí | Sí; no recibe el costo en esta consulta | Sí; no recibe el costo |
| Existencias y movimientos | Todo | Consultar y administrar | Consultar y administrar | No |
| Registrar ventas | Todo | Sí | Sí | Sí |
| Consultar historial y ventas ajenas | Todo | Sí | Sí | No |
| Consultar directorio de clientes | Todo | Sí | Sí | No |
| Buscar un comprador activo desde el flujo de venta | Todo | Sí | Sí; búsqueda limitada | Sí; búsqueda limitada |
| Crear cliente desde la venta/directorio | Todo | Sí | Sí | Sí |
| Editar/desactivar clientes | Todo | Sí | Sí | No |
| Administrar cuentas | Todo | Sí | No | No |
| Apertura y cierre de caja / proveedores | Todo | Sí | Sí | No |

La interfaz oculta secciones según el rol, pero esa ocultación no es la barrera de seguridad: cada handler IPC del proceso principal exige sesión y vuelve a comprobar el permiso. Se deniega por defecto; al agregar una capacidad futura se debe autorizar explícitamente a los roles ordinarios. AdminMaster queda reservado para las capacidades especiales que se definan después. La operación de venta guarda el UUID del usuario en la venta y en sus movimientos de salida; catálogo, movimientos y clientes guardan quién los creó o actualizó. Las ventas históricas previas a esta migración mantienen esos campos en `NULL`.

La sección Caja está disponible para Admin y EmpleadoJefe. En cada instalación solo puede existir un turno abierto; Empleado puede vender dentro del turno activo, pero no ve fondo, conteos ni diferencias y no puede abrir/cerrar. El proceso principal verifica los permisos en cada solicitud IPC. Ver [`cash-opening-and-closing.md`](cash-opening-and-closing.md) para el cálculo y los límites del cierre local.

Admin puede crear cuentas **Admin**, **EmpleadoJefe** y **Empleado**. El rol **AdminMaster** no aparece entre las opciones y es rechazado también por el contrato y el servicio principal.

Empleado y EmpleadoJefe pueden acceder al flujo de venta y consultar productos mediante un resultado específico de venta que excluye el costo en esa consulta. Para escoger un comprador usan una búsqueda acotada a clientes activos y al perfil mínimo para asociarlo; no obtienen el directorio completo desde ese flujo. Al crear una venta, el proceso principal vuelve a validar los datos y conserva la instantánea habitual del comprador. EmpleadoJefe mantiene además sus permisos independientes de inventario, clientes e historial, pero no puede administrar cuentas.

“Quitar” productos y clientes significa desactivarlos, no borrarlos: ventas y movimientos históricos deben seguir referenciándolos.

## Roles reservados y decisiones pendientes

- `admin_master` existe como identificador reservado y obtiene todas las capacidades actuales y las que se agreguen al mapa de permisos. No hay credencial, contraseña fija, cuenta inicial, pantalla ni operación de IPC para asignarlo. El Admin del comercio no lo puede crear ni cambiar roles a ese valor. El mecanismo para acreditar al desarrollador debe diseñarse antes de habilitar ese acceso; editar SQLite manualmente no es una interfaz soportada.
- La cuenta Admin puede asignar `employee_manager` junto con `admin` y `employee`. No hay edición posterior del rol de cuentas existentes.
- No hay pantalla de proveedores. Apertura y cierre local de caja sí están disponibles; movimientos manuales de efectivo, varios cajones por instalación y sincronización siguen pendientes.
- La autenticación es una barrera de la aplicación local, no cifrado de la base. Alguien con acceso al mismo perfil del sistema operativo y al archivo SQLite puede modificar o copiar datos fuera de la caja. Protegerse de ese escenario requerirá controles del sistema operativo/cifrado y un mecanismo de recuperación diseñado aparte.
- No existe autenticación, usuarios ni aislamiento de comercios en `apps/api`; `/health` continúa siendo una ruta técnica independiente.
