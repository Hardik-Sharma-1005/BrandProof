const STORAGE_KEY = "brandproof.round2.local.v1";
const MAX_CUSTOM_SOURCES = 100;
const sampleCopy = "Meet GlowRepair, the new serum from Acme Skin. It is 100% safe for every skin type. It is the best moisturiser on the market. Visit acmeskin.example for more.";
const launchMode = new URLSearchParams(window.location.search).get("start");
const state = loadState();
let brandbook = { policies: [], facts: [] };
let pendingEdit = null;
let pendingNote = null;
let toastTimer = null;

const $ = (selector) => document.querySelector(selector);
const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const now = () => new Date().toISOString();
const actorName = () => ({ creator: "Creator", manager: "Brand manager", reviewer: "Legal reviewer" }[$("#role-select").value] || "Creator");
const dateLabel = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      reviews: Array.isArray(saved.reviews) ? saved.reviews : [],
      activeId: saved.activeId || null,
      customSources: Array.isArray(saved.customSources) ? saved.customSources.filter((source) => source && typeof source === "object") : [],
      role: ["creator", "manager", "reviewer"].includes(saved.role) ? saved.role : "creator",
      draftTitle: typeof saved.draftTitle === "string" ? saved.draftTitle : "Spring campaign post",
      draftText: typeof saved.draftText === "string" ? saved.draftText : sampleCopy,
    };
  } catch {
    return { reviews: [], activeId: null, customSources: [], role: "creator", draftTitle: "Spring campaign post", draftText: sampleCopy };
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $("#save-status").textContent = "Saved in this browser";
  } catch {
    $("#save-status").textContent = "Browser storage is full";
    showToast("Could not save more data in this browser.");
  }
  updateHistoryCount();
}

function activeReview() {
  return state.reviews.find((review) => review.id === state.activeId) || null;
}

function addEvent(review, action, detail) {
  review.events.unshift({ at: now(), actor: actorName(), action, detail });
}

