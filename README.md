# Bóveda Disney (PWA)

App de películas de Disney conectada a la API de TMDB. Tiene catálogo con filtro por género (incluye "Caricaturas"), sorteo al azar, lista de vistas y tema claro/oscuro. Se instala en Android desde Chrome.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Estructura de la app |
| `styles.css` | Estilos y colores (los temas se cambian desde los tokens del principio) |
| `app.js` | Lógica: conexión con TMDB, filtros, sorteo, vistas |
| `manifest.webmanifest` | Nombre, ícono y colores para instalarla como app |
| `sw.js` | Service worker: permite abrirla sin conexión y guarda los pósters |
| `icons/` | Íconos de la app |
| `deco/` | Fondos de los estilos temáticos (pinturas de la cueva de Tierra de osos, puertas de Monsters Inc., luna y telarañas de El extraño mundo de Jack) |

## 1. Conseguir el token de TMDB

1. Entrá a https://www.themoviedb.org/settings/api
2. Si todavía no tenés clave, tocá **Solicitar una clave de API**, elegí **Developer** y completá el formulario (podés poner "Uso personal" como descripción y tu GitHub Pages como URL).
3. Cuando te la aprueben vas a ver dos valores. El que usa la app es el **API Read Access Token** (el largo, empieza con `eyJ`).

El token **no va en el código**. Lo pegás en la app la primera vez que la abrís y queda guardado solo en tu celular.

## 2. Subirla a GitHub Pages

1. Creá una cuenta en https://github.com si no tenés.
2. Arriba a la derecha: **+ → New repository**. Nombre: `boveda-disney`. Marcalo como **Public** y tocá **Create repository**.
3. En el repositorio vacío tocá **uploading an existing file**.
4. Arrastrá **todo el contenido** de esta carpeta (los archivos y la carpeta `icons`, no la carpeta que los contiene). Tocá **Commit changes**.
5. Andá a **Settings → Pages**. En *Branch* elegí `main` y carpeta `/ (root)`. Tocá **Save**.
6. Esperá uno o dos minutos. La app queda en:
   `https://TU-USUARIO.github.io/boveda-disney/`

## 3. Instalarla en Android

1. Abrí esa dirección en **Chrome** en el celular.
2. Pegá tu token y tocá **Conectar**. La primera carga descarga el catálogo (tarda unos segundos).
3. Tocá el botón de descarga del header, o el menú ⋮ de Chrome → **Instalar app** / **Agregar a la pantalla principal**.

Queda con su ícono, en pantalla completa, y abre aunque no tengas internet (con el catálogo y los pósters que ya cargaste).

## Cómo actualizarla

1. Cambiá los archivos y subilos de nuevo al repositorio (**Add file → Upload files**, reemplazando los anteriores).
2. En `sw.js` subí el número de `VERSION` (por ejemplo de `'v1'` a `'v2'`). Si no lo cambiás, los celulares siguen mostrando la versión vieja.
3. Cerrá y abrí la app dos veces para que tome el cambio.

## Detalles del catálogo

- Trae las películas de Walt Disney Productions, Walt Disney Pictures, Walt Disney Animation Studios, Pixar, DisneyToon Studios y Disneynature. La lista de estudios está al principio de `app.js` (`STUDIOS`).
- De Touchstone, Skellington y Disney Television Animation trae solo las animadas (`STUDIOS_ANIM`): así entran *El extraño mundo de Jack*, *¿Quién engañó a Roger Rabbit?* o *Goofy: la película*.
- Si falta alguna película puntual, sumá su número a `EXTRA_IDS` en `app.js` (es el número de la dirección `themoviedb.org/movie/NÚMERO`) y subí `CAT_VERSION` para que se vuelva a descargar el catálogo.
- "Caricaturas" es el género Animación de TMDB.
- Por defecto se ocultan los títulos con menos de 15 votos (cortos y rarezas). Se puede cambiar en Ajustes.
- El catálogo se guarda en el celular y se actualiza solo cada 7 días, o a mano desde Ajustes.
- Las vistas se guardan en el celular. Desde Ajustes podés guardar una copia (archivo .json) y cargarla en otro dispositivo.

## Más adelante

- **APK / Play Store:** la misma carpeta se puede envolver con Capacitor y compilar en Android Studio.
- **Sincronizar vistas entre dispositivos:** se puede sumar Firebase o Supabase.
- **Tematización Disney:** se hace cambiando los tokens de color y tipografía al principio de `styles.css`.

Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.
