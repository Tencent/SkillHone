# Upstream sync

The canonical implementation is <https://github.com/Tencent/SkillHone>.
Installing only `SKILL.md` is insufficient because the CLI, DeepSeek Harness
runner, and Web assets live alongside it.

For development, clone the repository and build the TypeScript package:

```bash
git clone https://github.com/Tencent/SkillHone.git
cd SkillHone
pnpm install
pnpm build
npm install -g .
```

For a global installation from `main`, use
`npm install -g --install-links=true git+https://github.com/Tencent/SkillHone.git#main`.
The flag prevents npm from leaving a broken link to its temporary Git clone.
Release `.tgz` files are
precompiled and install with `npm install -g ./skillhone-cli-<version>.tgz`.
Issue/PR state under `SKILLHONE_HOME` remains untouched when the package is updated.
