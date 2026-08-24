# localization-extractor

Finds `t('...')` keys in the source, diffs them against `en.json`, and reports both directions:
keys used but not defined, and keys defined but never used.

Design vocabulary — NNN, Goliath, Sancient, Nobot, Neetmon, Pyron Chrome — is deliberately NOT
extracted for translation. Those are names, not strings (STYLE-GUIDE.md).

`--check` exits non-zero on any mismatch, which is the form CI uses.
