const api = "https://api.github.com";
const $ = id => document.getElementById(id);
let repos = [];

async function storageGet() {
  return browser.storage.local.get(["token", "repos"]);
}

async function init() {
  const data = await storageGet();
  if (data.token) $("token").value = data.token;
  if (data.repos) {
    repos = data.repos;
    renderRepos();
  }
  $("repoSearch").addEventListener("input", renderRepos);
  $("selectAll").onclick = () => setAll(true);
  $("selectNone").onclick = () => setAll(false);
  $("loadRepos").onclick = loadRepos;
  $("saveToken").onclick = saveToken;
  $("connect").onclick = connect;
  $("run").onclick = runBulk;
  $("deleteRun").onclick = runBulkDelete;
  $("updateMode").onclick = () => setMode("update");
  $("deleteMode").onclick = () => setMode("delete");
  $("clearResults").onclick = () => $("results").innerHTML = '<div class="empty">No updates yet.</div>';
}
init();

function token() {
  return $("token").value.trim();
}

async function saveToken() {
  if (!token()) return alert("Enter a GitHub token first.");
  await browser.storage.local.set({token: token()});
  setStatus(true);
}

function headers() {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token()}`,
    "X-GitHub-Api-Version": "2026-03-10"
  };
}

async function gh(url, options = {}) {
  const res = await fetch(api + url, { ...options, headers: {...headers(), ...(options.headers || {})} });
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    const msg = body?.message || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body;
}

async function connect() {
  if (!token()) return alert("Enter your GitHub token.");
  try {
    const me = await gh("/user");
    $("account").textContent = `Connected as ${me.login}`;
    setStatus(true);
    await browser.storage.local.set({token: token()});
  } catch (e) {
    setStatus(false);
    $("account").textContent = "Connection failed";
    alert(e.message);
  }
}

async function loadRepos() {
  if (!token()) return alert("Enter and save/test your GitHub token first.");
  $("repos").innerHTML = '<div class="empty">Loading...</div>';
  try {
    let page = 1, all = [];
    while (true) {
      const batch = await gh(`/user/repos?per_page=100&page=${page}&sort=full_name&affiliation=owner,collaborator,organization_member`);
      all.push(...batch);
      if (batch.length < 100) break;
      page++;
    }
    repos = all.map(r => ({full_name:r.full_name, selected:false, private:r.private, default_branch:r.default_branch}));
    await browser.storage.local.set({repos});
    renderRepos();
  } catch (e) {
    $("repos").innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

function renderRepos() {
  const q = $("repoSearch").value.trim().toLowerCase();
  const visible = repos.filter(r => r.full_name.toLowerCase().includes(q));
  $("repos").innerHTML = visible.length ? visible.map((r,i) => {
    const idx = repos.indexOf(r);
    return `<label class="repo">
      <input type="checkbox" data-index="${idx}" ${r.selected ? "checked" : ""}>
      <span class="repo-name">${escapeHtml(r.full_name)}</span>
      ${r.private ? "<span title='Private'>🔒</span>" : ""}
    </label>`;
  }).join("") : '<div class="empty">No repositories found.</div>';

  $("repos").querySelectorAll("input").forEach(cb => {
    cb.onchange = async () => {
      repos[Number(cb.dataset.index)].selected = cb.checked;
      await browser.storage.local.set({repos});
      updateCount();
    };
  });
  updateCount();
}

function setAll(value) {
  const q = $("repoSearch").value.trim().toLowerCase();
  repos.forEach(r => { if (!q || r.full_name.toLowerCase().includes(q)) r.selected = value; });
  browser.storage.local.set({repos});
  renderRepos();
}

function updateCount() {
  $("repoCount").textContent = `${repos.filter(r => r.selected).length} selected`;
}

function manualRepos() {
  return $("manualRepos").value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}

function selectedRepos() {
  const list = repos.filter(r => r.selected).map(r => r.full_name);
  return [...new Set([...list, ...manualRepos()])];
}

async function getFile(owner, repo, path, branch) {
  const suffix = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const res = await fetch(`${api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.replace(/^\//,"")}${suffix}`, {
    headers: headers()
  });
  if (res.status === 404) return null;
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) throw new Error(body?.message || `${res.status} ${res.statusText}`);
  if (Array.isArray(body)) throw new Error("Path is a directory, not a file.");
  return body;
}

