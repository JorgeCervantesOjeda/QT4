<!-- docs/superpowers/specs/2026-09-28-user-notification-preferences-design.md: Diseño de preferencias de notificación de cuenta y resumen horario. -->
# Preferencias de notificación de cuenta

**Estado:** diseño aprobado para especificación. La implementación no ha iniciado.

## Base observada

QT4 ya envía correos cuando se crea un comentario de revisión. El flujo actual crea el comentario desde el cliente y después llama a `notifyCommentParticipants`, que resuelve participantes y usa el proveedor activo de correo.

QT4 ya guarda perfiles en `userProfiles/{uid}` y las reglas actuales permiten que cada persona usuaria lea y actualice su propio perfil, preservando `isAdmin`. No existe todavía una pantalla dedicada de configuración de cuenta.

QT4 ya tiene funciones programadas con `onSchedule` y un patrón de digest en `slowUiDigest`, por lo que el resumen horario puede seguir una arquitectura ya presente en el proyecto.

## Objetivo

Agregar dos preferencias configurables por cuenta:

1. Recibir correos inmediatos por cada comentario relacionado con la persona usuaria.
2. Recibir un resumen horario que compile issues y comentarios relacionados con la persona usuaria en un solo correo.

La solución debe respetar preferencias individuales de destinatarios, evitar correos duplicados y mantener retrocompatibilidad razonable con el comportamiento actual.

## Fuera de alcance

- Cambiar el proveedor de correo.
- Crear preferencias por proyecto, documento o versión.
- Enviar resúmenes diarios o semanales.
- Cambiar la semántica de permisos para crear comentarios o issues.
- Reescribir todo el sistema de notificaciones de revisión no relacionado con comentarios.

## Datos

Las preferencias se guardan en `userProfiles/{uid}`:

```ts
type NotificationPreferences = {
  commentEmailEnabled: boolean
  hourlyActivityDigestEnabled: boolean
}
```

Campo propuesto:

```ts
{
  notificationPreferences: {
    commentEmailEnabled: true,
    hourlyActivityDigestEnabled: false
  }
}
```

Valores predeterminados:

- `commentEmailEnabled`: `true`, para conservar el comportamiento actual cuando un perfil antiguo no tenga el campo.
- `hourlyActivityDigestEnabled`: `false`, porque es una nueva clase de correo.

La ausencia del objeto completo se interpreta como estos valores predeterminados. Esta interpretación debe estar centralizada en una función compartida del frontend y una función equivalente en backend; no debe duplicarse de forma ad hoc.

## Relación con la persona usuaria

Un issue o comentario se considera relacionado con una persona usuaria cuando la persona forma parte del conjunto de participantes de revisión usado para notificaciones:

- creador de la versión;
- revisores asignados a la versión;
- creador del issue;
- autores de comentarios previos del issue;
- autor del documento, cuando esté disponible.

El actor que crea el evento no debe recibir notificación por ese mismo evento.

Esta regla es una inferencia de la lógica actual de `notifyCommentParticipants`; no demuestra que cubra todos los casos de negocio posibles, pero mantiene la semántica vigente y evita ampliar el alcance sin evidencia.

## Interfaz de cuenta

Agregar una pantalla o sección de cuenta accesible desde la zona autenticada. Si no existe una navegación de cuenta, la entrada puede vivir inicialmente cerca de la información de sesión mostrada por `AppBrand` o como enlace desde el dashboard.

La pantalla debe mostrar dos controles tipo checkbox:

- `Email me for each related comment`
- `Email me an hourly activity summary`

El texto visible puede ajustarse al idioma dominante de la interfaz actual, que está mayoritariamente en inglés.

Al cambiar una preferencia:

- el checkbox debe reflejar el cambio de manera inmediata;
- debe mostrarse estado visible de guardado;
- si el guardado falla, debe mostrarse un error real y la UI debe dejar claro qué valor quedó persistido;
- el mensaje de éxito o error no debe desaparecer por temporizador.

## Notificación inmediata por comentario

La notificación inmediata por comentario debe moverse a backend o, como paso intermedio controlado, pasar por una función backend que aplique preferencias de destinatarios antes de enviar.

Diseño recomendado:

1. El cliente crea el comentario y termina la operación visible.
2. Un trigger `onDocumentCreated("comments/{commentId}")` carga comentario, thread, versión, documento y perfiles relevantes.
3. La función construye el conjunto de participantes.
4. La función excluye al autor del comentario.
5. La función conserva sólo perfiles con `commentEmailEnabled` efectivo.
6. La función envía el correo inmediato si hay destinatarios.
7. La función registra eventos pendientes para el resumen horario, cuando corresponda.

El cliente ya no debe decidir si otra persona recibe correo, porque no tiene permiso ni debe necesitar permiso para leer preferencias ajenas.

Si se mantiene temporalmente el envío iniciado desde cliente, debe hacerse mediante una función callable o HTTP específica para comentario que reciba `commentId`, resuelva destinatarios en backend y aplique preferencias allí. No debe aceptar listas finales de destinatarios calculadas por el cliente para este flujo.

## Resumen horario

Agregar una colección de eventos de notificación pendiente, por ejemplo `notificationEvents`.

Forma mínima:

```ts
type NotificationEvent = {
  userId: string
  email: string
  kind: "comment" | "issue"
  projectId: string
  docId: string
  versionId: string
  threadId: string
  commentId?: string
  actorId: string
  actorLabel: string
  documentLabel: string
  issueTitle: string
  commentExcerpt?: string
  directUrl: string
  eventAt: unknown
  digestStatus: "pending" | "sent" | "skipped" | "failed"
  digestHourKey: string
  createdAt: unknown
  updatedAt: unknown
}
```

