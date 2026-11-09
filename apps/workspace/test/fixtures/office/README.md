# Office fixtures

`nested-ole.pptx` is a Slide deck with pictures and an embedded Office attachment (a DOCX). It
contains only generated test text, no customer files. The exchange integration tests import it
to prove that pictures and attachments become Trunk Assets of the new Unit, that a stored
attachment converts into an online document, and that exports load the Assets back. The file is
shared with the Univer Collaboration SDK exchange tests.
