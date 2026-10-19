# Parity report: Next (3999) vs Nest (4455)

Generated: 2026-10-19T06:27:44.103Z

Scenarios: 31 | steps: 806 | steps differing: 68 | PASS scenarios: 14 | DIFF: 17 | CRASH: 0

| scenario | steps | differing steps | DB diff lines | dry-run jobs (next/nest) | result |
|---|---|---|---|---|---|
| health | 2 | 1 | 0 | 0/0 | DIFF |
| hello-unknown-methods | 12 | 12 | 0 | 0/0 | DIFF |
| auth-login | 13 | 0 | 0 | 0/0 | PASS |
| users | 28 | 5 | 0 | 0/0 | DIFF |
| users-zalo | 17 | 0 | 0 | 0/0 | PASS |
| channels | 22 | 4 | 0 | 0/0 | DIFF |
| receive-channels | 20 | 4 | 0 | 0/0 | DIFF |
| customers-list | 18 | 0 | 0 | 0/0 | PASS |
| customers-search | 26 | 0 | 0 | 0/0 | PASS |
| customers-write | 34 | 3 | 0 | 0/0 | DIFF |
| customers-delete | 17 | 3 | 0 | 0/0 | DIFF |
| customers-import | 11 | 0 | 0 | 0/0 | PASS |
| quotations | 33 | 7 | 0 | 0/0 | DIFF |
| quotations-items-templates | 29 | 4 | 0 | 0/0 | DIFF |
| templates-read | 21 | 1 | 0 | 0/0 | DIFF |
| templates-write | 36 | 5 | 0 | 0/0 | DIFF |
| templates-customers | 33 | 5 | 0 | 0/0 | DIFF |
| templates-image | 26 | 2 | 0 | 0/0 | DIFF |
| delete-guards-pending-jobs | 9 | 0 | 0 | 0/0 | PASS |
| readonly-lists | 10 | 0 | 0 | 0/0 | PASS |
| webhook-whatsapp-verify | 8 | 0 | 0 | 0/0 | PASS |
| webhook-whatsapp-events | 45 | 0 | 0 | 0/0 | PASS |
| webhook-whatsapp-autoreply | 11 | 0 | 0 | 0/0 | PASS |
| webhook-zalo | 40 | 0 | 0 | 0/0 | PASS |
| zalo-admin-no-token | 22 | 4 | 0 | 0/0 | DIFF |
| zalo-admin-expired-token | 9 | 0 | 0 | 0/0 | PASS |
| zalo-oauth-with-pkce | 9 | 2 | 0 | 0/0 | DIFF |
| cron-zalo-token-with-expired-token | 4 | 0 | 0 | 0/0 | PASS |
| body-parsing-edges | 187 | 4 | 0 | 0/0 | DIFF |
| send-flow | 40 | 2 | 0 | 9/9 | DIFF |
| cron-and-process | 14 | 0 | 0 | 1/1 | PASS |

## DIFF: health

- **HEAD health**
  - `.media`: next="" | nest="application/json"

## DIFF: hello-unknown-methods

- **GET hello**
  - `.body.error`: next="<absent>" | nest="Cannot GET /api/hello"
  - `.body.message`: next="Xin chào từ backend Next.js!" | nest="<absent>"
  - `.body.time`: next="<TS>" | nest="<absent>"
  - `.status`: next=200 | nest=404
- **POST hello**
  - `.body.error`: next="<absent>" | nest="Cannot POST /api/hello"
  - `.body.ok`: next=true | nest="<absent>"
  - `.body.received`: next={"a":1,"b":"x"} | nest="<absent>"
  - `.status`: next=200 | nest=404
- **GET unknown route**
  - `.body`: next="<!DOCTYPE html><html lang=\"vi\" class=\"be_vietnam_pro_6d0bb1e6-module__kESjeG__variable h-full antialiased\"><head><meta charSet=\"utf-8\"/><meta name=\"view… | nest={"error":"Cannot GET /api/does-not-exist"}
  - `.headers.cache-control`: next="private, no-cache, no-store, max-age=0, must-revalidate" | nest="<absent>"
  - `.media`: next="text/html" | nest="application/json"