function updateHistoryCount() {
  $("#history-count").textContent = state.reviews.length;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setReviewProcessing(state, label) {
  const status = $("#review-processing");
  if (!status) return;
  if (typeof status.setProps === "function") {
    status.setProps({ state, label });
    return;
  }
  status.dataset.state = state;
  status.hidden = state === "idle";
  status.setAttribute("aria-busy", state === "loading" ? "true" : "false");
  const labelNode = status.querySelector("#review-processing-label, .depth-orbs__label") || status.querySelector("span");
  if (labelNode) labelNode.textContent = label || "";
}

function navigate(page) {
  document.querySelectorAll(".page").forEach((section) => section.classList.toggle("active-page", section.id === `page-${page}`));
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  const labels = { review: "Review content", library: "Brand library", activity: "Review history" };
  $("#page-crumb").textContent = labels[page] || "Review content";
  if (page === "review") renderReview();
  if (page === "library") renderLibrary();
  if (page === "activity") renderActivity();
}

async function loadBrandbook() {
  try {
    const response = await fetch("/api/brandbook", { cache: "no-store" });
    if (!response.ok) throw new Error("Brand library could not be loaded.");
    brandbook = await response.json();
  } catch {
    showToast("Could not connect to the local review service.");
  }
}

function findingStatus(review, finding) {
  const role = $("#role-select").value;
  const canResolve = ["creator", "manager", "reviewer"].includes(role) && review.status !== "approved";
  if (finding.status !== "open") {
    const labels = { accepted: "SUGGESTION APPLIED", edited: "EDIT SAVED", dismissed: "MARKED NOT APPLICABLE", supported: "EVIDENCE REVIEWED" };
    return `<div class="finding-resolved"><span class="resolved-label"><b>${labels[finding.status] || "RESOLVED"}</b><span>by ${esc(finding.resolvedBy || "reviewer")}</span></span>${finding.resolution_note ? `<p>${esc(finding.resolution_note)}</p>` : ""}</div>`;
  }
  if (!canResolve) return "";
  const ix = review.findings.findIndex((candidate) => candidate.id === finding.id);
  const canMakeDecision = ["manager", "reviewer"].includes(role);
  const canConfirmEvidence = canMakeDecision && finding.issues.length > 0 && finding.issues.every((issue) => issue.evidence_status === "attached-for-human-review" && issue.evidence_approval_status === "Approved by workspace");
  return `<div class="finding-actions">
    ${canConfirmEvidence ? `<button class="button secondary" data-action="confirm-evidence" data-index="${ix}">Confirm evidence supports claim</button>` : ""}
    ${finding.suggested_sentence && finding.suggested_sentence !== finding.quote ? `<button class="button accept" data-action="accept" data-index="${ix}">Apply safe edit</button>` : ""}
    <button class="button secondary" data-action="edit" data-index="${ix}">${finding.missing_requirement ? "Edit draft" : "Edit copy"}</button>
    ${canMakeDecision ? `<button class="button dismiss" data-action="dismiss" data-index="${ix}">Mark not applicable</button>` : ""}
  </div>`;
}

function renderFinding(finding, review) {
  const issueMarkup = finding.issues.map((issue) => {
    const sourceLabel = issue.source_verified
      ? "POLICY EXCERPT MATCHED"
      : issue.source_status === "Approved by workspace"
        ? "WORKSPACE MARKED APPROVED"
        : "WORKSPACE SOURCE NEEDS APPROVAL";
    const evidenceLabels = {
      "evidence-not-supplied": "EVIDENCE GAP / NONE SUPPLIED",
      "attached-for-human-review": "EVIDENCE ATTACHED / HUMAN SCOPE CHECK",
      "source-needs-approval": "SOURCE NEEDS APPROVAL",
      "policy-check": "POLICY CHECK",
      "workspace-rule": "WORKSPACE RULE",
      "required-phrase-missing": "REQUIRED WORDING MISSING",
    };
    const sourceLocation = [issue.source_document, issue.source_location].filter(Boolean).join(" / ");
    const evidenceLocation = [issue.evidence_document, issue.evidence_location].filter(Boolean).join(" / ");
    const evidenceApprover = issue.evidence_approved_by ? ` / ${issue.evidence_approval_status} by ${issue.evidence_approved_by}${issue.evidence_approved_at ? ` on ${dateLabel(issue.evidence_approved_at)}` : ""}` : issue.evidence_approval_status ? ` / ${issue.evidence_approval_status}` : "";
    return `<div class="issue-block">
      <div class="finding-head"><span class="finding-topline">${esc(issue.rule_id)} / ${esc(issue.category)}</span><span class="severity ${esc(issue.severity)}">${esc(issue.severity)}</span></div>
      <div class="finding-body">
        <h3 class="finding-title">${esc(issue.category)}</h3>
        ${issue.draft_quote ? `<blockquote class="finding-quote">“${esc(issue.draft_quote)}”</blockquote>` : `<p class="finding-quote">Required phrase missing: ${esc(finding.missing_requirement || issue.match_text)}</p>`}
        ${issue.match_text && issue.draft_quote ? `<p class="finding-match">Matched text: “${esc(issue.match_text)}”</p>` : ""}
        <p class="finding-copy">${esc(issue.explanation)}</p>
        ${issue.next_step ? `<p class="finding-next-step"><strong>Next step</strong> ${esc(issue.next_step)}</p>` : ""}
        <div class="source-reference ${issue.source_verified || issue.source_status === "Approved by workspace" ? "" : "source-unverified"}"><strong>${sourceLabel} / ${esc(issue.rule_id)}</strong><em>${esc(issue.source_title)}${sourceLocation ? ` · ${esc(sourceLocation)}` : ""}: “${esc(issue.source_excerpt || "No source excerpt was recorded.")}"</em></div>
        ${issue.evidence_status && !["policy-check", "workspace-rule"].includes(issue.evidence_status) ? `<div class="evidence-reference ${issue.evidence_status === "evidence-not-supplied" || issue.evidence_status === "source-needs-approval" || issue.evidence_status === "required-phrase-missing" ? "source-unverified" : ""}"><strong>${esc(evidenceLabels[issue.evidence_status] || "EVIDENCE STATUS")}${evidenceApprover ? esc(evidenceApprover) : ""}</strong>${issue.evidence_title ? `<em>${esc(issue.evidence_title)}${evidenceLocation ? ` · ${esc(evidenceLocation)}` : ""}: “${esc(issue.evidence_excerpt)}”</em>` : ""}</div>` : ""}
      </div>
    </div>`;
  }).join("");
  const suggestion = finding.suggested_sentence
    ? `<div class="finding-body suggestion-box"><div class="suggestion-label">SUGGESTED COPY</div><p class="suggestion-text">${esc(finding.suggested_sentence)}</p></div>`
    : `<div class="finding-body suggestion-box"><div class="suggestion-label">NO AUTOMATIC REWRITE</div><p class="suggestion-text">Use the source and next step above to revise this copy. BrandProof leaves factual claims for a human to rewrite.</p></div>`;
  return `<article class="finding-card ${esc(finding.severity)}" data-finding-id="${esc(finding.id)}">
    ${issueMarkup}
    ${suggestion}
    ${findingStatus(review, finding)}
  </article>`;
}

function reviewIsCurrent(review) {
  return Boolean(review && review.scanText === review.draft && review.scanSourceSignature === sourceSignature());
}

function sourceSignature(sources = state.customSources || []) {
  const activeSources = sources
    .filter((source) => source.check_type && source.check_type !== "reference" && source.enabled !== false)
    .map((source) => [source.id, source.check_type, source.trigger, source.replacement, source.body, source.source_document, source.source_location, source.approved, source.severity])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  const serialized = JSON.stringify([brandbook.version || "sample-v1", activeSources]);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${brandbook.version || "sample-v1"}:${(hash >>> 0).toString(16)}:${activeSources.length}`;
}

function renderReview(syncInputs = true) {
  const review = activeReview();
  const list = $("#findings-list");
  const empty = $("#results-empty");
  const summary = $("#results-summary");
  const controls = $("#review-controls");
  const note = $("#workflow-note");
  const statusPill = $("#results-status");
  if (!review) {
    $("#new-review").classList.add("hidden");
    $("#draft-title").disabled = false;
    $("#content-input").disabled = false;
    empty.classList.remove("hidden");
    summary.classList.add("hidden");
    controls.classList.add("hidden");
    note.classList.add("hidden");
    list.innerHTML = "";
    $("#results-title").textContent = "Findings";
    statusPill.className = "status-pill neutral";
    statusPill.textContent = "NOT REVIEWED";
    return;
  }

  $("#new-review").classList.remove("hidden");
  $("#draft-title").disabled = review.status === "approved";
  $("#content-input").disabled = review.status === "approved";
  state.draftTitle = review.title;
  state.draftText = review.draft;
  if (syncInputs) {
    $("#draft-title").value = review.title;
    $("#content-input").value = review.draft;
    updateCharCount();
  }
  empty.classList.add("hidden");
  summary.classList.remove("hidden");
  controls.classList.remove("hidden");
  const openCount = review.findings.filter((finding) => finding.status === "open").length;
  const severityCounts = { high: 0, medium: 0, low: 0 };
  review.findings.filter((finding) => finding.status === "open").forEach((finding) => { severityCounts[finding.severity] += 1; });
  const isCurrent = reviewIsCurrent(review);
  let label;
  let pillClass;
  if (review.status === "approved") { label = "APPROVED"; pillClass = "ready"; }
  else if (review.status === "changes-requested") { label = "CHANGES REQUESTED"; pillClass = "pending"; }
  else if (!isCurrent) { label = "CHANGES TO RESCAN"; pillClass = "pending"; }
  else if (openCount) { label = "NEEDS ATTENTION"; pillClass = "issue"; }
  else { label = "READY FOR REVIEWER"; pillClass = "ready"; }
  statusPill.className = `status-pill ${pillClass}`;
  statusPill.textContent = label;
  $("#results-title").textContent = review.title || "Untitled review";
  const total = review.findings.length;
  const coverage = review.coverage || {};
  const coverageNote = coverage.workspace_rules !== undefined
    ? `Checked ${coverage.built_in_rules || 0} built-in and ${coverage.workspace_rules || 0} workspace rules. ${coverage.reference_only_sources || 0} reference-only or paused source${coverage.reference_only_sources === 1 ? " is" : "s are"} not scanned.`
    : "";
  summary.innerHTML = `<span class="summary-chip high">${severityCounts.high} high</span><span class="summary-chip medium">${severityCounts.medium} medium</span><span class="summary-chip low">${severityCounts.low} low</span><span class="summary-chip">${total} finding${total === 1 ? "" : "s"}</span><p class="summary-message">${isCurrent ? "Latest scan matches this draft and source set." : "Draft or automated sources changed after the last scan. Re-run review before approval."} ${esc(coverageNote)} ${esc(review.reviewNote || "")}</p>`;
  list.innerHTML = total ? review.findings.map((finding) => renderFinding(finding, review)).join("") : `<div class="no-findings"><strong>No configured rule triggered</strong><p>This is not a compliance guarantee. A human reviewer still needs to make the final decision.</p></div>`;
  const role = $("#role-select").value;
  const canReview = role === "manager" || role === "reviewer";
  const approve = $("#approve-review");
  approve.disabled = !(canReview && isCurrent && openCount === 0 && review.status !== "approved");
  approve.textContent = review.status === "approved" ? "Approved" : canReview ? "Approve" : "Reviewer approval";
  $("#request-changes").classList.toggle("hidden", !canReview || review.status === "approved");
  const noteText = review.status === "approved"
    ? `Approved by ${esc(review.approvedBy || "reviewer")} on ${esc(dateLabel(review.approvedAt))}. This is a demo workflow, not a secure approval system.`
    : review.status === "changes-requested"
      ? `Changes requested by ${esc(review.changeRequestBy || "reviewer")}: ${esc(review.changeRequestNote || "See the review history for details.")}`
    : canReview && openCount > 0
      ? "Resolve or dismiss each open finding, then re-run the scan. Approval is available only when the latest scan matches the draft."
      : canReview && !isCurrent
        ? "Run the review again on this exact draft before approving it."
        : canReview
          ? "No open findings remain. Approve to add the decision to the local audit trail."
          : "Creator actions are saved locally. A manager or legal reviewer must re-run and approve the latest draft.";
  note.innerHTML = noteText;
  note.classList.remove("hidden");
  $("#rescan").disabled = review.status === "approved";
  $("#rescan").classList.toggle("hidden", review.status === "approved");
}

function updateCharCount() {
  const length = $("#content-input").value.length;
  $("#char-count").textContent = `${length.toLocaleString()} character${length === 1 ? "" : "s"}`;
}

async function runReview(isRescan = false) {
  const title = $("#draft-title").value.trim() || "Untitled review";
  const draft = $("#content-input").value;
  const button = $("#run-review");
  const rescanButton = $("#rescan");
  const scanSources = (state.customSources || []).map((source) => ({ ...source }));
  const scannedSourceSignature = sourceSignature(scanSources);
  const scanSourceSnapshot = scanSources.map((source) => ({
    id: source.id,
    title: source.title,
    check_type: source.check_type || "reference",
    trigger: source.trigger || "",
    source_document: source.source_document || "",
    source_location: source.source_location || "",
    approved: source.approved === true,
    approved_by: source.approvedBy || "",
    approved_at: source.approvedAt || "",
    enabled: source.enabled !== false,
  }));
  button.disabled = true;
  rescanButton.disabled = true;
  button.textContent = "Reviewing...";
  setReviewProcessing("loading", "Checking this draft against the current brand rules and sources...");
  try {
    const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: draft, sources: scanSources }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Review failed.");
    let review = activeReview();
    if (!review || review.status === "approved") {
      review = { id: crypto.randomUUID(), title, draft, scanText: draft, scanSourceSignature: scannedSourceSignature, rulesetVersion: result.ruleset_version, sourceSetSnapshot: scanSourceSnapshot, findings: result.findings, coverage: result.coverage, status: "in-review", reviewNote: result.review_note, createdAt: now(), updatedAt: now(), approvedAt: null, approvedBy: null, events: [], versions: [] };
      state.reviews.unshift(review);
      state.activeId = review.id;
      addEvent(review, "Review started", `${title} · ${result.findings.length} finding(s)`);
    } else {
      const previousFindings = new Map((review.findings || []).map((finding) => [finding.id, finding]));
      const signature = (finding) => JSON.stringify([
        finding.quote,
        finding.missing_requirement || "",
        (finding.issues || []).map((issue) => [issue.rule_id, issue.source_excerpt, issue.source_status, issue.source_location, issue.evidence_status, issue.evidence_source_id, issue.evidence_title, issue.evidence_excerpt, issue.evidence_document, issue.evidence_location, issue.evidence_approval_status]),
      ]);
      result.findings = result.findings.map((finding) => {
        const previous = previousFindings.get(finding.id);
        if (!previous || previous.status === "open" || signature(previous) !== signature(finding)) return finding;
        return { ...finding, status: previous.status, resolvedBy: previous.resolvedBy, resolution_note: previous.resolution_note || "" };
      });
      review.title = title;
      review.draft = draft;
      review.scanText = draft;
      review.scanSourceSignature = scannedSourceSignature;
      review.rulesetVersion = result.ruleset_version;
      review.sourceSetSnapshot = scanSourceSnapshot;
      review.findings = result.findings;
      review.coverage = result.coverage;
      review.reviewNote = result.review_note;
      review.status = "in-review";
      review.updatedAt = now();
      addEvent(review, "Review rerun", `Latest scan found ${result.findings.length} item(s).`);
    }
    review.versions.push({ number: review.versions.length + 1, text: draft, findings: JSON.parse(JSON.stringify(result.findings)), ruleset_version: result.ruleset_version, source_signature: scannedSourceSignature, sources: scanSourceSnapshot, at: now(), actor: actorName() });
    state.draftText = review.draft;
    state.draftTitle = review.title;
    persist();
    renderReview();
    setReviewProcessing("complete", result.findings.length
      ? `Review complete. ${result.findings.length} finding${result.findings.length === 1 ? " is" : "s are"} ready.`
      : "Review complete. No configured rule matched this draft.");
    showToast(result.findings.length ? `${result.findings.length} finding${result.findings.length === 1 ? "" : "s"} ready to review.` : "No configured rule triggered.");
  } catch (error) {
    setReviewProcessing("error", error.message || "The review could not be completed. Check the connection and try again.");
  } finally {
    button.disabled = false;
    button.textContent = "Run review";
    rescanButton.disabled = false;
  }
}

function replaceFirst(source, search, replacement) {
  const position = source.indexOf(search);
  if (position < 0) return source;
  return source.slice(0, position) + replacement + source.slice(position + search.length);
}

function handleFindingAction(action, index) {
  const review = activeReview();
  const finding = review?.findings[index];
  if (!review || !finding || finding.status !== "open") return;
  if (action === "accept") {
    if (!finding.suggested_sentence || finding.suggested_sentence === finding.quote) return;
    review.draft = replaceFirst(review.draft, finding.quote, finding.suggested_sentence);
    finding.status = "accepted";
    finding.resolvedBy = actorName();
    finding.resolution_note = "Applied the terminology correction. Re-scan to confirm the final draft.";
    addEvent(review, "Suggestion applied", `${finding.issues.map((issue) => issue.rule_id).join(", ")} · ${finding.suggested_sentence}`);
  } else if (action === "confirm-evidence") {
    openNoteDialog("confirm-evidence", finding.id);
    return;
  } else if (action === "dismiss") {
    openNoteDialog("dismiss", finding.id);
    return;
  } else if (action === "edit") {
    if (finding.missing_requirement) {
      $("#content-input").focus();
      showToast(`Add “${finding.missing_requirement}” if it applies, then run the review again.`);
      return;
    }
    pendingEdit = { index, findingId: finding.id };
    $("#edit-text").value = finding.suggested_sentence;
    $("#edit-dialog").showModal();
    return;
  }
  review.updatedAt = now();
  persist();
  renderReview();
}

function saveEdit() {
  const review = activeReview();
  if (!review || !pendingEdit) return;
  const finding = review.findings.find((candidate) => candidate.id === pendingEdit.findingId);
  const edited = $("#edit-text").value.trim();
  if (!finding || !edited) {
    showToast("Add replacement copy before saving.");
    return;
  }
  review.draft = replaceFirst(review.draft, finding.quote, edited);
  finding.status = "edited";
  finding.resolvedBy = actorName();
  finding.resolution_note = "Copy edited by a reviewer. Re-scan to confirm the change resolves the finding.";
  finding.suggested_sentence = edited;
  addEvent(review, "Copy edited", `${finding.issues.map((issue) => issue.rule_id).join(", ")} · ${edited}`);
  review.updatedAt = now();
  pendingEdit = null;
  persist();
  $("#edit-dialog").close();
  renderReview();
}

function approveReview() {
  const review = activeReview();
  if (!review || !reviewIsCurrent(review) || review.findings.some((finding) => finding.status === "open")) return;
  if (!["manager", "reviewer"].includes($("#role-select").value)) return;
  review.status = "approved";
  review.approvedAt = now();
  review.approvedBy = actorName();
  review.updatedAt = now();
  addEvent(review, "Review approved", "Human approval recorded after a scan matching the latest draft.");
  persist();
  renderReview();
  showToast("Approval recorded in this browser.");
}

function requestChanges() {
  const review = activeReview();
  if (!review || !["manager", "reviewer"].includes($("#role-select").value) || review.status === "approved") return;
  openNoteDialog("request-changes", null);
}

function openNoteDialog(action, findingId) {
  pendingNote = { action, findingId };
  const dismissing = action === "dismiss";
  const confirming = action === "confirm-evidence";
  $("#note-dialog-title").textContent = dismissing ? "Record why this does not apply" : confirming ? "Confirm the evidence" : "Request changes from the creator";
  $("#note-dialog-description").textContent = dismissing
    ? "Add a short reason or point to evidence that resolves this finding. The note stays with the review history."
    : confirming
      ? "Confirm that you checked each approved source against the product, exact wording, audience, conditions, and timeframe. Record what you verified."
      : "Describe the changes needed and include evidence or wording guidance when available.";
  $("#note-text").value = "";
  $("#note-text").placeholder = dismissing ? "Why does this finding not apply?" : confirming ? "What did you verify in the source?" : "What should the creator change?";
  $("#note-dialog").showModal();
  $("#note-text").focus();
}

function saveWorkflowNote(event) {
  event.preventDefault();
  const note = $("#note-text").value.trim();
  if (!note) {
    showToast("Add a reason before saving this decision.");
    $("#note-text").focus();
    return;
  }
  const review = activeReview();
  if (!review || !pendingNote) return;
  if (pendingNote.action === "dismiss" || pendingNote.action === "confirm-evidence") {
    if (!["manager", "reviewer"].includes($("#role-select").value)) return;
    const finding = review.findings.find((candidate) => candidate.id === pendingNote.findingId);
    if (!finding || finding.status !== "open") return;
    finding.status = pendingNote.action === "confirm-evidence" ? "supported" : "dismissed";
    finding.resolvedBy = actorName();
    finding.resolution_note = note;
    const action = pendingNote.action === "confirm-evidence" ? "Claim evidence confirmed" : "Finding marked not applicable";
    const sourceIds = finding.issues.map((issue) => issue.evidence_source_id).filter(Boolean);
    addEvent(review, action, `${finding.issues.map((issue) => issue.rule_id).join(", ")}${sourceIds.length ? ` · evidence ${sourceIds.join(", ")}` : ""} · ${note}`);
  } else {
    review.status = "changes-requested";
    review.changeRequestNote = note;
    review.changeRequestBy = actorName();
    review.changeRequestAt = now();
    addEvent(review, "Changes requested", note);
  }
  review.updatedAt = now();
  pendingNote = null;
  $("#note-dialog").close();
  persist();
  renderReview();
  showToast("Decision note saved to the review history.");
}

function sourceCard(source, userAdded = false) {
  const sourceDetails = [source.source_document, source.source_location].filter(Boolean).join(" / ");
  const approvalDetail = source.approvedBy ? ` / by ${source.approvedBy}${source.approvedAt ? ` on ${dateLabel(source.approvedAt)}` : ""}` : "";
  const automation = source.check_type && source.check_type !== "reference"
    ? `${source.enabled === false ? "Paused" : "Active"} / ${source.approved ? `Approved${approvalDetail}` : "Needs approval"} / ${source.check_type.replaceAll("-", " ")}${source.trigger ? ` / “${esc(source.trigger)}”` : ""}`
    : source.status || (userAdded ? "Reference only" : "Approved sample rule");
  const canManageSources = ["manager", "reviewer"].includes($("#role-select").value);
  const sourceActions = userAdded
    ? `<div class="source-actions">${source.check_type && source.check_type !== "reference" ? `<button class="text-button" data-source-action="toggle-enabled" data-source-id="${esc(source.id)}">${source.enabled === false ? "Enable check" : "Pause check"}</button>${canManageSources ? `<button class="text-button" data-source-action="toggle-approval" data-source-id="${esc(source.id)}">${source.approved ? "Revoke approval" : "Approve source"}</button>` : ""}` : ""}<button class="text-button" data-source-action="remove" data-source-id="${esc(source.id)}">Remove source</button></div>`
    : "";
  return `<article class="source-card">
    <div class="source-meta"><span class="source-id">${esc(source.id)}</span><span class="source-type">${esc(source.type || "Approved source")}</span></div>
    <h3>${esc(source.title)}</h3><p>${esc(source.body)}${sourceDetails ? `<br><span>${esc(sourceDetails)}</span>` : ""}</p>
    <div class="source-owner"><span>${esc(source.owner || (userAdded ? "Workspace member" : "Brand team"))}</span><span>${esc(automation)}</span>${sourceActions}</div>
  </article>`;
}

function renderLibrary() {
  const builtIn = [...(brandbook.policies || []), ...(brandbook.facts || [])];
  const custom = state.customSources || [];
  $("#source-list").innerHTML = [...builtIn.map((source) => sourceCard(source)), ...custom.map((source) => sourceCard(source, true))].join("");
}

function showSourceForm() {
  const wrap = $("#source-form-wrap");
  wrap.classList.remove("hidden");
  wrap.innerHTML = `<form class="source-form" id="source-form">
    <label>How to use this source<select name="check_type"><option value="claim-evidence">Evidence for a claim</option><option value="restricted-phrase">Flag a restricted phrase</option><option value="required-phrase">Require wording</option><option value="terminology">Correct terminology</option><option value="reference">Reference only</option></select></label>
    <label>Source title<input name="title" maxlength="120" required placeholder="e.g. Hydration study"></label>
    <label>Phrase to check<input name="trigger" maxlength="120" placeholder="e.g. 24-hour hydration"></label>
    <label>Preferred wording<input name="replacement" maxlength="120" placeholder="Optional for terminology"></label>
    <label>Evidence excerpt or rule<textarea name="body" maxlength="5000" required placeholder="Paste the exact approved source passage or rule..."></textarea></label>
    <label>Document<input name="source_document" maxlength="160" placeholder="e.g. Product brief v2"></label>
    <label>Section or page<input name="source_location" maxlength="160" placeholder="e.g. Claims, page 4"></label>
    <label>Severity<select name="severity"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select></label>
    <button class="button primary" type="submit">Save source</button>
    <p class="source-form-help">New rules need approval from a brand manager or legal reviewer. Claim evidence is shown beside findings but is never marked true automatically.</p>
  </form>`;
  $("#source-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const checkType = String(form.get("check_type"));
    const source = {
      id: `LOCAL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      type: "Workspace source",
      check_type: checkType,
      trigger: String(form.get("trigger") || "").trim(),
      replacement: String(form.get("replacement") || "").trim(),
      title: String(form.get("title")).trim(),
      body: String(form.get("body")).trim(),
      source_document: String(form.get("source_document") || "").trim(),
      source_location: String(form.get("source_location") || "").trim(),
      severity: String(form.get("severity") || "medium"),
      approved: false,
      enabled: checkType !== "reference",
      owner: actorName(),
      status: checkType === "reference" ? "Reference only" : "Needs human approval",
      createdAt: now(),
    };
    if (!source.title || !source.body) return;
    if (checkType !== "reference" && !source.trigger) {
      showToast("Add the phrase to check before saving an automated source.");
      $(`[name='trigger']`).focus();
      return;
    }
    if (checkType === "terminology" && !source.replacement) {
      showToast("Add preferred wording for a terminology rule.");
      $(`[name='replacement']`).focus();
      return;
    }
    if (state.customSources.length >= MAX_CUSTOM_SOURCES) {
      showToast(`This demo supports up to ${MAX_CUSTOM_SOURCES} workspace sources.`);
      return;
    }
    state.customSources.unshift(source);
    persist();
    renderLibrary();
    $("#source-form-wrap").classList.add("hidden");
    showToast(checkType === "reference" ? "Reference saved. It will not change automated checks." : "Source saved. A reviewer can approve it in the library.");
  });
  $("[name='title']").focus();
}