async function updateRepo(fullName, path, content, message, branch, skip) {
  const parts = fullName.split("/");
  if (parts.length !== 2) throw new Error("Repository must be owner/name.");
  const [owner, repo] = parts;
  const existing = await getFile(owner, repo, path, branch);

  if (existing && skip) {
    const current = decodeBase64(existing.content || "");
    if (normalize(current) === normalize(content)) return {type:"skip", text:"Already identical"};
  }

  const body = {
    message,
    content: encodeBase64(content)
  };
  if (existing?.sha) body.sha = existing.sha;
  if (branch) body.branch = branch;

  const result = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.replace(/^\/+/,"")}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });

  return {type:"ok", text: existing ? `Updated (${result.commit?.sha?.slice(0,7) || "commit"})` : `Created (${result.commit?.sha?.slice(0,7) || "commit"})`};
}

function setMode(mode) {
  const update = mode === "update";
  $("updateMode").classList.toggle("active", update);
  $("deleteMode").classList.toggle("active", !update);
  $("updatePanel").classList.toggle("hidden", !update);
  $("deletePanel").classList.toggle("hidden", update);
  $("run").classList.toggle("hidden", !update);
}

async function deleteRepo(fullName, path, message, branch, requireExisting) {
  const parts = fullName.split("/");
  if (parts.length !== 2) throw new Error("Repository must be owner/name.");
  const [owner, repo] = parts;
  const existing = await getFile(owner, repo, path, branch);

  if (!existing) {
    if (requireExisting) return {type:"skip", text:"File does not exist"};
    throw new Error("File does not exist");
  }

  const body = {
    message,
    sha: existing.sha
  };
  if (branch) body.branch = branch;

  const result = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.replace(/^\/+/, "")}`, {
    method: "DELETE",
    body: JSON.stringify(body)
  });

  return {type:"ok", text:`Deleted (${result.commit?.sha?.slice(0,7) || "commit"})`};
}

async function runBulkDelete() {
  if (!token()) return alert("Enter a GitHub token.");
  const targets = selectedRepos();
  if (!targets.length) return alert("Select at least one repository or enter one manually.");

  const path = $("deletePath").value.trim();
  const message = $("deleteMessage").value.trim() || "Bulk delete";
  const branch = $("deleteBranch").value.trim();
  const requireExisting = $("requireExisting").checked;

  if (!path) return alert("Enter a file path.");
  const confirmed = confirm(
    `PERMANENTLY DELETE "${path}" from ${targets.length} repository${targets.length === 1 ? "" : "ies"}?\n\nThis creates a deletion commit in each repository. This cannot be undone through this extension.`
  );
  if (!confirmed) return;

  $("deleteRun").disabled = true;
  $("run").disabled = true;
  $("results").innerHTML = "";
  $("progress").classList.remove("hidden");
  $("bar").style.width = "0%";

  for (let i = 0; i < targets.length; i++) {
    const name = targets[i];
    try {
      const result = await deleteRepo(name, path, message, branch, requireExisting);
      addResult(name, result.type, result.text);
    } catch (e) {
      addResult(name, "err", e.message);
    }
    $("bar").style.width = `${((i+1)/targets.length)*100}%`;
  }

  $("deleteRun").disabled = false;
  $("run").disabled = false;
}

async function runBulk() {
  if (!token()) return alert("Enter a GitHub token.");
  const targets = selectedRepos();
  if (!targets.length) return alert("Select at least one repository or enter one manually.");

  const path = $("path").value.trim();
  const content = $("content").value;
  const message = $("message").value.trim() || "Bulk update";
  const branch = $("branch").value.trim();
  const skip = $("skipUnchanged").checked;

  if (!path) return alert("Enter a file path.");
  if (!content && !confirm("The file content is empty. Continue?")) return;

  $("run").disabled = true;
  $("results").innerHTML = "";
  $("progress").classList.remove("hidden");
  $("bar").style.width = "0%";

  for (let i = 0; i < targets.length; i++) {
    const name = targets[i];
    try {
      const result = await updateRepo(name, path, content, message, branch, skip);
      addResult(name, result.type, result.text);
    } catch (e) {
      addResult(name, "err", e.message);
    }
    $("bar").style.width = `${((i+1)/targets.length)*100}%`;
  }

  $("run").disabled = false;
}

function addResult(repo, type, text) {
  const div = document.createElement("div");
  div.className = `result ${type === "ok" ? "ok" : type === "skip" ? "skip" : "err"}`;
  div.innerHTML = `<strong>${type === "ok" ? "✓" : type === "skip" ? "↷" : "✕"} ${escapeHtml(repo)}</strong><span>${escapeHtml(text)}</span>`;
  $("results").appendChild(div);
}

function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function decodeBase64(b64) {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalize(s) {
  return s.replace(/\r\n/g, "\n");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function setStatus(ok) {
  $("statusDot").className = `dot ${ok ? "ok" : "bad"}`;
}