- **POST unknown route**
  - `.body`: next="<!DOCTYPE html><html lang=\"vi\" class=\"be_vietnam_pro_6d0bb1e6-module__kESjeG__variable h-full antialiased\"><head><meta charSet=\"utf-8\"/><meta name=\"view… | nest={"error":"Cannot POST /api/does-not-exist"}
  - `.headers.cache-control`: next="private, no-cache, no-store, max-age=0, must-revalidate" | nest="<absent>"
  - `.media`: next="text/html" | nest="application/json"
- **DELETE health (method mismatch)**
  - `.body`: next="" | nest={"error":"Cannot DELETE /api/health"}
  - `.media`: next="" | nest="application/json"
  - `.status`: next=405 | nest=404
- **POST dashboard (method mismatch)**
  - `.body`: next="" | nest={"error":"Cannot POST /api/dashboard"}
  - `.media`: next="" | nest="application/json"
  - `.status`: next=405 | nest=404
- **PUT customers/markets (method mismatch)**
  - `.body`: next="" | nest={"error":"Cannot PUT /api/customers/markets"}
  - `.media`: next="" | nest="application/json"
  - `.status`: next=405 | nest=404
- **DELETE quotations list (method mismatch)**
  - `.body`: next="" | nest={"error":"Cannot DELETE /api/quotations"}
  - `.media`: next="" | nest="application/json"
  - `.status`: next=405 | nest=404
- **GET users/1 (no GET handler)**
  - `.body`: next="" | nest={"error":"Cannot GET /api/users/1"}
  - `.media`: next="" | nest="application/json"
  - `.status`: next=405 | nest=404
- **GET send/preview (no GET handler)**
  - `.body`: next="" | nest={"error":"Cannot GET /api/send/preview"}
  - `.media`: next="" | nest="application/json"
  - `.status`: next=405 | nest=404
- **GET send/process (no GET handler)**
  - `.body`: next="" | nest={"error":"Cannot GET /api/send/process"}
  - `.media`: next="" | nest="application/json"
  - `.status`: next=405 | nest=404
- **OPTIONS customers**
  - `.body`: next="" | nest={"error":"Cannot OPTIONS /api/customers"}
  - `.media`: next="" | nest="application/json"
  - `.status`: next=204 | nest=404

## DIFF: users

- **create duplicate username**
  - `.body.error`: next="\nInvalid `prisma.user.create()` invocation:\n\n\nUnique constraint failed on the fields: (`username`)" | nest="Invalid <prisma-call> invocation: Unique constraint failed on the fields: (`username`)"
- **create duplicate email**
  - `.body.error`: next="\nInvalid `prisma.user.create()` invocation:\n\n\nUnique constraint failed on the fields: (`email`)" | nest="Invalid <prisma-call> invocation: Unique constraint failed on the fields: (`email`)"
- **patch duplicate username**
  - `.body.error`: next="\nInvalid `prisma.user.update()` invocation:\n\n\nUnique constraint failed on the fields: (`username`)" | nest="Invalid <prisma-call> invocation: Unique constraint failed on the fields: (`username`)"
- **patch unknown id**
  - `.body.error`: next="\nInvalid `prisma.user.update()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No record was… | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for an up…
- **delete unknown**
  - `.body.error`: next="\nInvalid `prisma.user.delete()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No record was… | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for a del…

## DIFF: channels

- **create duplicate (type,account)**
  - `.body.error`: next="\nInvalid `prisma.channel.create()` invocation:\n\n\nUnique constraint failed on the fields: (`type`, `account_id`)" | nest="Invalid <prisma-call> invocation: Unique constraint failed on the fields: (`type`, `account_id`)"
- **patch duplicate account**
  - `.body.error`: next="\nInvalid `prisma.channel.update()` invocation:\n\n\nUnique constraint failed on the fields: (`type`, `account_id`)" | nest="Invalid <prisma-call> invocation: Unique constraint failed on the fields: (`type`, `account_id`)"
- **patch unknown**
  - `.body.error`: next="\nInvalid `prisma.channel.update()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No record … | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for an up…
- **delete unknown**
  - `.body.error`: next="\nInvalid `prisma.channel.delete()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No record … | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for a del…

## DIFF: receive-channels