function renderActivity() {
  const container = $("#activity-content");
  if (!state.reviews.length) {
    container.innerHTML = `<div class="activity-empty">No reviews yet. Run a brand review to start the audit trail.</div>`;
    return;
  }
  container.innerHTML = state.reviews.map((review) => {
    const status = review.status === "approved" ? "Approved" : review.status === "changes-requested" ? "Changes requested" : "In review";
    const events = (review.events || []).map((event) => `<div class="event-row"><span class="event-marker"></span><div class="event-copy"><strong>${esc(event.action)}</strong> · ${esc(event.actor)}<br>${esc(event.detail)}</div><span class="event-time">${esc(dateLabel(event.at))}</span></div>`).join("");
    return `<article class="activity-card"><div class="activity-card-head" data-open-review="${esc(review.id)}"><div><h3>${esc(review.title)}</h3><p>${esc(review.draft.slice(0, 115))}${review.draft.length > 115 ? "…" : ""} · ${esc(dateLabel(review.createdAt))}</p></div><span class="activity-badge">${status}</span></div><div class="activity-events">${events}</div></article>`;
  }).join("");
  container.querySelectorAll("[data-open-review]").forEach((button) => button.addEventListener("click", () => {
    state.activeId = button.dataset.openReview;
    persist();
    renderReview();
    navigate("review");
  }));
}

