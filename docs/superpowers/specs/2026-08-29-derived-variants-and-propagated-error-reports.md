# Derivación de documentos y reportes de error propagados

**Estado:** requisitos para implementación. No modifican el flujo actual de corrección de un documento aceptado dentro de su mismo proyecto.

## Base observada

QT4 modela una solicitud de cambio como un documento del proyecto destino con `baseProjectId`, `baseDocId` y `baseVersionId`. La versión base debe estar aceptada y el proyecto base debe ser distinto del proyecto destino. En cambio, el reporte de error actual sólo puede referir una versión aceptada del mismo proyecto.

Estos requisitos extienden ese modelo. No afirman que el comportamiento descrito ya esté implementado.

## Términos

- **Proyecto variante:** proyecto derivado. Su identidad es el identificador del proyecto; no existe una entidad adicional llamada variante.
- **Proyecto origen:** proyecto del que procede el documento base.
- **Configuración activa:** concepto deducido, no persistido. Para una línea documental de un proyecto variante equivale a la versión base y a todas sus solicitudes de cambio aceptadas.
- **Documento derivado:** documento completo creado en el proyecto variante a partir de una versión base y de las solicitudes aceptadas de su configuración activa.
- **Solicitud incorporada:** solicitud aceptada que fue incluida en un documento derivado aceptado.
- **Reporte propagado:** reporte de error creado en un proyecto variante a partir de una versión aceptada de un reporte de error origen.
- **Identificador interno:** identificador largo de persistencia. En QT4 los identificadores de documentos y versiones son globales dentro de sus colecciones.
- **Referencia corta visible:** referencia mostrada a la persona usuaria mediante el identificador corto del proyecto, el identificador corto del documento y la versión formateada.

## Requisitos funcionales

### Configuración activa y solicitudes

- **CFG-01.** QT4 debe identificar todo documento base mediante el proyecto origen, el documento base y una versión base concreta aceptada.
- **CFG-02.** Una solicitud de cambio aceptada debe formar parte de la configuración activa de su documento base en el proyecto destino.
- **CFG-03.** QT4 debe deducir la configuración activa a partir de las solicitudes aceptadas del proyecto variante que refieren el mismo proyecto origen, documento base y versión base.
- **CFG-04.** QT4 no debe persistir una entidad, identificador o sistema independiente de configuraciones.
- **CFG-05.** Cada solicitud de cambio debe pasar por el flujo de revisión de documentos antes de poder quedar aceptada.
- **CFG-06.** La revisión de una solicitud de cambio debe determinar su compatibilidad con las demás solicitudes de la misma línea documental.
- **CFG-07.** QT4 no debe inferir automáticamente la compatibilidad semántica entre solicitudes a partir de sus archivos.
- **CFG-08.** Una solicitud incompatible debe corregirse y revisarse de nuevo antes de quedar aceptada.
- **CFG-09.** Una solicitud de cambio pertenece al proyecto actual y refiere una versión aceptada de un documento de otro proyecto.
- **CFG-10.** Los cambios solicitados no deben modificar el proyecto origen, el documento base ni la versión base.
- **CFG-11.** Mientras no exista un documento derivado aceptado para la misma combinación de proyecto actual, proyecto origen, documento base y versión base, QT4 debe permitir aceptar nuevas solicitudes de cambio compatibles sobre esa línea documental.
- **CFG-12.** Si ya existe un documento derivado aceptado para esa combinación, QT4 no debe aceptar nuevas solicitudes de cambio sobre la misma base; las correcciones posteriores deben tramitarse mediante reportes de error sobre el documento derivado aceptado.

### Derivación de documento

- **DER-01.** QT4 debe permitir que la persona autorizada inicie la derivación desde un documento base con solicitudes aceptadas en el proyecto variante.
- **DER-02.** QT4 debe mostrar todas las solicitudes aceptadas de la configuración activa al iniciar una derivación.
- **DER-03.** La derivación debe incluir todas las solicitudes aceptadas mostradas para la misma línea documental.
- **DER-04.** QT4 debe crear en el proyecto variante un documento derivado completo a partir de la versión base y de las solicitudes incluidas.
- **DER-05.** La primera versión del documento derivado debe ser `0.01`.
- **DER-06.** El documento derivado debe referir el proyecto origen, el documento base y la versión base concreta.
- **DER-07.** El documento derivado debe listar las versiones exactas de todas las solicitudes incluidas.
- **DER-08.** El documento derivado debe pasar por el flujo normal de revisión antes de quedar aceptado.
- **DER-09.** La aceptación del documento derivado debe sustituir la configuración activa formada por la versión base y las solicitudes aceptadas.
- **DER-10.** La versión aceptada de cada solicitud incorporada debe pasar al estado `Replaced` cuando el documento derivado quede aceptado.
- **DER-11.** La aceptación del documento derivado y el reemplazo de sus solicitudes incorporadas deben ejecutarse en una sola operación atómica.
- **DER-12.** El documento derivado aceptado debe conservar las referencias a la base y a las solicitudes incorporadas.
- **DER-13.** Una solicitud en estado `Replaced` no debe formar parte de la configuración activa.
- **DER-14.** Al aceptar el documento derivado, QT4 debe validar contra la configuración activa vigente. Si existen solicitudes aceptadas de la misma línea documental que no están incorporadas, la aceptación debe fallar.