- **create duplicate**
  - `.body.error`: next="\nInvalid `prisma.receiveChannel.create()` invocation:\n\n\nUnique constraint failed on the fields: (`type`, `account_id`)" | nest="Invalid <prisma-call> invocation: Unique constraint failed on the fields: (`type`, `account_id`)"
- **patch duplicate**
  - `.body.error`: next="\nInvalid `prisma.receiveChannel.update()` invocation:\n\n\nUnique constraint failed on the fields: (`type`, `account_id`)" | nest="Invalid <prisma-call> invocation: Unique constraint failed on the fields: (`type`, `account_id`)"
- **patch unknown**
  - `.body.error`: next="\nInvalid `prisma.receiveChannel.update()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No … | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for an up…
- **delete unknown**
  - `.body.error`: next="\nInvalid `prisma.receiveChannel.delete()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No … | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for a del…

## DIFF: customers-write

- **create unknown template id**
  - `.body.error`: next="\nInvalid `prisma.customer.create()` invocation:\n\n\nForeign key constraint violated on the constraint: `template_customers_template_id_fkey`" | nest="Invalid <prisma-call> invocation: Foreign key constraint violated on the constraint: `template_customers_template_id_fkey`"
- **patch via POST? (no)**
  - `.body`: next="" | nest={"error":"Cannot POST /api/customers/1"}
  - `.media`: next="" | nest="application/json"
  - `.status`: next=405 | nest=404
- **patch unknown id**
  - `.body.error`: next="\nInvalid `prisma.customer.update()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No record… | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for an up…

## DIFF: customers-delete

- **delete unknown**
  - `.body.error`: next="\nInvalid `prisma.customer.delete()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No record… | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for a del…
- **delete customer 40 (has audit log FK)**
  - `.body.error`: next="\nInvalid `prisma.customer.delete()` invocation:\n\n\nDatabase error. Code: `23001`. Message: `update or delete on table \"customers\" violates RESTRICT settin… | nest="Invalid <prisma-call> invocation: Database error. Code: `23001`. Message: `update or delete on table \"customers\" violates RESTRICT setting of foreign key con…
- **bulk with audit-log customer (rollback)**
  - `.body.error`: next="\nInvalid `prisma.customer.deleteMany()` invocation:\n\n\nDatabase error. Code: `23001`. Message: `update or delete on table \"customers\" violates RESTRICT se… | nest="Invalid <prisma-call> invocation: Database error. Code: `23001`. Message: `update or delete on table \"customers\" violates RESTRICT setting of foreign key con…

## DIFF: quotations

- **create duplicate code**
  - `.body.error`: next="\nInvalid `prisma.quotation.create()` invocation:\n\n\nUnique constraint failed on the fields: (`code`)" | nest="Invalid <prisma-call> invocation: Unique constraint failed on the fields: (`code`)"
- **create invalid date**
  - `.body.error`: next="\nInvalid `prisma.quotation.create()` invocation:\n\n{\n  data: {\n    code: \"BG-X-4\",\n    title: null,\n    totalAmount: \"0\",\n    currency: \"VND\",\n  … | nest="Invalid <prisma-call> invocation: Invalid value for argument `validUntil`: Provided Date object is invalid. Expected Date."
- **detail non-numeric**
  - `.body`: next="" | nest={"error":"Cannot convert abc to a BigInt"}
  - `.media`: next="" | nest="application/json"
- **patch code duplicate**
  - `.body.error`: next="\nInvalid `prisma.quotation.update()` invocation:\n\n\nUnique constraint failed on the fields: (`code`)" | nest="Invalid <prisma-call> invocation: Unique constraint failed on the fields: (`code`)"
- **patch unknown**
  - `.body.error`: next="\nInvalid `prisma.quotation.update()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No recor… | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for an up…
- **patch invalid date**
  - `.body.error`: next="\nInvalid `prisma.quotation.update()` invocation:\n\n{\n  where: {\n    id: 3n\n  },\n  data: {\n    issuedDate: new Date(\"Invalid Date\")\n                ~~… | nest="Invalid <prisma-call> invocation: Invalid value for argument `issuedDate`: Provided Date object is invalid. Expected Date."
- **delete unknown**
  - `.body.error`: next="\nInvalid `prisma.quotation.delete()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No recor… | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for a del…

## DIFF: quotations-items-templates

