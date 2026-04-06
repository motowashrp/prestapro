# RutaCobro — Sistema de Gestión de Cartera Diaria

Sistema web para gestión de préstamos con pago diario, rutas de cobro, control de gastos y ganancias mensuales.

## Tecnologías

- HTML5 + CSS3 + JavaScript (ES Modules)
- Firebase Firestore (base de datos en tiempo real)
- Vercel (hosting y despliegue automático)

## Estructura del proyecto

```
rutacobro/
├── index.html       ← Estructura principal
├── style.css        ← Estilos (tema azul)
├── app.js           ← Lógica + Firebase
└── README.md
```

## Cómo subir a GitHub y Vercel

### 1. GitHub
1. Ve a [github.com](https://github.com) → botón verde **"New"**
2. Repository name: `rutacobro`
3. Deja en **Public** (o Private)
4. **NO** marques "Add README" → clic en **Create repository**
5. Clic en **"uploading an existing file"**
6. Arrastra los 4 archivos: `index.html`, `style.css`, `app.js`, `README.md`
7. Clic en **Commit changes**

### 2. Vercel
1. Ve a [vercel.com](https://vercel.com) → **Log in with GitHub**
2. Clic en **"Add New Project"**
3. Busca `rutacobro` → clic en **Import**
4. Framework Preset: **Other**
5. Clic en **Deploy**
6. En ~30 segundos tendrás tu URL: `rutacobro.vercel.app`

### 3. Firebase — Configurar Firestore
1. Ve a [console.firebase.google.com](https://console.firebase.google.com)
2. Tu proyecto: **control-credito**
3. Ve a **Firestore Database** → **Crear base de datos**
4. Selecciona modo **Producción** → elige región más cercana (ej: `us-east1`)
5. En **Reglas**, pega esto temporalmente para pruebas:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

> ⚠️ Cuando el sistema esté en producción real, cambia estas reglas para mayor seguridad.

## Colecciones en Firestore

El sistema crea automáticamente estas colecciones:

| Colección   | Contenido                        |
|-------------|----------------------------------|
| `usuarios`  | Cuentas de admin y cobradores    |
| `rutas`     | Rutas de cobro                   |
| `clientes`  | Clientes del negocio             |
| `prestamos` | Préstamos con registro de pagos  |
| `gastos`    | Gastos por ruta o generales      |
| `cierres`   | Cierres diarios por usuario      |

## Usuario inicial

Al iniciar el sistema por primera vez se crea automáticamente:

| Usuario | Contraseña |
|---------|-----------|
| `admin` | `admin123` |

**Cambia la contraseña desde el módulo Usuarios después de ingresar.**

## Funcionalidades

- Login con roles: **Administrador** y **Cobrador de ruta**
- Gestión de rutas, clientes y préstamos
- Registro de cobros diarios por cuota
- Control de gastos por categoría y ruta
- Ganancias mensuales con margen
- Cierre diario por ruta
- Alertas de mora automáticas
- Exportación a Excel (cartera, cobros, morosos, ganancias)
- Sincronización en tiempo real con Firebase
- Funciona en celular y computador

## Actualizar el sistema

Cada vez que edites los archivos:
1. Ve a tu repositorio en GitHub
2. Abre el archivo → clic en el ícono de lápiz (editar)
3. Haz los cambios → **Commit changes**
4. Vercel detecta el cambio y redespliega automáticamente en ~30 segundos

---

Desarrollado con Firebase + Vercel · RutaCobro 2025
