# Importing a skill

Status: draft. SB5 finalizes external source resolution and server-side copying.
This connection currently accepts text files through `skill_draft_create`; it cannot
resolve a hub, Git repository, uploaded archive or folder into a pinned import.
Explain that limitation before attempting an import. Do not invent a source-reading
tool or pass unsupported source arguments to the draft tool.

If the user supplies the complete text files in the conversation, review them as
material with `references/review.md`, adapt them with `references/authoring.md` and
`references/workspace.md`, then save with `files` as step 7 describes. Explain that
this is a text adaptation, without a server-resolved source record or binary copy.

## Policy for SB5

The intended choices are an as-is copy or an adaptation. An as-is import will copy
all files from a pinned source. The server will stamp the source record in the
entry file's metadata. Do not copy or override that file merely to add metadata.
An adaptation will override only files whose instructions need changing. Preserve
license and notice files and explain any unavailable steps. The user chooses the
destination and publishes the resulting draft, as for a newly authored Skill.
