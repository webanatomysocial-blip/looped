# Recruitment module: deploy notes

## Private file storage (required)
Resumes and interview recordings are stored outside the public `/uploads` folder, in
`RECRUITMENT_STORAGE_DIR` (default: `backend/private/recruitment`). They are never served
statically; only admins and managers can open them, through signed links that expire after 10 minutes.

In Docker, files inside the container are lost on rebuild. Mount a server folder:

```yaml
# docker compose, under the loooped_app service
    environment:
      - RECRUITMENT_STORAGE_DIR=/app/private/recruitment
    volumes:
      - /opt/apps/loooped/private:/app/private
```

Create it once on the server: `sudo mkdir -p /opt/apps/loooped/private && sudo chmod 700 /opt/apps/loooped/private`
(the user the container runs as must be able to write to it). Back this folder up together with the database.

Size: about 5 MB per minute of interview (≈25–50 MB per interview). Recordings are deleted after the
retention period set in Recruitment → Settings (default 180 days).

## Settings (environment)
- `PUBLIC_APP_URL`: the site address used in candidate emails (default `https://looped.in`).
- `RECRUITMENT_EMAILS=off`: turns candidate emails off. Emails also need the existing `GMAIL_USER`.
  Candidates are emailed only for good news: interview invitation, final interview schedule / changes, selection.
  Rejections appear only on their tracking page.

## Pages
- Public: `/careers` (jobs), `/careers/:id` (apply), `/careers/track/:token` (status), `/careers/interview/:token`.
- Internal: `/recruitment` (every admin and manager).

## Database
New tables, created at startup: `rec_jobs`, `rec_applications`, `rec_history`, `rec_questions`, `rec_settings`,
`rec_interviews`, `rec_interview_questions`, `rec_events`, `rec_evaluations`, `rec_schedules`. Departments reuse
`employee_categories`. No existing table is changed.