`digestHourKey` debe representar la hora de agrupación de forma estable, por ejemplo `2026-09-28T18`. La zona horaria operativa debe ser explícita; por defecto, usar `America/Mexico_City`, alineada con los jobs existentes.

El job horario debe:

1. Consultar eventos `pending` de la hora cerrada anterior, no de la hora todavía en curso.
2. Agrupar por `userId` y `digestHourKey`.
3. Cargar el perfil actual de cada usuario.
4. Enviar sólo si `hourlyActivityDigestEnabled` efectivo es `true`.
5. Incluir issues creados y comentarios relacionados durante esa hora.
6. Marcar eventos como `sent` con `digestId` si el envío fue exitoso.
7. Marcar eventos como `skipped` si la preferencia está apagada o falta email válido.
8. Marcar eventos como `failed` con causa recortada si el proveedor de correo falla.

El job debe ser idempotente. Un reintento no debe enviar dos correos para el mismo usuario y hora si ya existe un digest marcado como enviado. Puede lograrse con una colección `notificationDigests/{userId_hourKey}` o con una transacción que reclame el grupo antes de enviar.

## Reglas de Firestore

Las reglas deben permitir que una persona usuaria actualice sus propias preferencias sin poder elevar privilegios ni modificar campos restringidos.

Regla esperada:

- `userProfiles/{uid}` sigue siendo legible por la propia persona y por admin.
- La propia persona puede actualizar `notificationPreferences`, `displayName`, `email` y campos ya permitidos según el contrato actual.
- La propia persona no puede cambiar `isAdmin`.
- Los eventos internos de notificación no deben ser escribibles desde cliente, salvo que exista un caso de lectura de depuración explícitamente aprobado.

Si las reglas actuales para `userProfiles` son demasiado amplias, la implementación debe estrecharlas sin romper registro ni carga de perfil.

## Auditoría y observabilidad

Guardar preferencias es una acción de cuenta de bajo riesgo, pero debe dejar evidencia observable cuando falle.

Los fallos de envío o digest no deben ser silenciosos:

- registrar causa;
- registrar fallback o decisión tomada;
- registrar impacto;
- no exponer secretos SMTP ni tokens.

Eventos esperados de log:

- preferencias guardadas;
- notificación inmediata enviada, omitida por preferencia o fallida;
- digest horario enviado, omitido, fallido o sin eventos.

## Compatibilidad

Perfiles existentes sin preferencias deben comportarse así:

- siguen recibiendo correos inmediatos por comentarios relacionados;
- no reciben resumen horario hasta activarlo.

La implementación no requiere migración obligatoria de todos los perfiles. Puede crear el objeto `notificationPreferences` al abrir o guardar la pantalla de cuenta.

## Criterios de aceptación

1. Dada una cuenta autenticada, la persona puede ver dos checkboxes de notificación en configuración de cuenta.
2. Dado un cambio de checkbox exitoso, QT4 persiste la preferencia en `userProfiles/{uid}` y muestra estado visible de guardado.
3. Dado un fallo al guardar, QT4 muestra un error ligado al fallo real y no afirma que la preferencia quedó guardada.
4. Dado un comentario nuevo y un destinatario con `commentEmailEnabled` efectivo en `true`, QT4 envía correo inmediato a ese destinatario.
5. Dado un comentario nuevo y un destinatario con `commentEmailEnabled` efectivo en `false`, QT4 no envía correo inmediato a ese destinatario.
6. Dado un comentario nuevo, el autor del comentario no recibe correo por su propio comentario.
7. Dado un usuario con `hourlyActivityDigestEnabled` en `true` y eventos relacionados durante la hora cerrada anterior, QT4 envía un solo correo de resumen para esa hora.
8. Dado un usuario con `hourlyActivityDigestEnabled` en `false`, QT4 no envía resumen horario y marca los eventos como omitidos.
9. Dado un reintento del job horario, QT4 no duplica un digest ya enviado para la misma persona y hora.
10. Dado un perfil antiguo sin `notificationPreferences`, QT4 aplica los valores predeterminados definidos.

## Estrategia de verificación

La base de prueba es este documento de diseño y el comportamiento actual de notificación por comentario.

Verificación estática:

- revisar tipos de preferencias;
- revisar reglas de Firestore;
- revisar que el filtrado de destinatarios esté en backend;
- revisar que no haya fallbacks silenciosos.

Verificación dinámica:

- prueba de componente para la pantalla de cuenta y sus estados de guardado/error;
- prueba de reglas para actualización propia de preferencias y rechazo de cambios a `isAdmin`;
- prueba unitaria de resolución de preferencias predeterminadas;
- prueba de función para notificación inmediata por comentario con preferencia encendida/apagada;
- prueba de función para digest horario, agrupación por usuario/hora e idempotencia;
- prueba de regresión del flujo de comentario para comprobar que crear un comentario sigue funcionando aunque el correo falle.

Estas pruebas aportan evidencia sobre los casos ejecutados. No demuestran que toda interpretación posible de “relacionado al usuario” sea correcta; esa regla queda definida aquí como continuidad del conjunto de participantes actual.

## Riesgos residuales

- El trigger backend puede enviar correos aunque el cliente ya no muestre el estado de envío inmediato. La UI debe distinguir entre “comentario creado” y “notificación encolada/enviada” si se decide mostrar ese detalle.
- Si el proveedor de correo falla durante el digest, habrá que decidir si el siguiente job reintenta eventos `failed` o si existe un job manual de recuperación.
- Consultar muchos perfiles y eventos por hora puede requerir índices y límites de lote. La primera implementación debe imponer límites explícitos y registrar cuando se alcance un límite.

