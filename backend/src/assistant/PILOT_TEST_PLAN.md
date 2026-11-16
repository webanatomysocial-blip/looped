# Controlled pilot test plan

Scope: a small internal group of employees and managers, in a pilot environment, with execution switched on only for the pilot. No live invitations until this plan is approved.

Each test lists the **steps**, the **expected result**, and what an **admin should watch** in the Control Centre.

## Setup (before any test)

1. Pilot database, not production. Users, pods, projects and memberships are copied for the pilot group only.
2. Admin account set up with a fresh credential (see the password decision in PRODUCTION_READINESS.md).
3. Execution switch decided and documented. Starting with `ASSISTANT_EXECUTION_ENABLED=false` lets the team rehearse without changes.

## 1. Employee identity linking

- **Steps:** an administrator creates an active simulator link for an employee.
- **Expected:** the employee's messages are accepted. Their name and role appear in Identities; no ID or phone number is shown.
- **Admin watches:** Identities shows the new link as active; the audit trail records the link.

## 2. Ticket creation

- **Steps:** employee: "create a ticket called Pilot A for <colleague> in <project>, no deadline"; then confirm.
- **Expected:** the ticket appears on the website for the assignee, with the right project, priority and assignee.
- **Admin watches:** request reaches Completed; the ticket's audit row exists with a single create entry.

## 3. Clarification and confirmation

- **Steps:** employee sends "create a ticket called Pilot B" with no project or assignee. Answers each question in turn, then confirms.
- **Expected:** one question at a time, in the order project, assignee, deadline. Nothing is created until the confirmation code is sent.
- **Admin watches:** request moves Needs clarification → Ready → Confirmed → Completed.

## 4. Assignment and reassignment

- **Steps:** (a) reassign within the same pod; (b) reassign to a person in another pod.
- **Expected:** (a) applies immediately. (b) is held for the other pod's manager; the assignee shown on the website is unchanged until approval.
- **Admin watches:** (a) Completed. (b) request Completed, and the ticket shows as waiting for approval.

## 5. Priority and permitted details

- **Steps:** change priority; change title, description and due date.
- **Expected:** each change persists and shows on the website. Changing priority and details in one request is refused, and asks for separate requests.
- **Admin watches:** Completed requests; the audit trail shows the before and after values.

## 6. Comments and acceptance

- **Steps:** an employee adds a comment on a ticket they can see; the assignee accepts their own assignment; someone not assigned tries to accept.
- **Expected:** the comment appears on the ticket. The assignee's acceptance is recorded. The other person is refused without any detail shown.
- **Admin watches:** Completed for the first two; Failed (terminal) with a plain reason for the refused one.

## 7. Manager approval and rejection

- **Steps:** an employee raises a ticket that needs approval; the manager approves one and rejects another with a note.
- **Expected:** approved: the ticket goes live. Rejected: the ticket returns to the employee as a Draft, with the note visible to both.
- **Admin watches:** Completed for each decision; the employee's Draft shows the rejection note.

## 8. Cross-pod approval

- **Steps:** a request needs approval from two pods. Each pod's manager approves in turn. Then a separate request is rejected by one pod.
- **Expected:** nothing changes until every required pod approves. Only the waiting pod's managers can decide. A rejection by any pod stops the change and restores the ticket.
- **Admin watches:** the ticket stays on hold between approvals; the change is applied once; a rejection shows as Completed with the outcome.

## 9. Ticket search and viewing

- **Steps:** an employee searches for a ticket they are on, and one they are not on; a manager searches the pod's tickets.
- **Expected:** each person sees only tickets they are allowed to see. The answer for a ticket they cannot see is the same as for a ticket that does not exist.
- **Admin watches:** search requests produce no request record (read only).

## 10. Cancellation and expiry

- **Steps:** (a) cancel a request with `CANCEL <code>`; (b) leave a clarification unanswered until it expires; (c) confirm a request and let it sit past the queue expiry.
- **Expected:** none of the three is ever executed. Each ends as Cancelled or Expired.
- **Admin watches:** Cancelled and Expired statuses; no ticket change in the audit trail.

## 11. Duplicate messages and retry recovery

- **Steps:** (a) send the same message twice with the same message ID; (b) confirm the same code twice; (c) simulate a worker stopping after a change was saved, then recover the request.
- **Expected:** (a) one request. (b) the change happens once. (c) the recovered request reports "already done"; no second ticket, audit row or time log.
- **Admin watches:** a single request per message; a single audit row per change; retry shows as Completed with no new ticket.

## 12. Revoked employee access

- **Steps:** an administrator revokes an employee's link; the employee sends a message and tries to confirm a request that was already waiting.
- **Expected:** the new message is refused at intake with the plain reply. A request confirmed before revocation is refused by the executor and changes nothing.
- **Admin watches:** the link shows as Revoked; the revocation is in the administrative audit; the request ends Failed with a plain reason.

## 13. Group privacy and generic replies

- **Steps:** an employee sends a ticket change and a search from a group chat.
- **Expected:** the group gets only the fixed reply. Nothing is created, changed or looked up, and no ticket detail appears.
- **Admin watches:** no request record from the group chat.

## 14. Conversation isolation

- **Steps:** two employees each have a conversation. A third employee, and each employee directly, try to open the other's conversation through the API and the admin page.
- **Expected:** employees get 403 on every admin route. An administrator sees each conversation separately, and changing an identifier shows no one else's messages.
- **Admin watches:** the Conversations tab lists each conversation separately; each conversation shows only its own turns.

## Exit criteria

All tests pass in the pilot environment, with no unexplained Failed request, no duplicate ticket or audit row, no leaked identifier or phone number, and no console or network error. The admin confirms each test in the audit trail.
