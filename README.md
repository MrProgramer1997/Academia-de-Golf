# Academia de Golf — control de asistencia

Aplicación web estática para Visual Studio Code, Supabase y GitHub Pages. Permite registrar y modificar clases, controlar presentes y llegadas tarde, listar golfistas por grupo, consultar el historial, ver indicadores y añadir grupos, profesores o golfistas.

> El proyecto Supabase `Academia de Golf` ya fue configurado y cargado el 2 de septiembre de 2026. Los pasos SQL siguientes sólo son necesarios si se instala una copia en otro proyecto.

## Instalación

1. Abre `supabase/setup.sql`, copia todo y ejecútalo en **Supabase > SQL Editor**.
2. Ejecuta después `supabase/02_datos_academia_2026.sql`. Este carga los 83 golfistas del PDF sin duplicarlos.
3. Si actualizas una instalación anterior, ejecuta `supabase/03_edicion_clases_y_llegadas_tarde.sql`.
4. En **Supabase > Project Settings > API**, copia la URL del proyecto y la clave pública (`publishable` o `anon`).
5. Pega ambos valores en `config.js`. No uses nunca la clave `service_role` o una secret key en este proyecto.
6. Abre la carpeta en Visual Studio Code y prueba con la extensión **Live Server**. No abras `index.html` directamente con doble clic.
7. Sube esta carpeta a GitHub y activa **Settings > Pages > Deploy from a branch**, rama `main`, carpeta `/root`.

## Modelo de datos

- `golf_groups`: grupos de la academia.
- `golf_professors`: profesores.
- `golf_students`: acción, nombre y grupo de cada golfista.
- `golf_sessions`: fecha, profesor, grupo y tipo de cada clase.
- `golf_attendance`: asistentes por clase, con estado presente/tarde y hora opcional de llegada.

## Importación futura del Excel

El listado oficial de 2026 ya está incorporado. La acción puede repetirse entre integrantes de una misma familia; el sistema evita duplicar la combinación de nombre y acción.

## Decisión de acceso público

La aplicación no usa contraseña por solicitud del proyecto. Cualquier persona con el enlace puede consultar, tomar asistencia, modificar clases y asistencias, y añadir golfistas, profesores o grupos. Si más adelante se necesita identificar quién realizó cada cambio, debe añadirse autenticación para profesores o un PIN de edición.
