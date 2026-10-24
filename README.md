# BrandProof — Round 2 MVP

BrandProof is a local, text-first brand governance demo. It checks draft copy against a small fictional brand book, links each finding to the exact source rule, lets a creator apply, edit or dismiss suggestions, and lets a manager or reviewer request changes or record approval.

## Run the demo

Requires Python 3.10 or newer.

```powershell
cd brandproof
python -m pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:8000> for the public introduction, then choose **Try the sample review** to open the workspace with sample copy ready. The workspace is also available directly at <http://127.0.0.1:8000/app>. Findings show exact phrase matches, the cited rule, source location, evidence status and the next step. To try claim evidence, open **Brand library**, add an **Evidence for a claim** source for an exact phrase in the draft, then switch to **Brand manager** and approve it. Return to **Review**, rescan, and confirm the evidence with a rationale. Resolve the remaining findings and re-scan before recording approval. The **Review history** tab keeps the citations, source-set version and decision notes.

PDF and Word file extraction uses `pypdf` and the Python standard library. Supported uploads are `.txt`, `.md`, `.csv`, `.pdf` and `.docx` up to 4 MB. Scanned PDFs that contain only images need OCR and are not supported by this MVP.

## What is implemented

- Public product introduction and local workspace with a complete review-to-decision workflow.
- Deterministic checks for absolute safety/health claims, unsupported superlatives, one terminology mismatch and guarantee-style language.
- Findings include the exact matched phrase, the full sentence, the rule excerpt, a source document/section locator, an evidence status and a concrete next step.
- The sample safety and comparison checks identify the sample evidence gap. User-added claim evidence can be attached to an exact phrase; it remains a human scope check and is never treated as proof automatically.
- Workspace sources can define phrase checks for claim evidence, restricted phrases, required wording or terminology. Sources can be approved by the demo manager/reviewer role, paused, or removed. Reference-only sources stay out of scans.
- Deterministic terminology corrections can be applied. Factual or restricted claims do not receive an automatic rewrite; a reviewer edits them using the cited source and guidance.
- Dismissing a finding or requesting changes requires a reason. Rescans preserve a prior decision only when the same finding and source evidence are unchanged.
- Source changes make the previous scan stale, so approval requires a fresh scan against both the current draft and current source set.
- Accept, edit, mark-not-applicable and evidence-confirmation actions are recorded in the local event history. The reviewer can confirm attached evidence with a rationale, then approve the current draft.
- Local event history and JSON export include review versions, evidence citations and reviewer notes.
- PDF, DOCX and text extraction. Files are handled in memory and are not written to disk by the server.
- The interface includes plain-language privacy and use notes describing local storage behavior and demo limits.

## Technical notes and limits

- Python `ThreadingHTTPServer` serves the interface and a small JSON API. Browser code uses plain JavaScript, HTML and CSS; local storage keeps demo drafts, reviews and manual sources in that browser profile.
- The scanner is deterministic Python phrase matching. User-added sources are sent with each scan request from browser localStorage; the server does not persist them. Phrase matching does not assess semantic entailment, source quality, or whether evidence proves a claim. A human must confirm scope and truth.
- There is no LLM, embedding model, OCR, database, account system or external API in this MVP. The browser demo-role switch is a workflow aid, not authentication or access control.
- The sample brand and product are fictional. The rules are illustrative and are not legal, clinical or regulatory advice. A clean scan is not a compliance guarantee.
- This server binds to `127.0.0.1` by default. It is intended for local judging/demo use and must not be exposed publicly as-is. A public hosted version needs real authentication, server-side persistence, HTTPS and a security review.
- Google Fonts are not required; the interface uses local system fonts and makes no third-party network requests.

## Round 1 plan changes

The Round 1 architecture proposed React/Next.js, FastAPI, PostgreSQL with pgvector, a hosted grounded LLM and embeddings, roles, and a deployed link. To deliver a working end-to-end slice during the build window, this MVP uses a small Python service, deterministic phrase checks and browser-local storage. It does not send draft content to an AI vendor. Semantic evidence assessment, true identity and role enforcement, shared server storage, image/logo checks, insights, redaction and no-external-AI mode remain future work. No user interviews or measured accuracy claims are represented here.

## Round 3 — three substantive improvements

1. **Grounded, evaluated review engine:** retrieve approved source passages for AI-assisted tone and context checks, keep the citation verification gate, and publish per-category precision/recall on a disclosed evaluation set.
2. **Shared, secure approvals:** authenticated team workspaces, real role-based permissions, encrypted server-side storage, version diffs, comments and review queues across users.
3. **Visual and accessibility governance:** inspect image/logo use and accessible contrast/alt text, then provide recurring-issue insights and source-rule clarity signals for brand managers.

## Team and AI disclosure

Round 1 listed these intended roles: Mayank Singh — product/evidence; Arnav Murkherji — backend/AI pipeline; Hardik Sharma — frontend/workflow; Yashika Raghav — data/security/deployment. Confirm actual Round 2 contributions with each teammate before submission. Codex AI assistance was used to implement this demo and prepare the Round 2 summary; no customer data or external AI service is used by the app.
