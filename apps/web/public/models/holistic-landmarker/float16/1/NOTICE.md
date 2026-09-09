# Holistic Landmarker model provenance

This is Google's version 1 float16 Holistic Landmarker task bundle, used for
browser-local geometry tracking of one person's pose, hands, and face. No sign
recognition or identification is implemented.

- Source: <https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task>
- Size: 13,683,609 bytes
- SHA-256: `e2dab61191e2dcd0a15f943d8e3ed1dce13c82dfa597b9dd39f562975a50c3f8`
- Runtime: `@mediapipe/tasks-vision@1.0.1`
- License: Apache License 2.0; see `/licenses/mediapipe/LICENSE`.

Official component model cards identify the model licenses and describe intended
use and limitations:

- [BlazePose GHUM 3D](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- [MediaPipe Face Mesh V2](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf)
- [Hand Tracking Lite/Full](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf)

The upstream model bundle is redistributed unmodified. Output topology is
33 pose points, 478 face points, and 21 points per hand. Geometric estimates are
not calibrated measurements, identity, or recognition results.

MediaPipe software is Copyright Google LLC, licensed under Apache License 2.0.
The model documentation's license statements are used for model provenance;
the website content license is not a substitute for the model license.
