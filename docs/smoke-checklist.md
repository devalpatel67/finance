# v1 smoke checklist

Run after any change touching ingestion, auth, or schema. Expects `pnpm dev` and access to the configured Postgres, MinIO, OpenRouter, and Google OAuth.

1. **Fresh sign-in**
   - Visit `http://localhost:3000` → redirect to `/sign-in`.
   - Click "Sign in with Google" → land on `/dashboard`.
   - Verify 15 system categories were seeded (check `/categories`).

2. **Add account**
   - `/accounts` → "Add account" → create one (e.g. "Test Checking", checking, USD).
   - Card appears in the list.

3. **Upload a real PDF**
   - Sidebar → "Upload statement" → pick the account → select a fixture PDF from `tests/fixtures/statements/`.
   - Loading state shows the model name.
   - Redirect to `/statements/<id>` with extracted rows.
   - "Download PDF" link works (presigned URL).

4. **Edit a category**
   - Change a transaction's category from the dropdown.
   - Reload — the change persists.

5. **Reprocess**
   - On the same statement page, click "Reprocess with…" → pick a different model.
   - New rows appear (old ones replaced).

6. **Filters**
   - `/transactions` → apply date and category filters → result narrows.

7. **Settings**
   - Change preferred model → reload the upload dialog and confirm the new model is displayed.

8. **Sign out**
   - Sidebar → Sign out → land on `/sign-in`.