function exportHistory() {
  const payload = {
    exportedAt: now(),
    note: "Local demo export. Stored in this browser only; demo role selector is not authentication.",
    reviews: state.reviews,
    manualSources: state.customSources,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "brandproof-review-history.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function uploadFile(file) {
  if (!file) return;
  const message = $("#upload-message");
  message.classList.remove("error");
  message.textContent = `Reading ${file.name}…`;
  const form = new FormData();
  form.append("file", file);
  try {
    const response = await fetch("/api/extract", { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The file could not be read.");
    $("#content-input").value = result.text;
    $("#draft-title").value = file.name.replace(/\.[^.]+$/, "");
    state.draftText = result.text;
    state.draftTitle = $("#draft-title").value;
    updateCharCount();
    message.textContent = `${result.filename} · ${result.characters.toLocaleString()} characters extracted`;
    const review = activeReview();
    if (review && review.status !== "approved") {
      review.draft = result.text;
      review.title = $("#draft-title").value;
      review.updatedAt = now();
    }
    if (review?.status === "approved") {
      state.activeId = null;
      renderReview();
    }
    persist();
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  }
}

function clearLocalData() {
  if (!window.confirm("Clear all BrandProof reviews, manual sources and saved drafts from this browser?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state.reviews.splice(0, state.reviews.length);
  state.customSources.splice(0, state.customSources.length);
  state.activeId = null;
  state.draftTitle = "Spring campaign post";
  state.draftText = "";
  $("#draft-title").value = "Spring campaign post";
  $("#content-input").value = "";
  $("#upload-message").textContent = "";
  persist();
  renderReview();
  renderLibrary();
  showToast("Local demo data cleared.");
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.page)));
  $("#role-select").value = state.role;
  $("#role-select").addEventListener("change", () => {
    state.role = $("#role-select").value;
    persist();
    renderReview();
    renderLibrary();
  });
  $("#content-input").addEventListener("input", () => {
    updateCharCount();
    state.draftText = $("#content-input").value;
    const review = activeReview();
    if (review && review.status !== "approved") {
      review.draft = state.draftText;
      review.updatedAt = now();
    }
    persist();
    renderReview(false);
  });
  $("#draft-title").addEventListener("input", () => {
    state.draftTitle = $("#draft-title").value;
    const review = activeReview();
    if (review && review.status !== "approved") {
      review.title = state.draftTitle;
    }
    persist();
    renderReview(false);
  });
  $("#run-review").addEventListener("click", () => runReview(false));
  $("#rescan").addEventListener("click", () => runReview(true));
  $("#load-sample").addEventListener("click", () => {
    $("#draft-title").value = "Spring campaign post";
    $("#content-input").value = sampleCopy;
    state.draftTitle = "Spring campaign post";
    state.draftText = sampleCopy;
    $("#upload-message").textContent = "Fictional sample copy loaded.";
    updateCharCount();
    const review = activeReview();
    if (review && review.status !== "approved") {
      review.title = "Spring campaign post";
      review.draft = sampleCopy;
      renderReview();
    }
    if (review?.status === "approved") {
      state.activeId = null;
      renderReview();
    }
    persist();
  });
  $("#file-input").addEventListener("change", (event) => uploadFile(event.target.files?.[0]));
  $("#findings-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (button) handleFindingAction(button.dataset.action, Number(button.dataset.index));
  });
  $("#save-edit").addEventListener("click", (event) => {
    event.preventDefault();
    saveEdit();
  });
  $("#approve-review").addEventListener("click", approveReview);
  $("#request-changes").addEventListener("click", requestChanges);
  $("#note-form").addEventListener("submit", saveWorkflowNote);
  ["#cancel-note", "#cancel-note-secondary"].forEach((selector) => $(selector).addEventListener("click", () => {
    pendingNote = null;
    $("#note-dialog").close();
  }));
  $("#add-source").addEventListener("click", showSourceForm);
  $("#source-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-source-action]");
    if (!button) return;
    const source = state.customSources.find((item) => item.id === button.dataset.sourceId);
    if (!source) return;
    if (button.dataset.sourceAction === "remove") {
      if (!window.confirm(`Remove “${source.title}” from the workspace? Past review records keep their saved citations; future scans will no longer use this source.`)) return;
      state.customSources = state.customSources.filter((item) => item.id !== source.id);
      showToast("Source removed from future checks.");
    } else if (button.dataset.sourceAction === "toggle-enabled") {
      source.enabled = source.enabled === false;
      showToast(source.enabled ? "Source check enabled for future reviews." : "Source check paused for future reviews.");
    } else if (button.dataset.sourceAction === "toggle-approval") {
      if (!["manager", "reviewer"].includes($("#role-select").value)) return;
      source.approved = !source.approved;
      source.status = source.approved ? "Approved by workspace" : "Needs human approval";
      source.approvedBy = source.approved ? actorName() : "";
      source.approvedAt = source.approved ? now() : "";
      showToast(source.approved ? "Source approved for this demo workspace." : "Source approval revoked.");
    }
    persist();
    renderLibrary();
  });
  $("#export-history").addEventListener("click", exportHistory);
  $("#clear-data").addEventListener("click", clearLocalData);
  $("#privacy-link").addEventListener("click", () => $("#privacy-dialog").showModal());
  $("#terms-link").addEventListener("click", () => $("#terms-dialog").showModal());
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => {
    const dialog = document.getElementById(button.dataset.closeDialog);
    if (dialog?.open) dialog.close();
  }));
  $("#new-review").addEventListener("click", () => {
    state.activeId = null;
    state.draftTitle = "Spring campaign post";
    state.draftText = "";
    $("#draft-title").value = state.draftTitle;
    $("#content-input").value = "";
    $("#upload-message").textContent = "";
    updateCharCount();
    persist();
    renderReview();
    $("#content-input").focus();
  });
}

async function init() {
  if (launchMode === "sample" || launchMode === "empty") {
    state.activeId = null;
    state.draftTitle = launchMode === "sample" ? "Spring campaign post" : "Untitled review";
    state.draftText = launchMode === "sample" ? sampleCopy : "";
  }
  bindEvents();
  await loadBrandbook();
  updateHistoryCount();
  const saved = activeReview();
  if (saved) renderReview();
  else {
    $("#draft-title").value = state.draftTitle;
    $("#content-input").value = state.draftText;
    updateCharCount();
    renderReview();
  }
}

init();