- **items huge decimals**
  - `.body.error`: next="\nInvalid `prisma.quotation.update()` invocation:\n\n\nValue out of range for the type: numeric field overflow" | nest="Invalid <prisma-call> invocation: Value out of range for the type: numeric field overflow"
- **items on unknown quotation**
  - `.body.error`: next="\nInvalid `prisma.quotationItem.createMany()` invocation:\n\n\nForeign key constraint violated on the constraint: `quotation_items_quotation_id_fkey`" | nest="Invalid <prisma-call> invocation: Foreign key constraint violated on the constraint: `quotation_items_quotation_id_fkey`"
- **create template unknown channel**
  - `.body.error`: next="\nInvalid `prisma.template.create()` invocation:\n\n\nForeign key constraint violated on the constraint: `templates_channel_id_fkey`" | nest="Invalid <prisma-call> invocation: Foreign key constraint violated on the constraint: `templates_channel_id_fkey`"
- **create template unknown quotation**
  - `.body.error`: next="\nInvalid `prisma.template.create()` invocation:\n\n\nForeign key constraint violated on the constraint: `templates_quotation_id_fkey`" | nest="Invalid <prisma-call> invocation: Foreign key constraint violated on the constraint: `templates_quotation_id_fkey`"

## DIFF: templates-read

- **detail non-numeric**
  - `.body`: next="" | nest={"error":"Cannot convert abc to a BigInt"}
  - `.media`: next="" | nest="application/json"

## DIFF: templates-write

- **create standalone unknown channel**
  - `.body.error`: next="\nInvalid `prisma.template.create()` invocation:\n\n\nForeign key constraint violated on the constraint: `templates_channel_id_fkey`" | nest="Invalid <prisma-call> invocation: Foreign key constraint violated on the constraint: `templates_channel_id_fkey`"
- **patch quotation unknown**
  - `.body.error`: next="\nInvalid `prisma.template.update()` invocation:\n\n\nForeign key constraint violated on the constraint: `templates_quotation_id_fkey`" | nest="Invalid <prisma-call> invocation: Foreign key constraint violated on the constraint: `templates_quotation_id_fkey`"
- **patch unknown**
  - `.body.error`: next="\nInvalid `prisma.template.update()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No record… | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for an up…
- **patch autoReply unknown (tx rollback)**
  - `.body.error`: next="\nInvalid `prisma.template.update()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No record… | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for an up…
- **delete unknown**
  - `.body.error`: next="\nInvalid `prisma.template.delete()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No record… | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for a del…

## DIFF: templates-customers

- **create customer unknown template**
  - `.body.error`: next="\nInvalid `prisma.customer.create()` invocation:\n\n\nForeign key constraint violated on the constraint: `template_customers_template_id_fkey`" | nest="Invalid <prisma-call> invocation: Foreign key constraint violated on the constraint: `template_customers_template_id_fkey`"
- **link bulk unknown customer**
  - `.body.error`: next="\nInvalid `prisma.templateCustomer.createMany()` invocation:\n\n\nForeign key constraint violated on the constraint: `template_customers_customer_id_fkey`" | nest="Invalid <prisma-call> invocation: Foreign key constraint violated on the constraint: `template_customers_customer_id_fkey`"
- **link bulk unknown template**
  - `.body.error`: next="\nInvalid `prisma.templateCustomer.createMany()` invocation:\n\n\nForeign key constraint violated on the constraint: `template_customers_template_id_fkey`" | nest="Invalid <prisma-call> invocation: Foreign key constraint violated on the constraint: `template_customers_template_id_fkey`"
- **add unknown customer**
  - `.body.error`: next="\nInvalid `prisma.templateCustomer.upsert()` invocation:\n\n\nForeign key constraint violated on the constraint: `template_customers_customer_id_fkey`" | nest="Invalid <prisma-call> invocation: Foreign key constraint violated on the constraint: `template_customers_customer_id_fkey`"
- **add to unknown template**
  - `.body.error`: next="\nInvalid `prisma.templateCustomer.upsert()` invocation:\n\n\nForeign key constraint violated on the constraint: `template_customers_template_id_fkey`" | nest="Invalid <prisma-call> invocation: Foreign key constraint violated on the constraint: `template_customers_template_id_fkey`"

