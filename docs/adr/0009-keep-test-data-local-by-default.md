# Keep test data local by default

Pickle Spec uses user-provided model credentials and keeps test data local by default. It does not persist model prompts, DOM content, or screenshots unless an enabled artifact policy requires them.

The active provider and model remain visible before execution. Redaction runs before supported adapters send or persist sensitive data.
