# Mercado POS Colombia

Esqueleto de un sistema de punto de venta para Colombia. El proyecto usa Node.js 24, npm workspaces, Electron Forge con React para la caja local y Fastify para la API.

Esta primera versión solo comprueba que las piezas arrancan y compilan. No incluye ventas, facturación electrónica real, conexión de producción con la DIAN, sincronización con PostgreSQL ni datos reales.

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
npm run dev:pos     # inicia la caja Electron + React
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

## Estructura

```text
.
├── apps/
│   ├── api/          # API Fastify + TypeScript
│   └── pos/          # Electron Forge + React + TypeScript
├── packages/
│   ├── contracts/    # Contratos TypeBox compartidos
│   └── domain/       # Futuras reglas de negocio
├── docs/             # Arquitectura, offline y DIAN
├── package.json      # Workspaces y comandos raíz
└── tsconfig.base.json
```

## Límites de seguridad de esta etapa

- `.env.example` contiene únicamente valores locales de ejemplo.
- SQLite está reservado para la futura caja local; no se incluye ninguna base de datos.
- No se guardan certificados digitales, credenciales, tokens ni datos de clientes.
- La documentación de DIAN describe decisiones pendientes y no habilita llamadas externas.

Consulta [`AGENTS.md`](AGENTS.md) antes de ampliar el proyecto.
