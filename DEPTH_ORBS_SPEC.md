# Depth Orbs interaction spec

## Reference and project fit

The Craftwork preview and supplied clip show a compact, non-blocking activity indicator made from small dots that vary in apparent depth. The published component page describes discrete CSS orbs and exposes a 1.7-second pulse cycle. BrandProof is plain HTML, CSS, and JavaScript with a Python JSON API; no animation dependency is installed. The implementation will use the same restrained dot motion and rhythm, expressed with BrandProof’s navy, tomato, and butter tokens.

## States and triggers

| State | Trigger | Presentation |
| --- | --- | --- |
| `idle` | Before a scan or after the result has been read | Status region is visually hidden; existing review controls remain available. |
| `loading` | A user starts or reruns a review; immediately before the `/api/review` request | Show the orb indicator and a truthful status message. Disable both scan controls while the request is in flight. |
| `complete` | The review response is accepted and findings are rendered | Stop the animation and announce that findings are ready. The completed state stays until the next scan. |
| `error` | The request or response fails | Stop the animation, show a plain-language status and preserve the existing error details. The user can retry. |

The loader is a reusable `DepthOrbs` helper that accepts a state and label. It is a status display, not a control, so it adds no tab stop. The dots are decorative and hidden from assistive technology; the visible message is announced through `role="status"`, `aria-live="polite"`, and `aria-busy` while loading.

## Motion values

- Main pulse cycle: **1,700 ms**, repeating only in `loading`.
- Each dot rises from rest to its strongest scale and opacity by **28% (476 ms)**, settles back to its resting state by **56% (952 ms)**, then rests until the cycle ends.
- Easing for each active leg: `cubic-bezier(0.66, 0, 0.34, 1)`.
- The cells are phase-shifted across the cluster to create a soft wave; the center begins **180 ms** ahead and outer cells trail by roughly **700 ms** per radial step.
- Enter/exit uses opacity and a 3 px translate over **180 ms** with `cubic-bezier(0.22, 1, 0.36, 1)`. No hover, pointer, or focus motion is added to the loader.
- Motion is CSS-only. Under `prefers-reduced-motion: reduce`, the pulse and entrance transitions stop; a still, legible dot arrangement and status text remain.

## Accessibility and layout

Keep the status readable at 360 px and above, avoid horizontal overflow, keep the scan button’s existing keyboard operation, and preserve visible focus styling. The loading indicator does not trap focus or replace the draft/results content. All animation changes are limited to transform, opacity, and filter.

## Source observations

- The supplied video was downloaded to the temporary `work/` folder and reviewed as a frame sequence.
- The Craftwork page links the preview to Kevin’s original post; the author’s AICSS page was inspected for the published preview timing and the broad dot-pulse behavior.
- This spec records observed motion values, not copied source code. BrandProof uses its own markup, layout, colors, and status copy.
