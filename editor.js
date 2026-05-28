/* eoin-stats profile editor — talks directly to api.github.com */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const LS = window.localStorage;
  const TOKEN_KEY = "eoinstats.gh.token";
  const CFG_KEY = "eoinstats.gh.cfg";

  // ---- Field schemas ---------------------------------------------------------
  const SCALARS = [
    ["name", "Name"],
    ["headline", "Headline"],
    ["location", "Location"],
    ["email", "Email"],
    ["website", "Website"],
    ["linkedin", "LinkedIn URL"],
    ["summary", "Summary", "textarea"],
  ];

  const STATS_FIELDS = [
    "connections", "followers", "profile_views_90d", "search_appearances_7d",
    "post_impressions_7d", "impressions_365d", "members_reached_365d", "as_of",
  ];

  const LINK_FIELDS = [
    "github", "github_org", "forum", "blog", "linkedin",
    "researchgate", "huggingface", "thingiverse",
  ];

  const ITEM_SCHEMAS = {
    skills: { kind: "string", placeholder: "e.g. Edge AI" },
    languages: { kind: "string", placeholder: "e.g. English" },
    experience: {
      kind: "object",
      fields: [
        ["title", "Title"],
        ["company", "Company"],
        ["location", "Location"],
        ["start", "Start (YYYY-MM)"],
        ["end", "End or 'Present'"],
        ["highlights", "Highlights (one per line)", "textarea-list"],
      ],
    },
    education: {
      kind: "object",
      fields: [["school", "School"], ["degree", "Degree"], ["year", "Year"]],
    },
    certifications: {
      kind: "object",
      fields: [["name", "Name"], ["issuer", "Issuer"], ["issued", "Issued (YYYY-MM)"], ["credential_id", "Credential ID"]],
    },
    featured: { kind: "object", fields: [["title", "Title"], ["url", "URL"]] },
    projects: { kind: "object", fields: [["name", "Name"], ["url", "URL"]] },
    honors: { kind: "object", fields: [["title", "Title"], ["issuer", "Issuer"], ["year", "Year"]] },
    volunteering: {
      kind: "object",
      fields: [["role", "Role"], ["org", "Organisation"], ["start", "Start"], ["end", "End"], ["notes", "Notes", "textarea"]],
    },
    top_posts: {
      kind: "object",
      fields: [
        ["date", "Date (YYYY-MM)"],
        ["impressions", "Impressions", "number"],
        ["reactions", "Reactions", "number"],
        ["comments", "Comments", "number"],
        ["reposts", "Reposts", "number"],
        ["summary", "Summary", "textarea"],
        ["tags", "Tags (comma separated)", "csv"],
      ],
    },
    huggingface_highlights: { kind: "string", placeholder: "Short bullet" },
    huggingface_featured_models: { kind: "object", fields: [["id", "Model ID"], ["task", "Task"]] },
    huggingface_featured_datasets: { kind: "object", fields: [["id", "Dataset ID"]] },
    huggingface_featured_spaces: { kind: "object", fields: [["id", "Space ID"], ["sdk", "SDK"]] },
    thingiverse_designs: { kind: "object", fields: [["title", "Title"]] },
  };

  const HF_SCALARS = [["user", "HF username"], ["tier", "Tier"], ["followers", "Followers", "number"], ["following", "Following", "number"]];
  const TV_SCALARS = [["user", "Thingiverse username"], ["designs_count", "Designs count", "number"], ["collections", "Collections", "number"], ["likes", "Likes", "number"], ["profile_url", "Profile URL"]];

  // ---- State -----------------------------------------------------------------
  let data = {};
  let sha = null;

  // ---- Auth + config ---------------------------------------------------------
  function loadCfg() {
    try { return JSON.parse(LS.getItem(CFG_KEY) || "{}"); } catch { return {}; }
  }
  function saveCfg(cfg) { LS.setItem(CFG_KEY, JSON.stringify(cfg)); }

  function restoreCfg() {
    const cfg = loadCfg();
    if (cfg.owner) $("f-owner").value = cfg.owner;
    if (cfg.repo) $("f-repo").value = cfg.repo;
    if (cfg.path) $("f-path").value = cfg.path;
    if (cfg.branch) $("f-branch").value = cfg.branch;
    const tok = LS.getItem(TOKEN_KEY);
    if (tok) $("f-token").value = tok;
  }

  function readCfg() {
    return {
      owner: $("f-owner").value.trim(),
      repo: $("f-repo").value.trim(),
      path: $("f-path").value.trim(),
      branch: $("f-branch").value.trim() || "main",
    };
  }

  function setStatus(el, msg, kind) {
    el.textContent = msg || "";
    el.style.color = kind === "err" ? "#dc2626" : kind === "ok" ? "#16a34a" : "";
  }

  // ---- GitHub API ------------------------------------------------------------
  async function ghFetch(path, init) {
    const token = $("f-token").value.trim();
    if (!token) throw new Error("Missing token.");
    const r = await fetch("https://api.github.com" + path, Object.assign({
      headers: {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Authorization": "Bearer " + token,
      },
    }, init || {}));
    if (!r.ok) {
      const t = await r.text();
      throw new Error("GitHub " + r.status + ": " + t.slice(0, 200));
    }
    return r.json();
  }

  async function loadFile() {
    const cfg = readCfg(); saveCfg(cfg); LS.setItem(TOKEN_KEY, $("f-token").value.trim());
    setStatus($("auth-status"), "Loading...");
    try {
      const meta = await ghFetch(
        `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}?ref=${encodeURIComponent(cfg.branch)}`
      );
      sha = meta.sha;
      const decoded = atob(meta.content.replace(/\n/g, ""));
      data = JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, c => c.charCodeAt(0))));
      $("editor-section").hidden = false;
      renderAll();
      setStatus($("auth-status"), "Loaded.", "ok");
    } catch (e) {
      setStatus($("auth-status"), e.message, "err");
    }
  }

  async function saveFile() {
    syncFormToData();
    const cfg = readCfg();
    setStatus($("save-status"), "Saving...");
    try {
      const json = JSON.stringify(data, null, 2);
      const utf8 = new TextEncoder().encode(json);
      let bin = ""; utf8.forEach(b => bin += String.fromCharCode(b));
      const b64 = btoa(bin);
      const body = {
        message: "profile: update via editor (" + new Date().toISOString() + ")",
        content: b64,
        branch: cfg.branch,
        sha,
      };
      const res = await ghFetch(
        `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      sha = res.content.sha;
      setStatus($("save-status"), "Committed: " + res.commit.sha.slice(0, 7), "ok");
    } catch (e) {
      setStatus($("save-status"), e.message, "err");
    }
  }

  // ---- Rendering -------------------------------------------------------------
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) n.setAttribute(k, "");
      else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    }
    for (const kid of kids) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
    return n;
  }

  function inputFor(name, label, kind, value) {
    const lab = el("label", null, label);
    let inp;
    if (kind === "textarea") {
      inp = el("textarea", { name, rows: 3 }); inp.value = value || "";
    } else if (kind === "number") {
      inp = el("input", { type: "number", name }); if (value != null) inp.value = value;
    } else {
      inp = el("input", { type: kind === "password" ? "password" : "text", name }); inp.value = value || "";
    }
    lab.append(inp);
    return lab;
  }

  function renderScalars() {
    const root = $("scalar-fields"); root.innerHTML = "";
    SCALARS.forEach(([k, label, kind]) => {
      root.append(inputFor("scalar:" + k, label, kind, data[k] || ""));
    });
  }

  function renderKVObject(rootId, fields, obj) {
    const root = $(rootId); root.innerHTML = "";
    fields.forEach((f) => {
      const [k, label, kind] = Array.isArray(f) ? f : [f, f];
      root.append(inputFor(rootId + ":" + k, label, kind, (obj || {})[k]));
    });
  }

  function renderList(listKey) {
    const root = $("list-" + listKey);
    root.innerHTML = "";
    const schema = ITEM_SCHEMAS[listKey];
    const arr = getList(listKey);
    arr.forEach((item, idx) => root.append(itemNode(listKey, schema, item, idx)));
  }

  function getList(listKey) {
    if (listKey === "huggingface_highlights") return (data.huggingface ||= {}).highlights ||= [];
    if (listKey === "huggingface_featured_models") return (data.huggingface ||= {}).featured_models ||= [];
    if (listKey === "huggingface_featured_datasets") return (data.huggingface ||= {}).featured_datasets ||= [];
    if (listKey === "huggingface_featured_spaces") return (data.huggingface ||= {}).featured_spaces ||= [];
    if (listKey === "thingiverse_designs") return (data.thingiverse ||= {}).designs ||= [];
    return data[listKey] ||= [];
  }

  function blankItem(schema) {
    if (schema.kind === "string") return "";
    const obj = {};
    schema.fields.forEach(([k]) => obj[k] = "");
    return obj;
  }

  function itemNode(listKey, schema, item, idx) {
    const node = el("div", { class: "item" });
    const head = el("div", { class: "item-head" });
    head.append(el("strong", null, "#" + (idx + 1)));
    head.append(el("button", { class: "remove", type: "button",
      onclick: () => { const arr = getList(listKey); arr.splice(idx, 1); renderList(listKey); } }, "Remove"));
    node.append(head);

    if (schema.kind === "string") {
      const inp = el("input", { type: "text", placeholder: schema.placeholder || "" });
      inp.value = item || "";
      inp.addEventListener("input", () => { getList(listKey)[idx] = inp.value; });
      node.append(inp);
    } else {
      const grid = el("div", { class: "grid" });
      schema.fields.forEach(([k, label, kind]) => {
        let displayValue = item[k];
        if (kind === "textarea-list" && Array.isArray(displayValue)) displayValue = displayValue.join("\n");
        if (kind === "csv" && Array.isArray(displayValue)) displayValue = displayValue.join(", ");
        const lab = inputFor(listKey + ":" + idx + ":" + k, label, kind === "textarea-list" ? "textarea" : (kind === "csv" ? "text" : kind), displayValue);
        const input = lab.querySelector("input,textarea");
        input.addEventListener("input", () => {
          let v = input.value;
          if (kind === "textarea-list") v = v.split("\n").map(s => s.trim()).filter(Boolean);
          else if (kind === "csv") v = v.split(",").map(s => s.trim()).filter(Boolean);
          else if (kind === "number") v = v === "" ? "" : Number(v);
          getList(listKey)[idx][k] = v;
        });
        grid.append(lab);
      });
      node.append(grid);
    }
    return node;
  }

  function renderAll() {
    renderScalars();
    Object.keys(ITEM_SCHEMAS).forEach(renderList);
    renderKVObject("obj-stats", STATS_FIELDS, data.stats || {});
    renderKVObject("obj-links", LINK_FIELDS, data.links || {});
    renderKVObject("obj-huggingface-scalars", HF_SCALARS, data.huggingface || {});
    renderKVObject("obj-thingiverse-scalars", TV_SCALARS, data.thingiverse || {});
    $("raw-json").value = JSON.stringify(data, null, 2);
  }

  function syncFormToData() {
    // Scalars
    SCALARS.forEach(([k]) => {
      const inp = document.querySelector(`[name="scalar:${k}"]`);
      if (inp) data[k] = inp.value;
    });
    // Stats / links / hf / tv scalar groups
    const groups = [
      ["obj-stats", "stats", STATS_FIELDS, true],
      ["obj-links", "links", LINK_FIELDS, false],
      ["obj-huggingface-scalars", "huggingface", HF_SCALARS.map(f => f[0]), false],
      ["obj-thingiverse-scalars", "thingiverse", TV_SCALARS.map(f => f[0]), false],
    ];
    groups.forEach(([rootId, key, fields, coerceNumber]) => {
      const obj = data[key] ||= {};
      fields.forEach((f) => {
        const fk = Array.isArray(f) ? f[0] : f;
        const inp = document.querySelector(`[name="${rootId}:${fk}"]`);
        if (!inp) return;
        let v = inp.value;
        if (coerceNumber && /^[0-9]+$/.test(v)) v = Number(v);
        obj[fk] = v;
      });
    });
  }

  // ---- Wire up ---------------------------------------------------------------
  function init() {
    restoreCfg();
    $("btn-load").addEventListener("click", loadFile);
    $("btn-save").addEventListener("click", saveFile);
    $("btn-forget").addEventListener("click", () => {
      LS.removeItem(TOKEN_KEY); $("f-token").value = "";
      setStatus($("auth-status"), "Token forgotten.", "ok");
    });
    $("btn-download").addEventListener("click", () => {
      syncFormToData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "linkedin.json"; a.click();
    });
    $("btn-from-form").addEventListener("click", () => { syncFormToData(); $("raw-json").value = JSON.stringify(data, null, 2); });
    $("btn-to-form").addEventListener("click", () => {
      try { data = JSON.parse($("raw-json").value); renderAll(); setStatus($("save-status"), "Form updated from JSON.", "ok"); }
      catch (e) { setStatus($("save-status"), "Invalid JSON: " + e.message, "err"); }
    });

    document.querySelectorAll(".tab").forEach(t => {
      t.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(x => x.classList.remove("on"));
        t.classList.add("on");
        const which = t.dataset.tab;
        $("tab-form").hidden = which !== "form";
        $("tab-raw").hidden = which !== "raw";
        if (which === "raw") { syncFormToData(); $("raw-json").value = JSON.stringify(data, null, 2); }
      });
    });

    document.querySelectorAll("button.add").forEach(b => {
      b.addEventListener("click", () => {
        const k = b.dataset.list;
        getList(k).push(blankItem(ITEM_SCHEMAS[k]));
        renderList(k);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
