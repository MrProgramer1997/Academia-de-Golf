# Academia de Golf — control de asistencia

Aplicación web estática para Visual Studio Code, Supabase y GitHub Pages. Permite registrar clases y asistencia, listar golfistas por grupo, consultar el historial, ver indicadores y añadir grupos, profesores o golfistas.

## Instalación

1. Abre `supabase/setup.sql`, copia todo y ejecútalo en **Supabase > SQL Editor**.
2. Ejecuta después `supabase/02_datos_academia_2026.sql`. Este carga los 83 golfistas del PDF sin duplicarlos.
3. En **Supabase > Project Settings > API**, copia la URL del proyecto y la clave pública (`publishable` o `anon`).
4. Pega ambos valores en `config.js`. No uses nunca la clave `service_role` o una secret key en este proyecto.
5. Abre la carpeta en Visual Studio Code y prueba con la extensión **Live Server**. No abras `index.html` directamente con doble clic.
6. Sube esta carpeta a GitHub y activa **Settings > Pages > Deploy from a branch**, rama `main`, carpeta `/root`.

## Modelo de datos

- `golf_groups`: grupos de la academia.
- `golf_professors`: profesores.
- `golf_students`: acción, nombre y grupo de cada golfista.
- `golf_sessions`: fecha, profesor, grupo y tipo de cada clase.
- `golf_attendance`: relación de presentes por clase.

## Importación futura del Excel

El listado oficial de 2026 ya está incorporado. La acción puede repetirse entre integrantes de una misma familia; el sistema evita duplicar la combinación de nombre y acción.

## Decisión de acceso público

La aplicación no usa contraseña por solicitud del proyecto. Por tanto, cualquier persona con el enlace puede ver y modificar los datos. RLS está habilitado y sólo concede las operaciones necesarias, pero sin identidad no es posible saber quién realizó un cambio ni impedir que un visitante modifique registros. Si más adelante se requiere auditoría, debe añadirse autenticación para profesores o un PIN de edición.
