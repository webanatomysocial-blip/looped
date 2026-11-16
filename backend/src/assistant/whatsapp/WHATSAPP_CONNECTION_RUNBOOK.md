# WhatsApp: controlled connection runbook

**Nothing in this document connects a number. Each step below is yours to perform, after you authorise the connection.**

## A. Decisions before connecting

1. **Library choice.** The current adapter uses Baileys, an unofficial WhatsApp Web client (pinned 6.7.24). WhatsApp can restrict accounts that automate messages. For a controlled pilot on a dedicated company number, that is a risk you must accept in writing. For production, the official WhatsApp Business Cloud API is the supported route.
2. **Dedicated number.** A company-controlled number only. Not a personal number.
3. **Employee links.** Confirm which phone numbers may be linked, and who approves each link.

## B. Pre-connection checks (status as of this step)

| Check | Status | Evidence |
|---|---|---|
| WhatsApp is off unless enabled | Verified | Default-settings startup: no WhatsApp output; configuration tests |
| Session folder outside the repository | Verified by code and tests | Refused inside the project; configuration tests |
| Session folder and files owner-only | Verified by test | Folder 700, files 600 after every save |
| QR (pairing code) never logged | Verified by test | Fake connection: not in the adapter log, the console, or the status |
| Session credentials never in API responses | Verified by test | Status keys are fixed: no paths, no code, no credentials |
| Real pairing and session persistence | **Not verified** | Requires your authorisation and a real number |

### Dependency advisories (production dependencies, read-only review)
| Severity | Package | Reach in this app | On the WhatsApp path? | Recommended action |
|---|---|---|---|---|
| Critical | proxy-addr (via express) | IP handling. Only matters if the app trusts a proxy's forwarded address; this app does not set that. | No | Targeted upgrade of express and proxy-addr, with tests, in a separate step |
| High | body-parser (via express) | Parsing of JSON requests | No | Same targeted upgrade |
| High | multer | File uploads (contact forms, messages, users) | No | Upgrade multer with upload tests |
| High | nodemailer | Email. Attachments are files the server saved itself (contact forms), not user-chosen paths. | No | Upgrade nodemailer with email tests |
| Fixed | @whiskeysockets/baileys 6.17.16 | Not used. Pinned to 6.7.24, which is outside the advisory. | Yes (fixed) | None |

None of these is changed in this step. Each upgrade changes core web behaviour, so each needs its own tests. Ask for that step when you are ready.

## C. Procedure (run by you)

1. **Create private folders outside the project**, with owner-only access:
   `mkdir -p ~/loop-private/whatsapp-session && chmod 700 ~/loop-private/whatsapp-session`
   The pairing code file is created automatically with owner-only access.
2. **Start an isolated test instance** (separate port, separate test database, outside the production data):
   ```
   NODE_ENV=development PORT=4050 SQLITE_FILE=~/loop-private/whatsapp-test.db JWT_SECRET=<a new random value> \
   ASSISTANT_ENABLED=true ASSISTANT_AI_PROVIDER=openai OPENAI_API_KEY=<your key> ASSISTANT_OPENAI_MODEL=gpt-5.4-nano \
   ASSISTANT_TIMEZONE=Asia/Kolkata ASSISTANT_EXECUTION_ENABLED=false \
   ASSISTANT_WHATSAPP_ENABLED=true ASSISTANT_WHATSAPP_SESSION_DIR=~/loop-private/whatsapp-session \
   ASSISTANT_WHATSAPP_QR_FILE=~/loop-private/whatsapp-qr.txt node dist/server.js
   ```
   Keep `ASSISTANT_EXECUTION_ENABLED=false` for the first connection. Use a test database, never the one used by the live application.
3. **Pair the company number.** The log says a pairing code is ready. Read the file `~/loop-private/whatsapp-qr.txt` on your own machine and render it as a QR code (for example with `qrencode`, if installed). **Do not paste the code into chat, a ticket or any shared place.** On the company phone: WhatsApp → Linked devices → Link a device → scan the code. The code expires quickly; if it does, the adapter writes a fresh one.
4. **Confirm the connection.** The log shows "WhatsApp connected". Check the status with an admin token:
   `curl -H "Authorization: Bearer <admin token>" http://localhost:4050/api/assistant-admin/whatsapp`
   Expected: `state` is `connected`, the account is masked (for example `+91 •••• 1234`), and there is no path, code or credential.
5. **Confirm session persistence.** Stop the server (Ctrl+C) and start it again with the same command. The log shows "WhatsApp connected" **without** a pairing code.
6. **Private-chat tests** (send from the approved employee phones, to the company number):
   - Create: "create a ticket called Test A for <colleague> in <project>, no deadline" → expect a confirmation request. Reply "CONFIRM <code>" → expect "Confirmed". Run the worker or enable execution in the isolated instance to see the ticket. Expect the ticket on the website.
   - Unlinked phone sends a message → expect "I can't act on this yet: your account isn't linked to Loop."
   - Revoke an employee link in the admin Identities tab → that employee's next message is refused.
   - Two employees send at the same time → each gets their own reply.
   - Send the same message twice → one reply.
7. **Reconnection test.** Turn the computer's network off for about a minute, then on. Expect "reconnecting" and then "connected" without a new code.
8. **Stop and unpair.** Stop the server. To unpair fully, on the company phone remove the linked device, and delete the session folder contents.

## D. Group testing (not connected)

Groups are not connected. The policy is implemented and tested: silent unless the company account is mentioned, one generic reply per group per minute, no ticket changes, no identity or ticket details in group replies. Do not add the account to a real group until you authorise it.

## E. What I need from you to proceed

1. Your written decision on Baileys for this pilot, or a switch to the official Cloud API.
2. The company number, and the name of the person who will scan the code.
3. Confirmation that the private folders in section C exist and are owner-only.
4. The two approved employee phone numbers and their Loop accounts, for the private-chat test.
5. Your go-ahead to start step C.2.
