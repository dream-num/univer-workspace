# Office fixtures

`nested-ole.pptx` is a Slide deck with pictures and an embedded Office attachment (a DOCX). It
contains only generated test text, no customer files. The exchange integration tests import it
to prove that pictures and attachments become Trunk Assets of the new Unit, that a stored
attachment converts into an online document, and that exports load the Assets back. The file is
shared with the Univer Collaboration SDK exchange tests.

`charts.xlsx` contains generated monthly Revenue/Cost data and two column charts: one on
`Data`, one on `Charts`, both reading `Data!A2:B4` with the series title from `Data!B1`.
Created with Python openpyxl, it contains no customer data. Exchange tests import it through
both HTTP entry points and read persisted collaboration snapshots to check that drawings,
chart ranges and referenced series titles all use the final Workspace Unit ID.
