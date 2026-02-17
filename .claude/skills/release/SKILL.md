---
name: release
description: Run the full release workflow for homebridge-sony-adcp-projector (lint, test, format, pack, publish to npm)
disable-model-invocation: true
---

Run the release workflow:

1. Check `git status` — confirm branch is clean and on master
2. Confirm the version in `package.json` matches the intended release
3. Run `npm run prepublishOnly` (lint + test + fmt)
4. Run `bash publish.sh`
5. Report what was published and remind to push git tags
