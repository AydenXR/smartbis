# Frontend Panel de Base de Datos

Panel visual read-only para explorar la información ingerida en Qdrant.

## Ejecutar

```bash
cd frontend
npm install
npm start
```

Abre:

```text
http://localhost:4173
```

## Variables opcionales

- `FRONTEND_PORT` puerto del panel (default `4173`)
- `FRONTEND_QDRANT_URL` URL de Qdrant (default `http://127.0.0.1:6333`)
- `FRONTEND_QDRANT_API_KEY` API key de Qdrant (si aplica)

## Qué incluye

- Resumen de colección (conteo, segmentos, dimensión)
- Carga completa de puntos
- Filtros por archivo y búsqueda por texto
- Tabla de chunks
- Vista detalle JSON por punto
