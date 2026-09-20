# ESP Video Deliverable

The latest selected version uses English Aria neural narration and combines
concept diagrams with recorded DEV prototype evidence.

## Files

- [MP4 video](ESP-Governed-Capabilities-Aria.mp4)
- [English SRT captions](ESP-Governed-Capabilities.srt)
- [English WebVTT captions](ESP-Governed-Capabilities.vtt)
- [Narration](narration.md)

Download the MP4 to play it if the GitHub file viewer does not offer playback.

## Verified Properties

- Duration: 104.754687 seconds (1:44.75).
- Format: 1920 x 1080, H.264 video and AAC audio; 30 fps output from 15 fps
  composition samples.
- Voice: `en-US-AriaNeural`, native synthesis speed. No voice cloning or audio
  speed-up was used.
- SHA-256:
  `25d70abda7a243d168896e8ab614638bab5dc304bf1a3e80537d36b8df89496b`.
- Full decoding, black-interval detection and audio-peak checks passed. Twelve
  Edge playback checkpoints passed without media errors. Human full listening
  and final publication approval remain separate.

## Scope And Evidence

The footage represents the ESP DEV release
`a782aa22-b6a7-439d-adee-de5ae4b634d5`, build `jLcP4_9bN_FR_JKdAgxCj`.
The deployment reports `sourceCommit: local`; this is not proof that the current
Git commit produced the deployed application.

The film shows recorded Skill contracts, Plugin bindings, historical software
review evidence and human decisions. Two actual read-only invocation contexts
reuse `get-ticket-status` version `0.1.0` and operation `tickets.get`. A historical
approval and a separate missing-evidence approval block are not a newly executed
approve/reject sequence. The demonstration uses synthetic data and a shared DEV
identity. Excerpts are cropped for readability and use end-frame reading holds.

The four-layer architecture is grounded in the [architecture documentation](../architecture.md):
entry points, ESP governance/execution, Skills/Plugins, and knowledge/business
systems. Broader Copilot integrations remain planned. The film does not establish
an autonomous non-prompt external-action loop, production identity separation or
production readiness.

No controlled manual-versus-ESP comparison has been performed. Reuse and audit
observations are bounded evidence, not measured customer time savings or ROI.

## Repository Hygiene

Only the final MP4, captions and narration are versioned here. Raw recordings,
Speech outputs, browser profiles, local credentials, business responses, audit
exports and submission receipts remain outside this bundle in the ignored
`artifacts/` directory. Rebuildable per-scene video encodings were removed locally;
final videos, source recordings and failure evidence were retained.

Publishing this bundle to GitHub does not upload it to Innovation Studio or
resubmit the project's judging snapshot.
