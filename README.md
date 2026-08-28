# FieldNotes

A modern bug/issue tracker — an independent reinterpretation of the
problem Bugzilla solves, not a clone of its UI or codebase.

## Quick start

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

Requires Node.js 18+. Uses only pure-JavaScript dependencies (no native
modules to compile), so `npm install` works cleanly on any machine.

## How it works

1. **Enter your name** in the "Logged in as" box at the top — this is
   used to attribute reports, comments, and status changes to a
   person. There's no password login; this keeps the project focused
   on the tracking workflow itself rather than authentication.
2. **Log an issue** via "+ New Issue" — title, description, steps to
   reproduce, severity, priority, and component are captured.
3. **Work an issue** from its detail page: change status, priority,
   severity, or assignee inline — each change is automatically logged
   as an activity entry in the issue's timeline.
4. **Discuss** via comments on each issue — visible in the same
   timeline as the automatic activity log, so the full history reads
   as one continuous thread.
5. **Search and filter** the issue list by keyword, status, or
   priority.
6. **Duplicate detection**: as you type a title in the new-issue form,
   the app checks it against titles of other open issues (word-overlap
   similarity) and warns you with links if something close already
   exists.
7. **Analytics**: a lightweight dashboard (`/analytics`, linked from
   the top of the page) shows issue counts by status, priority, and
   component as simple bar charts.
8. **@mentions**: typing `@name` in a comment renders it as a
   highlighted mention, making it easy to flag who a comment is
   addressed to.

## Data model

Each issue has: `id`, `title`, `description`, `stepsToReproduce`,
`severity` (Trivial/Minor/Major/Critical/Blocker), `priority`
(Low/Medium/High/Critical), `status` (New/In Progress/Resolved/Closed/
Reopened), `component`, `assignee`, `reporter`, timestamps, and a
`comments` array mixing user comments and system-generated activity
entries (status changes, reassignments, etc.) in chronological order.

## Why this design (for the write-up)

- **Status workflow with an audit trail**: every status/priority/
  severity/assignee change writes an activity entry automatically, so
  an issue's full history is reconstructable without a separate
  "history" feature — it's just part of the comment thread.
- **No accounts, just attribution**: real authentication is out of
  scope for what this exercise tests, so a lightweight named-attribution
  model was used instead of building a login system.
- **JSON-file storage**: avoids native dependencies (a real problem
  encountered with `better-sqlite3` on Windows in an earlier project —
  it needs a C++ build toolchain). Swapping in a real database only
  touches `loadIssues()`/`saveIssues()` in `server.js`.
- **Visual identity intentionally departs from Bugzilla's dense
  grid-of-fields UI**: a lighter "field journal" aesthetic (specimen
  tags for status/priority) keeps the same underlying capabilities
  while looking and feeling like a different, modern product.
- **Duplicate detection** goes beyond Bugzilla's basic keyword search:
  it proactively surfaces likely duplicates while you're still typing
  a new report, using Jaccard similarity over significant title words
  (stopwords and short words filtered out), scoped to open issues only.
- **Analytics dashboard** gives an at-a-glance view of issue
  distribution (status/priority/component) that Bugzilla doesn't offer
  without configuring separate reporting tools.
- **@mentions** make comment threads easier to scan for "who does this
  concern" without needing a full notification/permission system.

## Known trade-offs / out of scope

- No real authentication — attribution is self-reported by name.
- No file attachments (screenshots/logs) — could be added by storing
  uploads and referencing them from a comment.
- No email/push notifications.
- JSON-file storage isn't suited to high concurrency or large datasets
  — fine for a demo or small team, not production scale.

## Project structure

```
server.js          Express app: API + static file serving + JSON-file storage
data/issues.json   Created automatically on first run
public/index.html  List view, new-issue modal, and detail view (single page)
public/style.css   Visual design
public/app.js       Page controller (list, create, detail, comments)
```
