# DIAN: alcance y pendientes

La integración productiva con la DIAN está fuera del alcance del esqueleto actual.

El diseño documental de opciones, habilitación, estados, contingencias, requisitos de datos y controles de reintento está en [`dian/electronic-invoicing-design.md`](dian/electronic-invoicing-design.md). Fue contrastado con fuentes oficiales consultadas el 2026-09-28; no implementa llamadas ni habilita producción.

## No implementado

- No hay llamadas HTTP a servicios de la DIAN.
- No se agregan credenciales, certificados digitales, llaves privadas ni tokens.
- No se genera, firma ni transmite factura electrónica real.
- No se incluyen resoluciones, numeraciones o datos tributarios reales.

## Pendientes antes de integrar

- Confirmar el régimen fiscal, tipos de documento y reglas de numeración aplicables.
- Definir el proveedor o canal técnico autorizado y sus ambientes de pruebas y producción.
- Diseñar el almacenamiento seguro y la rotación de certificados y secretos.
- Formalizar los contratos de emisión, consulta, rechazo y contingencia.
- Añadir pruebas con datos sintéticos en un ambiente controlado.
- Revisar requisitos legales y operativos con el responsable tributario.

Hasta entonces, cualquier integración debe permanecer detrás de interfaces locales y adaptadores simulados, sin tráfico externo.
