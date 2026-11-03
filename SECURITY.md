# Security Policy

FreeDictate records microphone audio and pastes text, so security reports matter.

## Reporting

Please do **not** open a public issue. Report privately through
[GitHub private vulnerability reporting](https://github.com/owenmonagan/freedictate/security/advisories/new).
Include steps to reproduce and the affected version or commit. Expect an acknowledgment
within a few days.

## Scope

- Anything that sends audio or text off the machine
- The local `whisper-server` being reachable from outside `127.0.0.1`
- Temporary audio files or clipboard contents being exposed
- The install and uninstall scripts

Only the latest `main` is supported.
