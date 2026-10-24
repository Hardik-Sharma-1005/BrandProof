from __future__ import annotations

import hashlib
import io
import json
import os
import re
import sys
import zipfile
from email import policy as email_policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
import xml.etree.ElementTree as ET

try:
    from pypdf import PdfReader
except ImportError:  # The app still starts; PDF uploads show a clear setup message.
    PdfReader = None


ROOT = Path(__file__).resolve().parent
MAX_UPLOAD_BYTES = 4 * 1024 * 1024
MAX_TEXT_CHARS = 24_000
RULESET_VERSION = "brandproof-sample-v2"
HOST = os.environ.get("BRANDPROOF_HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))

POLICIES = [
    {
        "id": "BP-C12",
        "type": "Claims policy",
        "title": "Absolute safety and health claims",
        "body": "Absolute safety promises require approved evidence before publication. Health or treatment promises must be reviewed against approved substantiation.",
        "owner": "Legal review",
        "status": "Approved sample rule",
        "source_document": "Acme Skin Sample Brand Standards v1.0",
        "source_location": "Claims and evidence, page 4",
    },
    {
        "id": "BP-C08",
        "type": "Claims policy",
        "title": "Comparative and superlative claims",
        "body": "Comparative or superlative claims require an approved comparison source and a defined comparison set.",
        "owner": "Legal review",
        "status": "Approved sample rule",
        "source_document": "Acme Skin Sample Brand Standards v1.0",
        "source_location": "Claims and evidence, page 5",
    },
    {
        "id": "BP-T03",
        "type": "Style guide",
        "title": "Use US English spelling",
        "body": "Use US English spelling in customer-facing copy. Preferred term: moisturizer.",
        "owner": "Brand team",
        "status": "Approved sample rule",
        "source_document": "Acme Skin Sample Brand Standards v1.0",
        "source_location": "Customer-facing copy, page 8",
    },
    {
        "id": "BP-V01",
        "type": "Voice guide",
        "title": "Evidence-first, calm voice",
        "body": "Keep the voice clear and calm. Avoid guarantees, pressure, and claims that overstate the evidence.",
        "owner": "Brand team",
        "status": "Approved sample rule",
        "source_document": "Acme Skin Sample Brand Standards v1.0",
        "source_location": "Voice and tone, page 2",
    },
]

APPROVED_FACTS = [
    {
        "id": "BP-F01",
        "title": "Sample brand and product",
        "body": "Acme Skin and GlowRepair are fictional demonstration data. GlowRepair is described in the sample as a serum.",
        "owner": "Demo workspace",
        "status": "Fictional sample fact",
        "source_document": "Acme Skin Sample Product Brief v1.0",
        "source_location": "Product overview, page 1",
    },
    {
        "id": "BP-F02",
        "title": "Evidence boundary",
        "body": "The initial sample workspace arrived without clinical, safety, efficacy, or comparative evidence for the sample product. User-added sources are separate records and need human approval before use.",
        "owner": "Demo workspace",
        "status": "Fictional sample fact",
        "source_document": "Acme Skin Sample Evidence Register v1.0",
        "source_location": "Evidence register, page 1",
    },
]

RULES = [
    {
        "id": "BP-C12",
        "category": "Unsupported safety or health claim",
        "severity": "high",
        "pattern": re.compile(
            r"\b(?:100\s*%\s*safe|safe for (?:every|all) skin types?|risk[- ]free|"
            r"guarantee(?:d)?|cures?|heals?)\b",
            re.IGNORECASE,
        ),
        "explanation": "Absolute safety or health wording needs evidence tied to the exact product and use conditions. No matching evidence source is attached to this phrase.",
        "source_excerpt": "Absolute safety promises require approved evidence before publication.",
        "next_step": "Attach approved evidence that covers this exact product, audience, use conditions, and wording, or rewrite the claim more narrowly.",
        "evidence_fact_id": "BP-F02",
        "requires_human_review": True,
    },
    {
        "id": "BP-C08",
        "category": "Comparative claim without proof",
        "severity": "medium",
        "pattern": re.compile(
            r"\b(?:best|#\s*1|number one|most effective|leading|top[- ]rated)\b",
            re.IGNORECASE,
        ),
        "explanation": "A comparative or superlative needs an approved source for this claim and a defined comparison set. No matching evidence source is attached to this phrase.",
        "source_excerpt": "Comparative or superlative claims require an approved comparison source and a defined comparison set.",
        "next_step": "Add the approved comparison study, comparison set, and date, or remove the superiority wording.",
        "evidence_fact_id": "BP-F02",
        "requires_human_review": True,
    },
    {
        "id": "BP-T03",
        "category": "Terminology or spelling mismatch",
        "severity": "low",
        "pattern": re.compile(r"\bmoisturiser\b", re.IGNORECASE),
        "explanation": "The sample brand guide uses US English spelling in customer-facing copy.",
        "source_excerpt": "Use US English spelling in customer-facing copy.",
        "next_step": "Use the preferred US English spelling.",
        "replacement": "moisturizer",
        "requires_human_review": False,
    },
    {
        "id": "BP-V01",
        "category": "Guarantee language",
        "severity": "medium",
        "pattern": re.compile(r"\b(?:always|never|miracle)\b", re.IGNORECASE),
        "explanation": "The sample voice guide asks for calm, evidence-first copy and flags absolute language for review.",
        "source_excerpt": "Avoid guarantees, pressure, and claims that overstate the evidence.",
        "next_step": "Review the sentence for an absolute promise and replace it with a precise, supportable statement.",
        "requires_human_review": True,
    },
]

POLICY_BY_ID = {item["id"]: item for item in POLICIES}
FACT_BY_ID = {item["id"]: item for item in APPROVED_FACTS}

CUSTOM_CHECK_TYPES = {"claim-evidence", "restricted-phrase", "required-phrase", "terminology", "reference"}
MAX_CUSTOM_SOURCES = 100


def split_sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", text) if part.strip()]


def split_sentences_with_offsets(text: str) -> list[tuple[str, int, int]]:
    parts = []
    cursor = 0
    for value in re.split(r"(?<=[.!?])\s+|\n+", text):
        sentence = value.strip()
        if not sentence:
            continue
        start = text.find(sentence, cursor)
        if start < 0:
            continue
        end = start + len(sentence)
        parts.append((sentence, start, end))
        cursor = end
    return parts


def normalize_custom_sources(value) -> tuple[list[dict], int]:
    if not isinstance(value, list):
        return [], 0
    usable = []
    reference_count = 0
    for item in value[:MAX_CUSTOM_SOURCES]:
        if not isinstance(item, dict):
            continue
        check_type = str(item.get("check_type", "reference"))[:32]
        if check_type not in CUSTOM_CHECK_TYPES:
            continue
        if check_type == "reference":
            reference_count += 1
            continue
        if item.get("enabled") is False:
            reference_count += 1
            continue
        trigger = str(item.get("trigger", "")).strip()[:120]
        if not trigger:
            continue
        usable.append({
            "id": str(item.get("id", "LOCAL-SOURCE"))[:64],
            "check_type": check_type,
            "title": str(item.get("title", "Untitled source"))[:120],
            "body": str(item.get("body", ""))[:5000],
            "trigger": trigger,
            "replacement": str(item.get("replacement", ""))[:120].strip(),
            "source_document": str(item.get("source_document", ""))[:160],
            "source_location": str(item.get("source_location", ""))[:160],
            "approved": item.get("approved") is True,
            "approved_by": str(item.get("approvedBy", ""))[:80],
            "approved_at": str(item.get("approvedAt", ""))[:40],
            "enabled": True,
            "severity": item.get("severity") if item.get("severity") in {"high", "medium", "low"} else "medium",
            "owner": str(item.get("owner", "Workspace member"))[:80],
        })
    return usable, reference_count


def scan_text(text: str, custom_sources=None) -> dict:
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Add some copy before starting a review.")
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError(f"Keep a review under {MAX_TEXT_CHARS:,} characters.")

    custom_sources, reference_count = normalize_custom_sources(custom_sources)
    findings = []
    for sentence_index, (sentence, sentence_start, sentence_end) in enumerate(split_sentences_with_offsets(text)):
        triggered = []
        attached_claim_source_ids = set()
        for rule in RULES:
            matches = list(rule["pattern"].finditer(sentence))
            if matches:
                source = POLICY_BY_ID[rule["id"]]
                evidence = FACT_BY_ID.get(rule.get("evidence_fact_id"))
                attached_source = None
                if evidence:
                    for candidate in custom_sources:
                        if candidate["check_type"] != "claim-evidence":
                            continue
                        candidate_matches = list(re.finditer(re.escape(candidate["trigger"]), sentence, re.IGNORECASE))
                        if any(left.start() < right.end() and right.start() < left.end() for left in matches for right in candidate_matches):
                            attached_source = candidate
                            attached_claim_source_ids.add(candidate["id"])
                            break
                if attached_source:
                    evidence_status = "attached-for-human-review" if attached_source["approved"] else "source-needs-approval"
                    evidence_title = attached_source["title"]
                    evidence_excerpt = attached_source["body"][:500]
                    evidence_document = attached_source["source_document"]
                    evidence_location = attached_source["source_location"]
                    evidence_approval_status = "Approved by workspace" if attached_source["approved"] else "Needs human approval"
                    evidence_approved_by = attached_source["approved_by"]
                    evidence_approved_at = attached_source["approved_at"]
                    explanation = "A workspace source is attached to this matched claim. A reviewer must confirm it supports the product, wording, audience, conditions, and timeframe in the draft."
                    next_step = "Open the cited source and check that its scope matches the full claim. Keep the decision with a human reviewer."
                else:
                    evidence_status = "evidence-not-supplied" if evidence else "policy-check"
                    evidence_title = evidence.get("title", "") if evidence else ""
                    evidence_excerpt = evidence.get("body", "") if evidence else ""
                    evidence_document = evidence.get("source_document", "") if evidence else ""
                    evidence_location = evidence.get("source_location", "") if evidence else ""
                    evidence_approval_status = ""
                    evidence_approved_by = ""
                    evidence_approved_at = ""
                    explanation = rule["explanation"]
                    next_step = rule["next_step"]
                triggered.append({
                    "rule_id": rule["id"],
                    "category": rule["category"],
                    "severity": rule["severity"],
                    "explanation": explanation,
                    "next_step": next_step,
                    "source_excerpt": rule["source_excerpt"],
                    "source_title": source["title"],
                    "source_document": source.get("source_document", ""),
                    "source_location": source.get("source_location", ""),
                    "source_status": source.get("status", ""),
                    "source_verified": rule["source_excerpt"] in source["body"],
                    "evidence_status": evidence_status,
                    "evidence_title": evidence_title,
                    "evidence_excerpt": evidence_excerpt,
                    "evidence_document": evidence_document,
                    "evidence_location": evidence_location,
                    "evidence_approval_status": evidence_approval_status,
                    "evidence_approved_by": evidence_approved_by,
                    "evidence_approved_at": evidence_approved_at,
                    "evidence_source_id": attached_source["id"] if attached_source else "",
                    "match_text": matches[0].group(0),
                    "match_spans": [[sentence_start + match.start(), sentence_start + match.end()] for match in matches],
                    "match_method": "Direct phrase rule",
                    "draft_quote": sentence,
                    "requires_human_review": rule.get("requires_human_review", True),
                    "replacement": rule.get("replacement"),
                })
        for source in custom_sources:
            matches = list(re.finditer(re.escape(source["trigger"]), sentence, re.IGNORECASE))
            if not matches:
                continue
            if source["check_type"] == "claim-evidence":
                if source["id"] in attached_claim_source_ids:
                    continue
                category = "Claim has attached evidence"
                explanation = "A source is attached to this phrase. A reviewer must still confirm it supports the product, wording, audience, conditions, and timeframe in the draft."
                evidence_status = "attached-for-human-review" if source["approved"] and source["body"] else "source-needs-approval"
                next_step = "Open the cited source and check that its scope matches the full claim. Keep the decision with a human reviewer."
                severity = source["severity"]
                requires_human_review = True
                replacement = ""
            elif source["check_type"] == "restricted-phrase":
                category = "Restricted phrase"
                explanation = "This phrase matches a workspace rule. Review the source instruction and use the suggested wording if one is provided."
                evidence_status = "workspace-rule"
                next_step = "Remove or revise the phrase according to the source instruction."
                severity = source["severity"]
                requires_human_review = True
                replacement = source["replacement"]
            elif source["check_type"] == "terminology":
                category = "Workspace terminology"
                explanation = "This phrase matches a terminology source added to the workspace."
                evidence_status = "workspace-rule"
                next_step = f"Use the preferred wording: {source['replacement']}" if source["replacement"] else "Confirm the approved terminology with the source owner."
                severity = source["severity"]
                requires_human_review = not source["approved"] or not bool(source["replacement"])
                replacement = source["replacement"]
            else:
                continue
            triggered.append({
                "rule_id": source["id"],
                "category": category,
                "severity": severity,
                "explanation": explanation,
                "next_step": next_step,
                "source_excerpt": source["body"][:500],
                "source_title": source["title"],
                "source_document": source["source_document"],
                "source_location": source["source_location"],
                "source_status": "Approved by workspace" if source["approved"] else "Needs human approval",
                "source_verified": False,
                "evidence_status": evidence_status,
                "evidence_title": source["title"] if source["check_type"] == "claim-evidence" else "",
                "evidence_excerpt": source["body"][:500] if source["check_type"] == "claim-evidence" else "",
                "evidence_document": source["source_document"] if source["check_type"] == "claim-evidence" else "",
                "evidence_location": source["source_location"] if source["check_type"] == "claim-evidence" else "",
                "evidence_approval_status": "Approved by workspace" if source["approved"] else "Needs human approval",
                "evidence_approved_by": source["approved_by"],
                "evidence_approved_at": source["approved_at"],
                "evidence_source_id": source["id"] if source["check_type"] == "claim-evidence" else "",
                "match_text": matches[0].group(0),
                "match_spans": [[sentence_start + match.start(), sentence_start + match.end()] for match in matches],
                "match_method": "Workspace phrase match",
                "draft_quote": sentence,
                "requires_human_review": requires_human_review,
                "replacement": replacement,
            })
        if not triggered:
            continue

        safe_rewrite = sentence
        has_replacement = False
        for item in triggered:
            if item.get("replacement"):
                match_text = item["match_text"]
                safe_rewrite = re.sub(re.escape(match_text), lambda _match: item["replacement"], safe_rewrite, count=0, flags=re.IGNORECASE)
                has_replacement = True
        if any(item.get("requires_human_review") for item in triggered):
            safe_rewrite = None
        elif not has_replacement or safe_rewrite == sentence:
            safe_rewrite = None

        severity_rank = {"high": 3, "medium": 2, "low": 1}
        finding_key = f"{sentence_index}:{','.join(item['rule_id'] for item in triggered)}:{sentence}"
        findings.append({
            "id": hashlib.sha256(finding_key.encode("utf-8")).hexdigest()[:14],
            "quote": sentence,
            "start": sentence_start,
            "end": sentence_end,
            "issues": triggered,
            "severity": max((item["severity"] for item in triggered), key=lambda value: severity_rank[value]),
            "suggested_sentence": safe_rewrite,
            "resolution_note": "",
            "status": "open",
        })

    for source in custom_sources:
        if source["check_type"] != "required-phrase" or re.search(re.escape(source["trigger"]), text, re.IGNORECASE):
            continue
        issue = {
            "rule_id": source["id"],
            "category": "Required wording missing",
            "severity": source["severity"],
            "explanation": "A required phrase configured in this workspace was not found in the draft.",
            "next_step": f"Add the required wording if it applies: {source['trigger']}",
            "source_excerpt": source["body"][:500],
            "source_title": source["title"],
            "source_document": source["source_document"],
            "source_location": source["source_location"],
            "source_status": "Approved by workspace" if source["approved"] else "Needs human approval",
            "source_verified": False,
            "evidence_status": "required-phrase-missing",
            "evidence_title": "",
            "evidence_excerpt": "",
            "evidence_document": "",
            "evidence_location": "",
            "match_text": source["trigger"],
            "match_spans": [],
            "match_method": "Required phrase check",
            "draft_quote": "",
            "requires_human_review": True,
            "replacement": "",
        }
        finding_key = f"required:{source['id']}:{source['trigger']}"
        findings.append({
            "id": hashlib.sha256(finding_key.encode("utf-8")).hexdigest()[:14],
            "quote": "",
            "start": None,
            "end": None,
            "missing_requirement": source["trigger"],
            "issues": [issue],
            "severity": source["severity"],
            "suggested_sentence": None,
            "resolution_note": "",
            "status": "open",
        })

    return {
        "findings": findings,
        "policy_count": len(POLICIES),
        "ruleset_version": RULESET_VERSION,
        "coverage": {
            "built_in_rules": len(RULES),
            "workspace_rules": len(custom_sources),
            "reference_only_sources": reference_count,
            "automated_sources": len(custom_sources),
        },
        "review_note": "Direct phrase rules only. Each attached source needs a human scope check. Sources without an automated rule are reference-only. This scan is not legal advice or a compliance guarantee.",
    }


def extract_docx(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        xml_data = archive.read("word/document.xml")
    root = ET.fromstring(xml_data)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs = []
    for paragraph in root.findall(".//w:p", ns):
        pieces = [node.text or "" for node in paragraph.findall(".//w:t", ns)]
        value = "".join(pieces).strip()
        if value:
            paragraphs.append(value)
    return "\n".join(paragraphs)


def extract_uploaded_text(filename: str, data: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext in {".txt", ".md", ".csv"}:
        return data.decode("utf-8-sig", errors="replace")
    if ext == ".docx":
        return extract_docx(data)
    if ext == ".pdf":
        if PdfReader is None:
            raise ValueError("PDF support needs pypdf. Install the listed requirements and restart the app.")
        reader = PdfReader(io.BytesIO(data))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    raise ValueError("Choose a .txt, .md, .csv, .pdf, or .docx file.")


class Handler(BaseHTTPRequestHandler):
    server_version = "BrandProofDemo/1.0"

    def log_message(self, fmt, *args):
        sys.stdout.write("[BrandProof] " + (fmt % args) + "\n")

    def send_json(self, status: int, value: dict):
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def read_body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0:
            raise ValueError("The request was empty.")
        if length > MAX_UPLOAD_BYTES + 32_000:
            raise ValueError("The upload is larger than the 4 MB limit.")
        return self.rfile.read(length)

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/brandbook":
            return self.send_json(200, {"version": RULESET_VERSION, "policies": POLICIES, "facts": APPROVED_FACTS})
        if path == "/api/health":
            return self.send_json(200, {"ok": True, "mode": "local-demo"})
        if path in {"", "/", "/home"}:
            relative = "landing.html"
        elif path in {"/app", "/app/", "/workspace", "/workspace/", "/review", "/review/"}:
            relative = "index.html"
        else:
            relative = path.lstrip("/")
        file_path = (ROOT / relative).resolve()
        if ROOT not in file_path.parents or not file_path.is_file():
            self.send_error(404, "Not found")
            return
        suffix = file_path.suffix.lower()
        mime = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".md": "text/markdown; charset=utf-8"}.get(suffix, "application/octet-stream")
        payload = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.read_body()
            if path == "/api/review":
                request = json.loads(body.decode("utf-8"))
                if not isinstance(request, dict):
                    raise ValueError("Review request must be a JSON object.")
                result = scan_text(request.get("text", ""), request.get("sources", []))
                return self.send_json(200, result)
            if path == "/api/extract":
                if len(body) > MAX_UPLOAD_BYTES + 32_000:
                    raise ValueError("The upload is larger than the 4 MB limit.")
                content_type = self.headers.get("Content-Type", "")
                envelope = (f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n").encode("utf-8") + body
                message = BytesParser(policy=email_policy.default).parsebytes(envelope)
                upload = next((part for part in message.iter_parts() if part.get_filename()), None)
                if upload is None:
                    raise ValueError("Choose a file to upload.")
                filename = Path(upload.get_filename()).name
                data = upload.get_payload(decode=True) or b""
                if len(data) > MAX_UPLOAD_BYTES:
                    raise ValueError("The upload is larger than the 4 MB limit.")
                extracted = extract_uploaded_text(filename, data)
                if not extracted.strip():
                    raise ValueError("No readable text was found. Scanned PDFs need OCR, which this MVP does not include.")
                if len(extracted) > MAX_TEXT_CHARS:
                    extracted = extracted[:MAX_TEXT_CHARS]
                return self.send_json(200, {"filename": filename, "text": extracted, "characters": len(extracted)})
            return self.send_json(404, {"error": "Route not found."})
        except (ValueError, json.JSONDecodeError, zipfile.BadZipFile, KeyError) as exc:
            return self.send_json(400, {"error": str(exc)})
        except Exception as exc:  # Keep parser failures useful without exposing a traceback to the browser.
            return self.send_json(400, {"error": f"The file could not be read: {exc}"})


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"BrandProof is ready at http://{HOST}:{PORT}")
    print("Local demo only: uploaded files are parsed in memory and are not saved by the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBrandProof stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
