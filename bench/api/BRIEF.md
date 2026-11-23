# Notes API

A small JSON web API for a notes app, used by a mobile app another team is writing.

- A note has an id, a title, a body and a creation time.
- List notes (newest first), search them by text in the title or body (case-insensitive), create, read one, update,
  delete.
- A note needs a non-empty title (at most 200 characters); the body is optional text.
- Errors are JSON with a helpful message and the right status (400 for bad input, 404 for a missing note).
- Notes are kept on disk and survive a restart.

## Interface (for automated testing; keep these exactly)

`node server.mjs` starts it, listening on the port in the `PORT` environment variable and storing data in the file named
by `DATA_FILE` (default `data.json`). Node.js only (no dependencies needed). Routes:

- `GET /notes` returns `[{ id, title, body, createdAt }]`, newest first; `GET /notes?q=text` only those matching.
- `POST /notes` with `{ "title": "...", "body": "..." }` returns 201 and the note.
- `GET /notes/:id` returns the note; `PUT /notes/:id` with any of title and body returns the updated note;
  `DELETE /notes/:id` returns 204.
- Errors: 400 or 404 with `{ "error": "message" }`.

## Done means

The mobile team can build against it without asking questions.