## DIFF: templates-image

- **GET image non-numeric**
  - `.body`: next="" | nest={"error":"Cannot convert abc to a BigInt"}
  - `.media`: next="" | nest="application/json"
- **POST png unknown template (FK)**
  - `.body.error`: next="\nInvalid `prisma.templateImage.upsert()` invocation:\n\n\nForeign key constraint violated on the constraint: `template_images_template_id_fkey`" | nest="Invalid <prisma-call> invocation: Foreign key constraint violated on the constraint: `template_images_template_id_fkey`"

## DIFF: zalo-admin-no-token

- **oauth callback no code**
  - `.body`: next="" | nest="Temporary Redirect. Redirecting to http://parity.invalid/zalo-oa?zalo=err&msg=Zalo+kh%C3%B4ng+tr%E1%BA%A3+v%E1%BB%81+code+%28admin+OA+ch%C6%B0a+b%E1%BA%A5m+%C4…
  - `.headers.location`: next="<ORIGIN>/zalo-oa?zalo=err&msg=Zalo+kh%C3%B4ng+tr%E1%BA%A3+v%E1%BB%81+code+%28admin+OA+ch%C6%B0a+b%E1%BA%A5m+%C4%90%E1%BB%93ng+%C3%BD%3F%29" | nest="http://parity.invalid/zalo-oa?zalo=err&msg=Zalo+kh%C3%B4ng+tr%E1%BA%A3+v%E1%BB%81+code+%28admin+OA+ch%C6%B0a+b%E1%BA%A5m+%C4%90%E1%BB%93ng+%C3%BD%3F%29"
  - `.media`: next="" | nest="text/plain"
- **oauth callback no code + oa_id/state**
  - `.body`: next="" | nest="Temporary Redirect. Redirecting to http://parity.invalid/zalo-oa?zalo=err&msg=Zalo+kh%C3%B4ng+tr%E1%BA%A3+v%E1%BB%81+code+%28admin+OA+ch%C6%B0a+b%E1%BA%A5m+%C4…
  - `.headers.location`: next="<ORIGIN>/zalo-oa?zalo=err&msg=Zalo+kh%C3%B4ng+tr%E1%BA%A3+v%E1%BB%81+code+%28admin+OA+ch%C6%B0a+b%E1%BA%A5m+%C4%90%E1%BB%93ng+%C3%BD%3F%29" | nest="http://parity.invalid/zalo-oa?zalo=err&msg=Zalo+kh%C3%B4ng+tr%E1%BA%A3+v%E1%BB%81+code+%28admin+OA+ch%C6%B0a+b%E1%BA%A5m+%C4%90%E1%BB%93ng+%C3%BD%3F%29"
  - `.media`: next="" | nest="text/plain"
- **oauth callback with code (no verifier)**
  - `.body`: next="" | nest="Temporary Redirect. Redirecting to http://parity.invalid/zalo-oa?zalo=err&msg=Kh%C3%B4ng+c%C3%B3+code_verifier+%E2%80%94+h%C3%A3y+b%E1%BA%A5m+%27K%E1%BA%BFt+n%…
  - `.headers.location`: next="<ORIGIN>/zalo-oa?zalo=err&msg=Kh%C3%B4ng+c%C3%B3+code_verifier+%E2%80%94+h%C3%A3y+b%E1%BA%A5m+%27K%E1%BA%BFt+n%E1%BB%91i+Zalo+OA%27+%C4%91%E1%BB%83+b%E1%BA%AFt… | nest="http://parity.invalid/zalo-oa?zalo=err&msg=Kh%C3%B4ng+c%C3%B3+code_verifier+%E2%80%94+h%C3%A3y+b%E1%BA%A5m+%27K%E1%BA%BFt+n%E1%BB%91i+Zalo+OA%27+%C4%91%E1%BB%8…
  - `.media`: next="" | nest="text/plain"
