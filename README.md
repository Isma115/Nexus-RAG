# nexus-rag

RAG local que reutiliza diseño NexusData (Express + SQLite `node:sqlite` + auth cookie/JWT + fuentes `sources`/`documents` + offline-first). Sirve para **iterar documentos**: indexar carpetas locales, buscar, conversar con citas y guardar historial.

Solo fuente `local` activa. `rest`/`web`/`db` dejan interfaz preparada. Multi-usuario deja tabla `users`, roles y rutas preparadas tras `USERS_ENABLED=true` (a futuro).

## Arranque

```bash
cp .env.example .env
npm install
npm run dev            # app Electron (backend + ventana en http://127.0.0.1:3330)
npm start              # solo web: http://127.0.0.1:3330
npm run ingest -- ./docs           # indexa una carpeta como fuente local
npm run reindex -- --source <id>   # re-trocea y reindexa
npm run export -- --out rag-export.json
```

## API

- `GET /api/health`
- `POST /api/auth/offline` · `GET /api/auth/me` · `POST /api/auth/logout` (register/login devuelven 403 en modo offline, igual que NexusData)
- `GET/POST /api/sources` · `PUT/DELETE /api/sources/:id` · `POST /api/sources/:id/sync|test`
- `GET /api/documents` · `GET /api/documents/:id` · `GET /api/search?q=`
- `POST /api/rag/ask` `{ question, sourceId?, topK? }` → `{ answer, citations, chunks }`
- `POST /api/rag/reindex` `{ sourceId? }`
- `GET/POST /api/conversations` · `GET /api/conversations/:id` · `POST /api/conversations/:id/ask`
- `GET /api/users` etc → `501` hasta activar `USERS_ENABLED=true` (preparado a futuro)

Respuesta RAG extractiva local: sin LLM externo, compone pasajes literales con citas `[n] título §chunk`. Con `LLM_PROVIDER=ollama|openai` el `server/services/llm/` ya deja el contrato listo.
# Nexus-RAG
