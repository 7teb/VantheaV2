# Skills in VantheaX

A skill is a folder with a SKILL.md. The installed and enabled skills are listed by name and description in the system prompt; read_skill loads the full text of one by its exact name. Disabled and broken skills are not listed.

## SKILL.md format

- The file starts with a YAML frontmatter block between two `---` lines, followed by the body.
- `name` is required, at most 80 characters, and must contain characters usable in a folder name.
- `description` is required, at most 1000 characters. It is sent with every request and tells the agent when to load the skill.
- The body must not be empty.
- SKILL.md may be at most 100 KB (102400 bytes). read_skill returns at most 100000 characters of the body and marks the rest as truncated.
- read_skill names the skill folder on disk (`Skill folder: ...`) and lists extra files: every file directly in the skill folder, then text files (`.md .markdown .txt .json .yaml .yml .css .html .js .mjs .py`) one subfolder deep as `<subfolder>/<file>`, for example `styles/neon_glow.md`. Hidden files, folders starting with a dot, junctions and anything two levels down are not listed; at most 100 entries. read_skill with the same name and `file` set to one of those listed paths returns that file (up to 100 KB). This works in every agent profile and in plan mode, with no approval.

## Where skills live

- User skills: `%APPDATA%\VantheaX\v2\skills`. Install records are kept in `installed.json` in that folder.
- Built-in skills ship with VantheaX in a `skills` folder: `resources\skills` next to the packaged VantheaX.exe, or the `skills` folder of the app in a development run.

## Layout and group folders

Under a skills root a folder is either a skill or a group:

- `<skill>\SKILL.md` is a skill.
- A folder with no SKILL.md directly inside is a group. Its direct subfolders are skills: `<group>\<skill>\SKILL.md`. Example: five effect skills in `designs\glow\SKILL.md`, `designs\grain\SKILL.md` and so on.
- There is exactly one group level. A folder inside a group that has no SKILL.md shows up as a broken entry with the error "no SKILL.md in this folder".
- Folders whose name starts with a dot are ignored.
- Grouping changes nothing about how a skill works. A grouped skill is still found by its name; its internal id is `<group>/<skill>`. Built-in skills have ids starting with `builtin:`.
- Skill names must be unique across all skills, built-in and user, grouped or not. A later duplicate becomes a broken entry "duplicate skill name, already used by <id>", for example a user skill named vantheax shows "duplicate skill name, already used by builtin:vantheax". Precedence: built-in skills first, then skills in the root, then groups in alphabetical order.
- At most 200 skill folders are loaded, built-in ones included and broken entries counted. Folders past the limit (the last groups in alphabetical order) are skipped without a message.

To move a skill into a group, move its folder into the group folder, then open Settings > Skills or press Reload ("Neu einlesen"). Its install record (source, ref, commit) and its enabled state follow the move: a disabled skill stays disabled.

## Built-in skills

Built-in skills ship with the app: `vantheax` gives the agent reliable facts about VantheaX, `effects-lab` in the group `design` builds visual effect pages and composed ads (its scaffold and checker run with python and node from the skill folder and write only into an output folder in the project). They are enabled by default, can be disabled in Settings like any skill, cannot be removed (no remove button, and the app refuses a remove request), and win a name clash against a user skill. Settings lists them first with the label "Built-in" ("Integriert").

## Settings > Skills

- "Skills folder" ("Skill-Ordner") row with a "Reload" ("Neu einlesen") button and "Open folder" ("Ordner öffnen"), which opens the user skills folder in Explorer.
- One row per skill: name, description, the number of extra files, a "Show SKILL.md" ("SKILL.md anzeigen") button, "Remove" ("Entfernen", deletes the folder after a confirmation) and an enable toggle. Broken skills show why they cannot load.
- Built-in skills come first, then root skills, then one section per group with the group name as a small label.

## Installing from chat: install_skill

Only the main agent has install_skill (not in plan mode), and it should be used only when the user asked for a skill to be added. The source can be:

- a GitHub URL: a repository, a folder (`/tree/<ref>/<path>`) or a SKILL.md (`/blob/<ref>/<path>/SKILL.md`). The folder must contain SKILL.md.
- a direct http or https URL to a `.md` or `.markdown` file. Only that file is installed, no extra files.
- an absolute local path to a skill folder or to its SKILL.md.

The user always approves the exact content before anything is written, in every permission mode including full. The approval card asks "May I install this skill?" ("Darf ich diesen Skill installieren?") and shows the name, description, file list, source, the skill it replaces if one exists, and the full SKILL.md.

Where the skill goes:

- If a user skill with the same name already exists, in the root or in a group, the install replaces it in its folder.
- Otherwise the skill goes into the root of the user skills folder, in a folder named after the skill name (lowercase, runs of characters other than letters, digits, `.`, `_` and `-` replaced by `-`, at most 60 characters), and an existing skill folder of that name is replaced.
- An install is refused if the name belongs to a built-in skill or if the folder name matches a group folder.

After a successful install the skill is available at once and can be loaded with read_skill in the same turn.

What gets copied:

- SKILL.md.
- Extra files directly next to SKILL.md whose names end in `.md`, `.markdown`, `.txt`, `.json`, `.yaml` or `.yml`: at most 20, each at most 100 KB (larger ones are skipped), hidden files skipped.
- Nothing from subfolders, and no other file types.

An install is rejected completely if the source folder contains an executable file: `.bat .cjs .cmd .com .dll .exe .jar .js .mjs .msi .ps1 .psm1 .py .rb .scr .sh .vbs .wsf`.

## Installing by hand

1. Settings > Skills > "Open folder" ("Ordner öffnen").
2. Copy the skill folder (with its SKILL.md) into that folder, or into a group folder there.
3. Press "Reload" ("Neu einlesen") in Settings > Skills.

The skill list is rescanned at app start, when Settings > Skills is opened, on Reload, and after an install or remove. A skill folder the agent copies with run_command stays invisible until one of these happens.

A hand-copied skill is used as it is: the executable check of install_skill does not run, and read_skill lists its files as described under SKILL.md format above.

## Skills that refer to files outside their folder

On install, VantheaX copies only SKILL.md and flat text files (see above). If a skill tells the agent to use files that are not in its own folder, VantheaX does not provide them. The user has to put those files into the open project; the agent then reads them with read_file, list_files or grep_files, which take project-relative paths. In a chat without a project that root is `%APPDATA%\VantheaX\v2\workspaces\<chat id>`.
