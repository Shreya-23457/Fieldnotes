// app.js — FieldNotes frontend controller.

(function () {
  const STORAGE_KEY = 'fieldnotes_username';
  let META = { statuses: [], priorities: [], severities: [] };

  const userNameInput = document.getElementById('userNameInput');
  userNameInput.value = localStorage.getItem(STORAGE_KEY) || '';
  userNameInput.addEventListener('change', () => {
    localStorage.setItem(STORAGE_KEY, userNameInput.value.trim());
  });

  function currentUser() {
    return userNameInput.value.trim();
  }

  function requireUser() {
    const name = currentUser();
    if (!name) {
      alert('Please enter your name in the "Logged in as" box at the top first.');
      userNameInput.focus();
      return null;
    }
    return name;
  }

  function slug(s) {
    return s.replace(/\s+/g, '-');
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  async function fetchMeta() {
    const res = await fetch('/api/meta');
    META = await res.json();
    populateSelect(document.getElementById('filterStatus'), META.statuses, true);
    populateSelect(document.getElementById('filterPriority'), META.priorities, true);
    populateSelect(document.getElementById('newSeverity'), META.severities, false, 'Minor');
    populateSelect(document.getElementById('newPriority'), META.priorities, false, 'Medium');
  }

  function populateSelect(selectEl, options, keepFirst, defaultValue) {
    const existingFirst = keepFirst ? selectEl.firstElementChild : null;
    selectEl.innerHTML = '';
    if (existingFirst) selectEl.appendChild(existingFirst);
    for (const opt of options) {
      const el = document.createElement('option');
      el.value = opt;
      el.textContent = opt;
      if (defaultValue && opt === defaultValue) el.selected = true;
      selectEl.appendChild(el);
    }
  }

  // ===================== ROUTING =====================

  const detailMatch = window.location.pathname.match(/^\/issues\/(\d+)$/);
  const isAnalyticsPage = window.location.pathname === '/analytics';

  fetchMeta().then(() => {
    if (detailMatch) {
      initDetailView(Number(detailMatch[1]));
    } else if (isAnalyticsPage) {
      initAnalyticsView();
    } else {
      initListView();
    }
  });

  // ===================== LIST VIEW =====================

  function initListView() {
    document.getElementById('listView').classList.remove('hidden');

    const searchInput = document.getElementById('searchInput');
    const filterStatus = document.getElementById('filterStatus');
    const filterPriority = document.getElementById('filterPriority');
    const issueList = document.getElementById('issueList');
    const emptyState = document.getElementById('emptyState');

    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadIssues, 250);
    });
    filterStatus.addEventListener('change', loadIssues);
    filterPriority.addEventListener('change', loadIssues);

    async function loadIssues() {
      const params = new URLSearchParams();
      if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
      if (filterStatus.value) params.set('status', filterStatus.value);
      if (filterPriority.value) params.set('priority', filterPriority.value);

      const res = await fetch(`/api/issues?${params.toString()}`);
      const issues = await res.json();

      issueList.innerHTML = '';
      emptyState.classList.toggle('hidden', issues.length > 0);

      for (const issue of issues) {
        const row = document.createElement('a');
        row.href = `/issues/${issue.id}`;
        row.className = 'issue-row';
        row.innerHTML = `
          <span class="id-badge">#${issue.id}</span>
          <div class="issue-row-main">
            <p class="issue-row-title">${escapeHtml(issue.title)}</p>
            <p class="issue-row-sub">${escapeHtml(issue.component)} · reported by ${escapeHtml(issue.reporter)} · ${formatTime(issue.createdAt)}${issue.assignee ? ' · assigned to ' + escapeHtml(issue.assignee) : ''}</p>
          </div>
          <div class="tag-row">
            <span class="tag tag-priority-${slug(issue.priority)}">${issue.priority}</span>
            <span class="tag tag-status-${slug(issue.status)}">${issue.status}</span>
          </div>
        `;
        issueList.appendChild(row);
      }
    }

    loadIssues();

    // ---- New issue modal ----
    const modal = document.getElementById('newIssueModal');
    document.getElementById('newIssueButton').addEventListener('click', () => {
      if (!requireUser()) return;
      modal.classList.remove('hidden');
    });
    document.getElementById('closeNewIssue').addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });

    // ---- Live duplicate detection ----
    const newTitleInput = document.getElementById('newTitle');
    const duplicateWarning = document.getElementById('duplicateWarning');
    let dupDebounce;
    newTitleInput.addEventListener('input', () => {
      clearTimeout(dupDebounce);
      const title = newTitleInput.value.trim();
      if (title.length < 5) {
        duplicateWarning.classList.add('hidden');
        return;
      }
      dupDebounce = setTimeout(async () => {
        const res = await fetch(`/api/issues/similar?title=${encodeURIComponent(title)}`);
        const matches = await res.json();
        if (matches.length === 0) {
          duplicateWarning.classList.add('hidden');
          return;
        }
        duplicateWarning.innerHTML =
          '<p class="duplicate-warning-title">This might already be reported:</p>' +
          matches
            .map((m) => `<a href="/issues/${m.id}" target="_blank">#${m.id} ${escapeHtml(m.title)} · ${m.status}</a>`)
            .join('');
        duplicateWarning.classList.remove('hidden');
      }, 300);
    });

    document.getElementById('submitNewIssue').addEventListener('click', async () => {
      const errorEl = document.getElementById('newIssueError');
      errorEl.classList.add('hidden');

      const title = document.getElementById('newTitle').value.trim();
      if (!title) {
        errorEl.textContent = 'Title is required.';
        errorEl.classList.remove('hidden');
        return;
      }

      const body = {
        title,
        description: document.getElementById('newDescription').value,
        stepsToReproduce: document.getElementById('newSteps').value,
        severity: document.getElementById('newSeverity').value,
        priority: document.getElementById('newPriority').value,
        component: document.getElementById('newComponent').value,
        assignee: document.getElementById('newAssignee').value,
        reporter: currentUser(),
      };

      try {
        const res = await fetch('/api/issues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Could not create issue.');
        }
        const issue = await res.json();
        window.location.href = `/issues/${issue.id}`;
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    });
  }

  // ===================== DETAIL VIEW =====================

  async function initDetailView(id) {
    document.getElementById('detailView').classList.remove('hidden');

    const loadingEl = document.getElementById('detailLoading');
    const errorEl = document.getElementById('detailError');
    const contentEl = document.getElementById('detailContent');

    let issue;
    try {
      const res = await fetch(`/api/issues/${id}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Issue not found.');
      }
      issue = await res.json();
    } catch (err) {
      loadingEl.classList.add('hidden');
      errorEl.classList.remove('hidden');
      errorEl.querySelector('p').textContent = err.message;
      return;
    }

    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    document.getElementById('detailIdBadge').textContent = `#${issue.id}`;
    document.getElementById('detailTitle').textContent = issue.title;
    document.getElementById('detailDescription').textContent = issue.description || '(no description provided)';
    document.getElementById('detailReporter').textContent = issue.reporter;

    const stepsBlock = document.getElementById('detailStepsBlock');
    if (issue.stepsToReproduce) {
      document.getElementById('detailSteps').textContent = issue.stepsToReproduce;
    } else {
      stepsBlock.classList.add('hidden');
    }

    const statusSelect = document.getElementById('detailStatus');
    const prioritySelect = document.getElementById('detailPriority');
    const severitySelect = document.getElementById('detailSeverity');
    const assigneeInput = document.getElementById('detailAssignee');

    populateSelect(statusSelect, META.statuses, false, issue.status);
    populateSelect(prioritySelect, META.priorities, false, issue.priority);
    populateSelect(severitySelect, META.severities, false, issue.severity);
    assigneeInput.value = issue.assignee || '';

    async function patchIssue(fields) {
      const actor = requireUser();
      if (!actor) return false;
      const res = await fetch(`/api/issues/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, actor }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Update failed.');
        return false;
      }
      issue = await res.json();
      renderComments(issue.comments);
      return true;
    }

    statusSelect.addEventListener('change', () => patchIssue({ status: statusSelect.value }));
    prioritySelect.addEventListener('change', () => patchIssue({ priority: prioritySelect.value }));
    severitySelect.addEventListener('change', () => patchIssue({ severity: severitySelect.value }));
    assigneeInput.addEventListener('change', () => patchIssue({ assignee: assigneeInput.value.trim() }));

    renderComments(issue.comments);

    document.getElementById('submitComment').addEventListener('click', async () => {
      const author = requireUser();
      if (!author) return;
      const textEl = document.getElementById('newCommentText');
      const text = textEl.value.trim();
      if (!text) return;

      const res = await fetch(`/api/issues/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, text }),
      });
      if (!res.ok) {
        alert('Could not post comment.');
        return;
      }
      const comment = await res.json();
      issue.comments.push(comment);
      renderComments(issue.comments);
      textEl.value = '';
    });
  }

  // ===================== ANALYTICS VIEW =====================

  async function initAnalyticsView() {
    document.getElementById('analyticsView').classList.remove('hidden');

    const res = await fetch('/api/analytics');
    const data = await res.json();

    document.getElementById('analyticsTotal').textContent = `${data.total} total issue${data.total === 1 ? '' : 's'}`;

    renderBarChart('chartStatus', data.byStatus);
    renderBarChart('chartPriority', data.byPriority);
    renderBarChart('chartComponent', data.byComponent);
  }

  function renderBarChart(containerId, counts) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const entries = Object.entries(counts);
    if (entries.length === 0) {
      container.innerHTML = '<p class="issue-row-sub">No data yet.</p>';
      return;
    }

    const max = Math.max(...entries.map(([, count]) => count));
    entries.sort((a, b) => b[1] - a[1]);

    for (const [label, count] of entries) {
      const row = document.createElement('div');
      row.className = 'bar-row';
      const pct = max > 0 ? Math.round((count / max) * 100) : 0;
      row.innerHTML = `
        <span class="bar-label">${escapeHtml(label)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <span class="bar-count">${count}</span>
      `;
      container.appendChild(row);
    }
  }

  function highlightMentions(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(/@([A-Za-z0-9_]+)/g, '<span class="mention">@$1</span>');
  }

  function renderComments(comments) {
    const list = document.getElementById('commentsList');
    list.innerHTML = '';
    for (const c of comments) {
      const el = document.createElement('div');
      if (c.type === 'activity') {
        el.className = 'comment-activity';
        el.textContent = `${c.author} ${c.text} · ${formatTime(c.createdAt)}`;
      } else {
        el.className = 'comment';
        el.innerHTML = `
          <div class="comment-header">
            <span class="comment-author">${escapeHtml(c.author)}</span>
            <span class="comment-time">${formatTime(c.createdAt)}</span>
          </div>
          <p class="comment-text">${highlightMentions(c.text)}</p>
        `;
      }
      list.appendChild(el);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
})();