### Estados y rechazo de documento

- **EST-01.** QT4 debe mantener como máximo una versión en estado `Accepted` por documento.
- **EST-02.** QT4 no debe crear un estado adicional para representar el rechazo de un documento.
- **EST-03.** El rechazo de un documento debe cambiar a `Rejected` la versión que se encontraba en revisión.
- **EST-04.** El rechazo de un documento debe cambiar a `Replaced` la última versión aceptada en la misma operación atómica.
- **EST-05.** Después de rechazar un documento, QT4 no debe conservar una versión en estado `Accepted` para ese documento.
- **EST-06.** El estado `Replaced` debe significar que una versión dejó de ser la versión aceptada vigente, aunque la versión posterior haya quedado rechazada.
- **EST-07.** La documentación oficial debe seleccionar sólo versiones en estado `Accepted`.

### Evolución de la base y propagación

- **EVO-01.** La evolución de una línea documental debe originarse en reportes de error aceptados sobre una versión concreta del documento afectado.
- **EVO-02.** Cuando un reporte de error sea aceptado, QT4 debe localizar los proyectos variante mediante las solicitudes de cambio y los documentos derivados que refieren la versión afectada.
- **EVO-03.** La existencia de una versión posterior de la base no debe modificar automáticamente un proyecto variante ni un documento derivado.
- **EVO-04.** El impacto de una evolución de la base debe analizarse por separado en cada proyecto variante.
- **ERR-01.** QT4 debe propagar un reporte de error sólo después de aceptar una versión concreta de ese reporte.
- **ERR-02.** Los reportes en creación, revisión, revisados o rechazados no deben propagarse.
- **ERR-03.** Por cada proyecto variante localizado, QT4 debe crear un reporte propagado asociado a la línea documental afectada.
- **ERR-04.** El reporte propagado debe referir de forma inmutable el documento y la versión aceptada del reporte origen, además de la versión base que originó el reporte.
- **ERR-05.** QT4 debe mostrar en el reporte propagado el mismo archivo de la versión aceptada del reporte origen.
- **ERR-06.** QT4 no debe copiar el archivo del reporte origen ni crear otro objeto de almacenamiento para presentar su contenido.
- **ERR-07.** La referencia al archivo debe resolverse desde la versión origen, no desde un nombre de archivo ni desde una versión posterior.
- **ERR-08.** QT4 debe permitir que cada proyecto variante acepte o rechace su reporte propagado de manera independiente.
- **ERR-09.** La decisión sobre el reporte origen no debe decidir automáticamente las réplicas, salvo que su aceptación sea la condición que las crea.
- **ERR-10.** La aceptación de un reporte propagado debe habilitar el procedimiento aplicable para corregir la línea documental afectada.
- **ERR-11.** El rechazo de un reporte propagado debe conservar el vínculo al reporte origen y la decisión local.
- **ERR-12.** El rechazo de un reporte propagado no debe modificar el reporte origen.
- **ERR-13.** QT4 debe impedir más de un reporte propagado para la misma combinación de proyecto variante, línea documental y versión aceptada del reporte origen.
- **ERR-14.** La creación de reportes propagados debe ser idempotente para tolerar reintentos de la operación automática.
- **ERR-15.** QT4 debe tratar una nueva versión aceptada del reporte origen como una fuente nueva.
- **ERR-16.** Una nueva versión aceptada del reporte origen no debe alterar el contenido ni la decisión de los reportes propagados que refieren una versión anterior.

### Compatibilidad con el flujo actual

- **CMP-01.** Un reporte de error creado manualmente para corregir un documento aceptado dentro de su mismo proyecto debe mantener las reglas actuales de QT4.
- **CMP-02.** Un reporte propagado debe referir la línea documental de otro proyecto mediante la referencia al reporte origen aceptado.
- **CMP-03.** La excepción de un reporte propagado no debe habilitar la creación de un reporte de error transfronterizo ordinario.
- **CMP-04.** Una solicitud de cambio no debe sustituir el reporte de error para corregir un documento aceptado dentro del mismo proyecto.

## Datos mínimos y reglas de integridad

