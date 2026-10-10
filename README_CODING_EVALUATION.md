# AVITECH Coding Evaluation Coverage

The coding bank is classified into explicit question families.

## Scoring
- Logic: 80%
- Syntax/compile: 20%
- Syntax is checked only when Logic > 50/80.
- Correct Code: total score >= 70%.
- Reference source text is never compared for equality.

## Test pattern
- 8 Easy
- 3 Medium
- 3 Hard
- 1 Advanced
- 15 questions total
- Normalized question text cannot repeat within one test.

## Evaluation
Algorithmic families use family-specific logic checks and existing server-side
behavioral tests where a deterministic input/output contract exists.
HTML/CSS/Bootstrap/Tailwind/React/Vanilla JS use semantic/structure checks.
The family map is stored in static/data/coding_evaluation_families.json.
