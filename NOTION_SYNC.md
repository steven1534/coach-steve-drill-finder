# Notion Sync Runbook

## Source of truth

- Notion database: `⚾ LIVE Drill Library`
- Database ID: `fcf3ed8a-ebcd-48b1-994b-1461b2afc7a6`
- Data source: `collection://5c35b9e8-f83e-4547-99d6-47a88c7c00ce`
- Vercel project: `coach-steve-drill-finder`

Do not use the separate `🏏 Hitting Drill Library`; it contains a different,
smaller dataset.

## Security model

The public `data.js` file contains only an AES-GCM encrypted drill payload.
Existing player access-code wrappers are preserved byte-for-byte. A separate
random maintenance code is stored only as the Vercel Sensitive Production
variable `DRILL_SYNC_MAINTENANCE_CODE`.

Never place an access code, maintenance code, Notion credential, decrypted
dataset, or export key in source control, command output, reports, or chat.

## Sync procedure

1. Query every row from the LIVE data source using the connected Notion
   account. Paginate in deterministic 100-row pages.
2. Confirm unique Notion URLs and non-empty drill names.
3. Encrypt the export locally with a new random 32-byte AES-GCM key.
4. Store that key temporarily as the Vercel Sensitive Production variable
   `DRILL_SYNC_EXPORT_KEY`.
5. Put only the encrypted export at `private/notion-export.enc.json`.
6. Write the reviewed expected old/new/matched/added/removed counts to
   `private/sync-expectations.json`.
7. Run `npm test`.
8. Create a guarded Vercel production build with `npm run build`.
9. The build must decrypt the current dataset with the maintenance code,
   preserve existing IDs and wrappers, merge by normalized drill name, reject
   duplicate names/IDs, and refuse unexpected additions or removals.
10. Verify the live count, filters, free-text search, drill detail, video
   fallback, and Session Builder.
11. Delete `DRILL_SYNC_EXPORT_KEY` and all local plaintext exports immediately.

The build intentionally fails before deployment if its count and merge guards
do not match the expected source transition. Adjust count guards only after a
read-only comparison confirms the exact intended additions and removals.