El documento derivado debe conservar los datos de procedencia en su propio registro. No requiere una relación de configuración separada.

```ts
type DerivedDocumentReference = {
  originProjectId: string
  originDocumentId: string
  originVersionId: string
  incorporatedChangeRequestVersionIds: string[]
}
```

El reporte propagado debe conservar la relación con el origen y con la línea documental local:

```ts
type PropagatedErrorReportReference = {
  variantProjectId: string
  sourceErrorReportDocumentId: string
  sourceErrorReportVersionId: string
  sourceBaseDocumentId: string
  sourceBaseVersionId: string
  derivedDocumentId?: string
  activeChangeRequestVersionIds: string[]
}
```

La implementación debe validar que:

- el proyecto variante, el origen, los documentos y las versiones referidas existen;
- la versión base y la versión del reporte origen están aceptadas;
- las solicitudes incluidas pertenecen a la misma línea documental y están aceptadas;
- las solicitudes incluidas siguen siendo la configuración activa vigente al momento de aceptar el documento derivado;
- el documento derivado pertenece al proyecto variante y su primera versión es `0.01`;
- el archivo mostrado por un reporte propagado pertenece a la versión aceptada del reporte origen;
- la persona usuaria tiene permisos de lectura sobre el origen y permisos de revisión o decisión sobre el proyecto variante;
- las referencias visibles se resuelven con identificadores cortos y número de versión formateado, no con identificadores internos largos.

Los identificadores internos deben usarse para integridad, enlaces y auditoría técnica. La interfaz debe mostrar las referencias de procedencia en forma corta, por ejemplo `Proyecto 3 · Documento 12 · v1.00`, resolviendo `project.shortId`, `document.shortId` y el número de versión formateado. Si falta un identificador corto, la interfaz debe mostrar una etiqueta de respaldo explícita y observable, sin sustituir el identificador interno como etiqueta principal.

## Automatización y observabilidad

- **AUTO-01.** La aceptación del reporte origen debe iniciar una operación de propagación durable y reintentable.
- **AUTO-02.** La unicidad indicada en ERR-13 debe imponerse en la persistencia, no sólo en la interfaz.
- **AUTO-03.** QT4 debe registrar el resultado por cada proyecto variante: reporte creado, reporte ya existente, línea documental no disponible, permiso insuficiente o error.
- **AUTO-04.** Los fallos de propagación no deben ocultarse ni dejar la operación como aparentemente terminada.

## Criterios de aceptación

1. Dado un documento base con dos solicitudes compatibles aceptadas en un proyecto variante, QT4 muestra ambas al iniciar la derivación y crea un documento derivado inicial `0.01` con las tres referencias de procedencia.
2. Dado un documento derivado revisado y aceptado, QT4 marca `Replaced` las versiones aceptadas de todas las solicitudes incorporadas y deja de considerarlas parte de la configuración activa.
3. Dado un reporte origen rechazado, QT4 no crea reportes propagados.
4. Dado un reporte propagado rechazado, QT4 conserva el reporte origen y la decisión local sin cambiar el estado del origen.
5. Dada una nueva versión aceptada del reporte origen, QT4 no altera las decisiones ligadas a la versión anterior y crea, cuando corresponda, un nuevo reporte propagado para la nueva versión.
6. Dada una solicitud incompatible durante su revisión, QT4 impide aceptarla hasta que se corrija y vuelva a revisarse.
7. Dada una reejecución de la propagación, QT4 no crea duplicados para la misma combinación protegida por ERR-13.
8. Dado un intento de construir un reporte propagado sin una fuente aceptada o sin los permisos requeridos, la capa de persistencia rechaza la operación.
9. Dado el rechazo de un documento, QT4 deja su versión en revisión como `Rejected`, deja la última aceptada como `Replaced` y no conserva ninguna versión `Accepted` para ese documento.
10. Dado un documento derivado todavía no aceptado, QT4 permite aceptar una nueva solicitud compatible sobre la misma base y después impide aceptar el documento derivado si esa solicitud no fue incorporada.
11. Dado un documento derivado aceptado, QT4 rechaza la aceptación de nuevas solicitudes de cambio sobre la misma base dentro del proyecto variante e indica que la corrección debe tramitarse mediante reporte de error.
12. Dada una referencia de procedencia visible, QT4 muestra identificador corto de proyecto, identificador corto de documento y versión formateada, conservando los identificadores internos sólo como referencias de integridad.

## Evidencia y límites

Las pruebas unitarias, de reglas de Firestore, de integración de la propagación y del flujo visible aportan evidencia de los casos ejecutados. No demuestran que QT4 detecte toda incompatibilidad semántica entre solicitudes ni que toda evolución de la base aplique a cada proyecto variante; esas decisiones requieren revisión humana documentada.
