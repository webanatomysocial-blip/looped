# WhatsApp channel (Baileys): setup and limits

Status: **implemented and tested with a fake connection. Not connected to any real WhatsApp account.** Off by default.

## Architecture
- `adapter.ts`: the connection (pairing, reconnection, incoming and outgoing text, status, shutdown). Turns a WhatsApp message into the assistant's message format. Never uses a display name as identity.
- `baileys.ts`: the only file that loads the library (`@whiskeysockets/baileys`, pinned to 6.7.24). Session files are kept owner-only.
- `handler.ts`: private chats go through the existing assistant pipeline (identity, duplicate check, engine, confirmation, queue, executor, ticket services). Group chats get the fixed generic reply and nothing else.
- `runtime.ts`: starts one adapter, keeps it for status reads, stops it on SIGTERM/SIGINT.
- `config.ts`: settings and their checks.
- The simulator channel is unchanged.

## Settings (environment)
| Variable | Default | Meaning |
|---|---|---|
| `ASSISTANT_WHATSAPP_ENABLED` | `false` | Turns the WhatsApp channel on. Needs the assistant on too. |
| `ASSISTANT_WHATSAPP_SESSION_DIR` | none | Absolute path, **outside the project folder**, where WhatsApp session credentials are kept (owner-only). Required when enabled. |
| `ASSISTANT_WHATSAPP_QR_FILE` | none | Absolute path, outside the project, where the pairing code is written (owner-only) while pairing. Optional. |

Keep `ASSISTANT_EXECUTION_ENABLED=false` in production until the pilot is approved.

## Pairing (once per company number)
1. Set the three settings above, and start the server with the assistant and WhatsApp enabled.
2. The adapter writes a pairing code to the QR file. The code is never logged and never shown in the admin page.
3. Render the code as a QR code on a trusted machine, and scan it with the **company** WhatsApp account (Linked devices).
4. Once paired, the session credentials are saved in the session folder. A restart reuses them and does not ask again.
If the phone ends the session, the adapter stops and reports "logged out". Pairing is then needed again. It does not retry automatically.

## Identity and permissions
- A sender is identified by the phone number on the verified assistant link (status must be active). Display names are ignored.
- Revoked, deleted, unlinked and client senders are refused with the same plain reply, and nothing is saved.
- The identity is checked again before any action runs. Loop's existing permission rules still apply.
- Internal WhatsApp ids (`@lid`) are never matched to phone numbers. They are refused.

## Group chats
- Group messages receive only the fixed generic reply. Nothing is read, saved, or changed, and no identity is checked.
- Every group message gets that reply. In a busy group this is noisy, and it is a decision for you (see limits).

## Limits and risks (read before connecting a real number)
- **Unofficial library.** Baileys is a community reimplementation of WhatsApp Web. It is not an official WhatsApp API. Accounts that automate messages can be restricted or banned by WhatsApp, and the library can break when WhatsApp changes its protocol. For a production business channel, the official WhatsApp Business Platform (Cloud API) is the supported route. That needs a business account and message-template approval.
- Text messages only. Media, voice, reactions and edits are ignored.
- The message history is not synced; only new incoming messages are handled.
- The library version is pinned to 6.7.24, which is outside the advisory that affects 6.17.16 (see the dependency audit). Other advisories in the wider project predate this change and are not fixed here.
- Session files hold keys. Keep the session folder on a protected disk, back it up securely, and never commit it.
- One company account only. Multiple accounts are not supported.
- A group receives the generic reply to every message. A rate limit or a mention-only rule would reduce noise; neither is implemented.

## What is needed to connect the company number
1. Approval to use an unofficial library on the company account, or a decision to use the official Cloud API instead.
2. A company WhatsApp number (not a personal one), and its owner available to scan the pairing code.
3. A protected location for the session folder and the QR file, outside the project.
4. Confirmation of the employee phone numbers to link, and who will approve each link.
5. For group testing: the group name and the members who will take part, and approval to add the company account to it.
