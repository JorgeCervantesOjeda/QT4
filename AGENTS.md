# QT4 Local Agent Rules

These rules apply to work inside `QT4/` and complement repository-level guidance.

## Encoding and Text Safety (Mandatory)

- Always write text files as UTF-8 without BOM.
- Do not use write methods that may introduce BOM by default.
- Keep encoding consistent when reading and writing the same file.
- Prevent mojibake proactively: preserve valid accents/symbols and avoid mixed encodings.
- If mojibake is introduced in a touched file, fix it before finishing the task.
- Do not commit encoding artifacts (BOM-only diffs or accidental character corruption).
