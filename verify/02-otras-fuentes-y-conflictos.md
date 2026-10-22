# Otras fuentes y conflictos de precios de cursos

Este archivo reúne precios de cursos que aparecen fuera del inventario de fichas y las diferencias entre copias. Las fuentes repetidas pueden ser snapshots, backups o instrucciones históricas; su presencia **no significa que sean precio vigente**.

**Este archivo es un reporte de auditoría y no se ingiere ni se usa para generar respuestas.** El flujo de Messenger busca en documentos activos del tenant en Supabase; la carpeta raíz `verify/` no forma parte de esa ingesta. Las fechas y precios oficiales deben salir de la ficha correspondiente en el documento activo `cursos.md`.

## Diferencias entre las dos copias completas de cursos

Se compararon por nombre exacto las fichas de `clientsdata/0308261/cursos.md` y `content/cursos.md`. Coinciden en nombre, pero **16** tienen precio distinto:

| Curso | `clientsdata/0308261/cursos.md` (línea) | `content/cursos.md` (línea) |
|---|---|---|
| Bioestimulación con PDRN de salmón | Online: $895 MXN ($48 USD) / Presencial: $2850 MXN (L534) | Online: $595 MXN ($33 USD) / Presencial: $1750 MXN (L522) |
| Microrellenos | Online: $895 MXN ($48 USD) / Presencial: $2850 MXN (L547) | Online: $595 MXN ($33 USD) / Presencial: $2850 MXN (L535) |
| Relleno de labios con HP | Online: $595 MXN ($33 USD) / Presencial: $1350 MXN (L560) | Online: $595 MXN ($33 USD) / Presencial: $2850 MXN (L548) |
| Maderoterapia | Online: $895 MXN ($48 USD) (L573) | Online: $595 MXN ($48 USD) (L561) |
| BB Glow | Online: $895 MXN ($48 USD) / Presencial: $2850 MXN (L669) | Online: $595 MXN ($33 USD) / Presencial: $2850 MXN (L655) |
| Rejuvenecimiento y eliminación de manchas con Dermapen | Online: $895 MXN ($48 USD) / Presencial: $2850 MXN (L682) | Online: $595 MXN ($33 USD) / Presencial: $1350 MXN (L668) |
| Manejo de estrías y cicatrices con Dermapen y Fibroblast | Online: $895 MXN ($48 USD) / Presencial: $2850 MXN (L695) | Online: $595 MXN ($33 USD) / Presencial: $1350 MXN (L681) |
| Soft Plasma | Online: $895 MXN ($48 USD) / Presencial: $2850 MXN (L708) | Online: $595 MXN ($33 USD) / Presencial: $2850 MXN (L694) |
| Eliminación de tatuajes con Fibroblast | Online: $895 MXN ($48 USD) / Presencial: $2850 MXN (L721) | Online: $595 MXN ($33 USD) / Presencial: $2850 MXN (L707) |
| Limpiezas faciales | Online: $895 MXN ($48 USD) / Presencial: $2850 MXN (L748) | Online: $595 MXN ($33 USD) / Presencial: $2850 MXN (L734) |
| Acné activo, Rosácea y cicatrices con RF fraccionada | Online: $895 MXN ($48 USD) (L774) | Online: $595 MXN ($33 USD) (L760) |
| Rejuvenecimiento y Reafirmación con RF fraccionada | Online: $895 MXN ($48 USD) (L786) | Online: $595 MXN ($33 USD) (L772) |
| Tratamientos corporales con Radiofrecuencia Fraccionada | Online: $895 MXN ($48 USD) (L795) | Online: $595 MXN ($33 USD) (L781) |
| Micropuntura | Online: $895 MXN ($48 USD) (L807) | Online: $595 MXN ($33 USD) (L793) |
| Peeling químico | Online: $895 MXN ($48 USD) / Presencial: $2850 MXN (L819) | Online: $595 MXN ($33 USD) / Presencial: $2850 MXN (L805) |
| Exosomas | Online: $895 MXN ($48 USD) (L900) | Online: $595 MXN ($33 USD) (L878) |

Otras diferencias estructurales: la ficha se llama “Hidrofacial técnico” en el documento del tenant y “Hidrofacial” en `content/cursos.md`; los precios no deben cruzarse por similitud de nombre.

## Precio de curso en el POS

