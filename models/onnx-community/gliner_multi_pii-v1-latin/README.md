# gliner_multi_pii-v1, Latin-script vocabulary

A modified copy of [urchade/gliner_multi_pii-v1](https://huggingface.co/urchade/gliner_multi_pii-v1)
(Apache-2.0), fp16 ONNX export. Changed by The Holler / KVEC in September 2026.

The only change is the vocabulary. Pieces that contain letters outside the Latin
alphabet were removed (135,933 of 250,101 pieces kept), with their rows of the
embedding table, and the token numbers were renumbered to match. No weight was
retrained or rounded. English and other Latin-alphabet text reads exactly as it
did in the original. Other scripts now read as unknown.

Rebuild it with `tools/trim-deep-model.py`, which also explains the details.
The model is split into five slices because GitHub caps a file at 100 MB.
