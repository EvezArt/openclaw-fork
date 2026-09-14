# EVEZ Multimodal and Security Readiness

EVEZ should treat audio, video, images, documents, transcripts, OCR, captions, generated artifacts, and structured data as one evidence graph with typed transformations. A media file is not the conclusion. It is an asset with a hash, rights status, sensitivity class, derived segments, timestamps, model attribution, and lineage.

## Multimodal spine

The `evez-media-spine` tool is the first implementation. It registers a source asset and its attributable segments, including transcripts, OCR, captions, audio events, video events, image regions, and metadata. Each segment can carry a time range, confidence, and source model. A transcript or generated summary can be registered as a derivative of the source asset. Searches return asset and segment references so a later model can explain exactly which media interval supports a statement.

The intended production pipeline is:

1. **Acquire.** Accept only user-owned, licensed, public-domain, or consented media. Record the content hash before interpretation.
2. **Inspect.** Detect MIME type, duration, dimensions, codecs, language, and embedded metadata without trusting embedded instructions.
3. **Extract.** Run speech recognition, diarization, OCR, image understanding, scene or event detection, and metadata extraction as separate attributable workers.
4. **Align.** Attach timestamps, page numbers, bounding regions, confidence, model version, and preprocessing details to every segment.
5. **Normalize.** Store all segments in the media spine and index them through the virtual context broker.
6. **Synthesize.** Generate text, images, audio, or video only from selected evidence windows, preserving source references and declaring generated content.
7. **Verify.** Run Mildred over consequential claims and preserve contradictions instead of smoothing them away.
8. **Export.** Produce a provenance bundle containing source hashes, transformation hashes, model versions, rights, sensitivity, and an audit trail.

This design lets an untrained media pipeline contribute evidence without allowing an untrusted transcript, caption, or image to become an instruction. Generated outputs are derivatives, not replacements for their source.

## Security controls

The minimum lawful defense against stolen intelligence is a layered control plane rather than covert behavior. EVEZ should use least privilege, per-workspace isolation, encryption in transit and at rest, short-lived credentials, hardware-backed or managed secret storage, immutable audit logs, malware scanning, dependency pinning, signed releases, backup and restore tests, deletion workflows, data retention limits, access reviews, and incident response playbooks.

Restricted assets should not be returned through ordinary search. The media spine redacts restricted URIs and segment text by default. Access to restricted content must be separately authorized, logged, and justified by a documented purpose. Unknown rights should block registration for non-public data.

Prompt injection in media is treated as untrusted content. A voice recording, subtitle track, PDF, image, or web page can contain instructions, but those instructions cannot change the agent's authority, reveal secrets, approve a high-impact action, or alter the security policy.

## Certification readiness

EVEZ should not claim “military grade,” OSINT certification, or a security certification until an independent assessor has examined the deployed system and issued a report. The practical readiness path is to map controls to recognized frameworks, choose an applicable scope, collect evidence, remediate findings, and undergo an external assessment.

| Area | Evidence to collect before assessment |
|---|---|
| Governance | System boundary, data inventory, roles, risk register, change control |
| Identity | MFA, least privilege, service identities, access reviews, break-glass procedure |
| Data protection | Classification, encryption, key management, retention and deletion tests |
| Software supply chain | SBOM, dependency review, signed artifacts, reproducible build records |
| Application security | Threat model, abuse cases, prompt-injection tests, SAST/DAST results |
| Operations | Monitoring, alerting, backup/restore drills, capacity and recovery objectives |
| Incident response | Detection, triage, containment, notification, post-incident review |
| Privacy and rights | Consent records, lawful basis, data-subject workflows, provenance and takedown |
| Assurance | Independent penetration test, control-owner signoff, exception register |

Potential mappings include NIST CSF 2.0 for cybersecurity outcomes, NIST AI RMF for AI risk management, ISO/IEC 27001 for an information security management system, ISO/IEC 42001 for an AI management system, and SOC 2 where the service and auditor scope are appropriate. These are assessment targets, not badges EVEZ can self-award.

## Anti-theft posture

EVEZ should make theft expensive and detectable: minimize retained raw media, watermark or fingerprint generated derivatives where appropriate, bind every output to a provenance bundle, monitor unusual export volume, rate-limit bulk access, alert on access from unexpected principals, maintain canary records only where lawful and non-deceptive, and rehearse revocation and recovery. Defensive monitoring must not become surveillance of unrelated people or a license to infiltrate external systems.

## Transparency boundary

The platform should not hide work from journalists, regulators, auditors, users, or affected parties. Quiet engineering is acceptable when it means avoiding unnecessary publicity before a safe release. Concealing material risks, evading oversight, impersonating agencies, or interfering with reporting is not an acceptable security control.