- En `clientsdata/0308261/productos.md` L2043–2049 existe un registro `[PRODUCTO]`: **Curso Higiene Facial**, SKU `CUR-001`, precio **$3,500 MXN**. El POS local `clientsdata/_meta_store/pos_0308261.json` refleja ese registro como `kind: course`, `salePrice: 3500`, origen `productos.md` (cerca de L5090–5096).
- El mismo registro aparece en backups `pos_0308261.json.bak-20260905-205449` y `pos_0308261.json.bak-20260905-210727`; son copias del POS, no tres precios independientes.
- El otro tenant `clientsdata/988d43bb-2d2c-4f07-a731-a0a02c9a3060/productos.md` también registra “Curso Higiene Facial” a **$3,500 MXN**; su POS `clientsdata/_meta_store/pos_988d43bb-2d2c-4f07-a731-a0a02c9a3060.json` refleja precio de venta 3500 (cerca de L206–211). Es otro tenant y no prueba el precio de Salubel.
- El POS de Salubel también contiene muchos precios de productos. No los listé como cursos salvo que el registro esté marcado explícitamente `kind: course` o sea el producto “Curso Higiene Facial”.

## Instrucciones de precios dentro del prompt

En [`prompt.md`](../prompt.md) aparecen reglas/ejemplos que pueden influir en respuestas aunque contradigan una ficha recuperada:

- L151 atribuye al curso de estrías online **$595 MXN ($33 USD)** y presencial **$1,350 MXN**. En la ficha actual del tenant está **$895 MXN ($48 USD)** y presencial **$2,850 MXN**. Esta es una contradicción directa para ese curso.
- L205 y L216 usan como ejemplo genérico presencial **$2,850** y online **$895 MXN / aproximadamente $48 USD**.
- L242 exige ese mismo formato fijo ($2,850 presencial y $895 online) para una ficha, aunque no es correcto para todos los cursos.
- L369–373 mapean $895 y $595 a enlaces Stripe. Son reglas de pago, no catálogo curso→precio, pero fijan cifras y asociaciones de enlace en el prompt.
- L84 menciona $2,850 en una regla de fecha de Mesobotox; ese número es texto ilustrativo de la regla, no una cotización por sí mismo.

## Migraciones SQL con importes de pagos

- `supabase/migrations/20260903_actualizar_prompt_salubel_pagos_inscripciones.sql` contiene $895/$48, $595/$33 y sus enlaces Stripe (L26–29, L59–62).
- `supabase/migrations/20260903_actualizar_prompt_salubel_productos_pagos.sql` contiene los mismos importes y enlaces (L67–68, L119).
- Son instrucciones históricas de pago. No indican por sí mismas qué curso tiene cada precio; la asociación debe salir de la ficha específica.
- `src/components/Dashboard.tsx` L891 también conserva una nota de cambios que menciona $895 y $595 para enlaces de Stripe.

## FAQs y cantidades que no son precio del curso

- `clientsdata/0308261/faqs.md` L142 y L158 menciona apartado de **$500 MXN**; `content/faqs.md` L50, `clientsdata/0308261/infogeneral.md` L41 y `content/infogeneral.md` L89–96 también mencionan $500. Es depósito/apartado, no costo total del curso.
- `content/infogeneral.md` contiene además $500 MXN de apartado y políticas de cancelación. No confundirlo con precio total.

## Snapshots y almacenamiento local

- `clientsdata/_meta_store/pos_0308261.json` contiene copias de bloques de documentos/catalogación; no asumir que todo texto almacenado allí se envía al LLM.
- `clientsdata/_meta_store/pos_907a8c42-89d5-4d9e-bbb2-00b394eb934c.json` y `clientsdata/_meta_store/pos_988d43bb-2d2c-4f07-a731-a0a02c9a3060.json` incluyen datos de otros tenants/snapshots. Algunos registros de texto referencian fichas de cursos y sus precios. No son fuente de Salubel sin verificar el tenant activo.
- Backups `.bak-*` repiten el mismo catálogo y deben tratarse como historial, no como valores actuales.
- Los archivos de mensajes/referrals pueden contener precios escritos por personas o respuestas previas. No son fuentes oficiales de precio; se excluyeron del catálogo para no elevar conversaciones a dato oficial.

## Hallazgo principal

Hay al menos dos catálogos completos y sus importes no están sincronizados. Además, el prompt contiene una asociación antigua para estrías ($595/$33 y $1,350) y una plantilla que generaliza $895/$48 y $2,850. Si el RAG recupera la copia equivocada o el modelo sigue esos ejemplos, puede dar un precio incorrecto aun cuando exista otra ficha con el precio correcto. Para la conversación de Dermapen de la captura, el $895 MXN ($48 USD) sí coincide con la ficha del tenant en `clientsdata/0308261/cursos.md`.

## Para seguir el rastro en producción

Los archivos locales permiten auditar el repositorio, pero no prueban qué versión de documentos estaba activa en Supabase ni qué contexto recibió una conversación concreta. Para cerrar ese punto hacen falta los logs de `generateDbAgentAnswer` (contexto recuperado) y el registro del autocurador de ese mensaje.
