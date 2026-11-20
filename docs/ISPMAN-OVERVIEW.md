# ISPman customer overview

The owner can open **Customers → ISPman overview** to view a separate, manually imported snapshot of ISPman customer records. It does not synchronize automatically. ISPman remains the source of truth.

## Import

1. In ISPman, export the desired service's customers to Excel.
2. Save the customer worksheet as **CSV UTF-8**. XLSX files are not accepted directly. Remove passwords, secrets and credential columns before selecting the file.
3. Open **ISPman overview** in netops as the owner. Choose **PPPoE** or **Hotspot** to match the exported list.
4. Select the CSV and press **Preview import**. Review new, updated and unchanged records, identifier conflicts and parsing notes.
5. Tick the review checkbox and press **Import into overview**.

PPPoE requires `Username` and `Package` (also accepts `Plan`). Hotspot requires `Payment Wallet` or a real source `Username`, plus a `Package` column; blank Hotspot packages are retained. Optional headings include `Name`, `Phone Number`, `Email`, `Balance`, `Available Balance`, `Current Balance`, `Currency`, `Expires At`, `Status`, `Last Device`, `Last Seen` and `Active Connects`. Wallet-only records do not receive invented usernames or netops account matches. Available and current balances remain separate. Last-seen and active-connect values are labelled as export data, never as live session evidence. CSV may use commas, semicolons or tabs consistently. Limit: 4 MiB and 5,000 customers per file and in the stored overview.

Keep payment-wallet IDs in subsequent exports whenever available. A matching wallet ID within the same service updates that record, including a changed username. Otherwise an exact username match after case/whitespace normalization updates the existing mirror entry. Conflicting identifiers or duplicate rows block the complete import. PPPoE and Hotspot identities are separate. Missing customers are retained; the per-record import date indicates which records were refreshed. Omitted columns retain earlier values for an existing record; a supplied blank cell clears that source field.

Balance and expiry **source text is always retained**. Composite balance values such as `KES: 0.00 / 0.00` are not treated as a single financial amount. Ambiguous dates are retained as text, with a note in the preview. Unambiguous ISO dates use Nairobi time when no offset is supplied. No balances are added to revenue or native wallets.

The November 2026 PPPoE and Hotspot exports omit expiry dates. The overview displays “Not supplied” for those records; `Active` source status is not interpreted as an expiry or authorization guarantee.

## Boundaries

- Only administrators can read, preview or import this data. It is intentionally not exposed through general search, customer exports, subscriber APIs or the customer portal.
- Import state lives in the `ispmanMirror` setting. No native subscriber, plan, password, payment, ledger, job, device or router configuration is changed. No welcome messages are sent.
- Netops account matches use the same service and normalized username, retain the domain/realm and are informational only. No account is automatically linked, merged or created.
- The server recomputes the preview and checks its digest and revision before committing. A changed file or concurrent import requires a fresh preview. Changes and the audit entry commit together.
- Package names are displayed as source data; this does not create packages in netops.
- Payment history is not included. A supported ISPman API or recurring export feed must be verified before implementing automatic updates or payment imports.

## Code and validation

`lib/ispman.cjs`: parser, identity checks, isolated persistence and pagination. `dist/ispman.js`: owner overview and preview/confirmation flow. `/api/ispman`, `/api/ispman/preview`, `/api/ispman/import`: authenticated owner-only endpoints with existing CSRF enforcement.

Run `node --test test/ispman.test.cjs`, `npm run check` and `npm test`. UI was checked with synthetic records at 390px and 1366px, including selecting a local CSV, previewing a create/update pair, confirming the import and searching the new record. No live customer records are included in fixtures or source.
