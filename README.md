# Attendance

Meeting and practice roll call for clubs and troops — tap-to-cycle marking,
headcounts per event, and per-member attendance rates so drifting members
surface early.

- **Storage:** D1 (`events`, `records`; one record per (event, member) via
  UNIQUE index + upsert)
- **Access:** both tables `adult_writable` — leaders (adults) mark, everyone
  views. Attendance is group knowledge in a club context.
- **AI:** read-only exports `events`, `records`.

## Develop

```bash
make install
make dev
make test
make build
```
