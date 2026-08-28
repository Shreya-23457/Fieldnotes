// server.js
//
// FieldNotes backend — a bug/issue tracker.
//
// STORAGE NOTE: issues live in a single JSON file (data/issues.json)
// instead of a real database, on purpose — this avoids native modules
// that need a C++ compiler to install (a problem we hit with
// better-sqlite3 in an earlier project), so `npm install` works
// cleanly on any machine with no extra tools. Swap in a real database
// later; all storage logic is isolated in loadIssues()/saveIssues().
//
// AUTH NOTE: there's no password-based login. Each request carries an
// "author" name chosen by the user (stored client-side). This is
// intentionally simple — enough to attribute reports/comments/status
// changes to a person, without the complexity of real authentication,
// which is out of scope for what this assignment is testing.

const express = require('express');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'issues.json');

const STATUSES = ['New', 'In Progress', 'Resolved', 'Closed', 'Reopened'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const SEVERITIES = ['Trivial', 'Minor', 'Major', 'Critical', 'Blocker'];

// --- tiny JSON-file "database" ---
function loadIssues() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveIssues(issues) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(issues, null, 2), 'utf8');
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function nowIso() {
  return new Date().toISOString();
}

function activityEntry(author, text) {
  return { id: nanoid(8), type: 'activity', author, text, createdAt: nowIso() };
}

// --- duplicate detection helpers ---
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'on', 'in', 'to', 'of', 'for', 'and', 'with',
  'when', 'this', 'that', 'it', 'be', 'are', 'was', 'not', 'issue', 'bug',
]);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------- Duplicate detection ----------------
// Given a draft title, find existing open issues with meaningfully
// overlapping wording, so a reporter can check before filing a
// possible duplicate. Closed/Resolved issues are excluded since a
// re-report of a fixed bug isn't really a "duplicate" concern.
app.get('/api/issues/similar', (req, res) => {
  const { title, excludeId } = req.query;
  if (!title || !title.trim()) return res.json([]);

  const draftTokens = new Set(tokenize(title));
  if (draftTokens.size === 0) return res.json([]);

  const issues = loadIssues().filter(
    (i) => i.status !== 'Closed' && i.status !== 'Resolved' && String(i.id) !== String(excludeId)
  );

  const scored = issues
    .map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      score: jaccardSimilarity(draftTokens, new Set(tokenize(i.title))),
    }))
    .filter((i) => i.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  res.json(scored);
});