- **oauth callback code with special chars**
  - `.body`: next="" | nest="Temporary Redirect. Redirecting to http://parity.invalid/zalo-oa?zalo=err&msg=Kh%C3%B4ng+c%C3%B3+code_verifier+%E2%80%94+h%C3%A3y+b%E1%BA%A5m+%27K%E1%BA%BFt+n%…
  - `.headers.location`: next="<ORIGIN>/zalo-oa?zalo=err&msg=Kh%C3%B4ng+c%C3%B3+code_verifier+%E2%80%94+h%C3%A3y+b%E1%BA%A5m+%27K%E1%BA%BFt+n%E1%BB%91i+Zalo+OA%27+%C4%91%E1%BB%83+b%E1%BA%AFt… | nest="http://parity.invalid/zalo-oa?zalo=err&msg=Kh%C3%B4ng+c%C3%B3+code_verifier+%E2%80%94+h%C3%A3y+b%E1%BA%A5m+%27K%E1%BA%BFt+n%E1%BB%91i+Zalo+OA%27+%C4%91%E1%BB%8…
  - `.media`: next="" | nest="text/plain"

## DIFF: zalo-oauth-with-pkce

- **callback wrong state**
  - `.body`: next="" | nest="Temporary Redirect. Redirecting to http://parity.invalid/zalo-oa?zalo=err&msg=state+kh%C3%B4ng+kh%E1%BB%9Bp+%E2%80%94+callback+kh%C3%B4ng+ph%E1%BA%A3i+t%E1%BB%…
  - `.headers.location`: next="<ORIGIN>/zalo-oa?zalo=err&msg=state+kh%C3%B4ng+kh%E1%BB%9Bp+%E2%80%94+callback+kh%C3%B4ng+ph%E1%BA%A3i+t%E1%BB%AB+lu%E1%BB%93ng+c%E1%BA%A5p+quy%E1%BB%81n+v%E1%… | nest="http://parity.invalid/zalo-oa?zalo=err&msg=state+kh%C3%B4ng+kh%E1%BB%9Bp+%E2%80%94+callback+kh%C3%B4ng+ph%E1%BA%A3i+t%E1%BB%AB+lu%E1%BB%93ng+c%E1%BA%A5p+quy%E1…
  - `.media`: next="" | nest="text/plain"
- **callback good state**
  - `.body`: next="" | nest="Temporary Redirect. Redirecting to http://parity.invalid/zalo-oa?zalo=err&msg=Ch%C6%B0a+c%E1%BA%A5u+h%C3%ACnh+ZALO_APP_ID+%2F+ZALO_SECRET_KEY+trong+.env+%28l%E…
  - `.headers.location`: next="<ORIGIN>/zalo-oa?zalo=err&msg=Ch%C6%B0a+c%E1%BA%A5u+h%C3%ACnh+ZALO_APP_ID+%2F+ZALO_SECRET_KEY+trong+.env+%28l%E1%BA%A5y+%E1%BB%9F+developers.zalo.me+-%3E+C%C3%… | nest="http://parity.invalid/zalo-oa?zalo=err&msg=Ch%C6%B0a+c%E1%BA%A5u+h%C3%ACnh+ZALO_APP_ID+%2F+ZALO_SECRET_KEY+trong+.env+%28l%E1%BA%A5y+%E1%BB%9F+developers.zalo.…
  - `.media`: next="" | nest="text/plain"

## DIFF: body-parsing-edges

- **customers bulk-delete | json null**
  - `.body.error`: next="Cannot read properties of null (reading 'ids')" | nest="Chưa chọn khách nào."
- **zalo test | json null**
  - `.body.error`: next="Cannot read properties of null (reading 'userId')" | nest="Nhập user_id / SĐT người nhận."
- **zalo oauth start | json null**
  - `.body.error`: next="Cannot read properties of null (reading 'callbackUrl')" | nest="Chưa cấu hình ZALO_APP_ID / ZALO_SECRET_KEY trong .env (lấy ở developers.zalo.me -> Cài đặt)."
- **zalo oauth exchange | json null**
  - `.body.error`: next="Cannot read properties of null (reading 'url')" | nest="Thiếu code."

## DIFF: send-flow

- **cancel unknown**
  - `.body.error`: next="\nInvalid `prisma.sendBatch.update()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. No recor… | nest="Invalid <prisma-call> invocation: An operation failed because it depends on one or more records that were required but not found. No record was found for an up…
- **GET batch non-numeric**
  - `.body`: next="" | nest={"error":"Cannot convert abc to a BigInt"}
  - `.media`: next="" | nest="application/json"