// ---------------- Analytics ----------------
app.get('/api/analytics', (req, res) => {
  const issues = loadIssues();

  function countBy(key) {
    const counts = {};
    for (const i of issues) {
      const value = i[key] || 'Unspecified';
      counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
  }

  res.json({
    total: issues.length,
    byStatus: countBy('status'),
    byPriority: countBy('priority'),
    byComponent: countBy('component'),
  });
});


app.get('/api/meta', (req, res) => {
  res.json({ statuses: STATUSES, priorities: PRIORITIES, severities: SEVERITIES });
});

// ---------------- List issues (supports filtering + search) ----------------
app.get('/api/issues', (req, res) => {
  let issues = loadIssues();
  const { status, priority, assignee, q } = req.query;

  if (status) issues = issues.filter((i) => i.status === status);
  if (priority) issues = issues.filter((i) => i.priority === priority);
  if (assignee) issues = issues.filter((i) => (i.assignee || '').toLowerCase() === assignee.toLowerCase());
  if (q) {
    const needle = q.toLowerCase();
    issues = issues.filter(
      (i) =>
        i.title.toLowerCase().includes(needle) ||
        (i.description || '').toLowerCase().includes(needle) ||
        String(i.id).includes(needle)
    );
  }

  // Newest first
  issues = issues.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Don't send full comment threads in the list view — keep it light
  const summary = issues.map(({ comments, ...rest }) => ({ ...rest, commentCount: comments.length }));
  res.json(summary);
});

// ---------------- Create issue ----------------
app.post('/api/issues', (req, res) => {
  const { title, description, stepsToReproduce, severity, priority, component, assignee, reporter } = req.body || {};

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  if (!reporter || !reporter.trim()) {
    return res.status(400).json({ error: 'Reporter name is required' });
  }
  if (severity && !SEVERITIES.includes(severity)) {
    return res.status(400).json({ error: 'Invalid severity' });
  }
  if (priority && !PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority' });
  }

  const issues = loadIssues();
  const id = issues.length ? Math.max(...issues.map((i) => i.id)) + 1 : 1;
  const now = nowIso();

  const issue = {
    id,
    title: title.trim(),
    description: (description || '').trim(),
    stepsToReproduce: (stepsToReproduce || '').trim(),
    severity: severity || 'Minor',
    priority: priority || 'Medium',
    status: 'New',
    component: (component || '').trim() || 'General',
    assignee: (assignee || '').trim() || null,
    reporter: reporter.trim(),
    createdAt: now,
    updatedAt: now,
    comments: [activityEntry(reporter.trim(), 'reported this issue')],
  };

  issues.push(issue);
  saveIssues(issues);
  res.status(201).json(issue);
});

// ---------------- Get single issue (full detail incl. comments) ----------------
app.get('/api/issues/:id', (req, res) => {
  const issues = loadIssues();
  const issue = issues.find((i) => i.id === Number(req.params.id));
  if (!issue) return res.status(404).json({ error: 'Issue not found' });
  res.json(issue);
});

// ---------------- Update issue fields (status/assignee/priority/severity) ----------------
app.patch('/api/issues/:id', (req, res) => {
  const issues = loadIssues();
  const issue = issues.find((i) => i.id === Number(req.params.id));
  if (!issue) return res.status(404).json({ error: 'Issue not found' });

  const { status, assignee, priority, severity, actor } = req.body || {};
  if (!actor || !actor.trim()) {
    return res.status(400).json({ error: 'actor (your name) is required to make changes' });
  }

  const changes = [];

  if (status !== undefined && status !== issue.status) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    changes.push(`changed status from "${issue.status}" to "${status}"`);
    issue.status = status;
  }
  if (assignee !== undefined && assignee !== issue.assignee) {
    changes.push(assignee ? `assigned this to ${assignee}` : 'unassigned this issue');
    issue.assignee = assignee || null;
  }
  if (priority !== undefined && priority !== issue.priority) {
    if (!PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
    changes.push(`changed priority from "${issue.priority}" to "${priority}"`);
    issue.priority = priority;
  }
  if (severity !== undefined && severity !== issue.severity) {
    if (!SEVERITIES.includes(severity)) return res.status(400).json({ error: 'Invalid severity' });
    changes.push(`changed severity from "${issue.severity}" to "${severity}"`);
    issue.severity = severity;
  }

  if (changes.length === 0) {
    return res.status(400).json({ error: 'No changes provided' });
  }

  issue.updatedAt = nowIso();
  for (const text of changes) {
    issue.comments.push(activityEntry(actor.trim(), text));
  }

  saveIssues(issues);
  res.json(issue);
});

// ---------------- Add a comment ----------------
app.post('/api/issues/:id/comments', (req, res) => {
  const issues = loadIssues();
  const issue = issues.find((i) => i.id === Number(req.params.id));
  if (!issue) return res.status(404).json({ error: 'Issue not found' });

  const { author, text } = req.body || {};
  if (!author || !author.trim()) return res.status(400).json({ error: 'author is required' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'Comment text is required' });

  const comment = { id: nanoid(8), type: 'comment', author: author.trim(), text: text.trim(), createdAt: nowIso() };
  issue.comments.push(comment);
  issue.updatedAt = nowIso();

  saveIssues(issues);
  res.status(201).json(comment);
});

// Client-side routing: /issues/:id and /analytics load the same page;
// JS reads the path and decides what to render.
app.get('/issues/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`FieldNotes listening on http://localhost:${PORT}`);
});
