# RD document files and PDF export

## Author workflow

Open the ellipsis menu and choose the document panel. Create a blank document,
open an existing `.rd` file, or choose a browser-local document to continue editing.
Switching preserves the previous draft. Reloading resumes the active draft. Existing
single-document drafts are migrated into the local document list on first use.
Restore applies to the current document only: its latest file save, import, creation
or publication establishes the restore baseline. It never substitutes another
document from the shared review URL.

Save `.rd` downloads the currently displayed document, including unpublished edits
when editing. Ctrl+S / Cmd+S performs the same action. Downloads use the document
title as a sanitized filename. The browser controls the destination and whether a
repeated filename is replaced or numbered. Saving does not write back silently to
the originally opened file. No OS file association is installed; open `.rd` through
the app. Empty titles are allowed in draft files and require a title to publish.

Local documents are cached in this browser and origin, not in the service database.
Save files before clearing browser data, moving origins, or changing devices. A
storage failure keeps the in-memory documents and displays a save-file warning.
Files contain document text and source formatting only, not comments, publication
history, credentials, reader identity, or other local documents. Imported files
become new local documents and never replace an existing file automatically.

HTML export creates a self-contained, offline editor for the displayed document.
When editing, it exports the draft without feedback. When reading a publication,
it exports that version and its submitted feedback. It excludes other publications,
other drafts, and unsubmitted suggestions. Offline copies do not synchronize.

## Publication boundary

New/open/switch/save/export operations do not publish or change reviewer access.
One service data directory still exposes one latest publication. Publishing a
selected local document adds an immutable version and makes that document the
current review target. Historical notes retain their original versions.

A document whose base version is stale cannot use normal Publish. The explicit
replacement action names the current version and asks the author to confirm that
this draft should replace it. The server still checks that base version atomically;
a concurrent publication produces a conflict, preserving the draft. No notes are
rebased. This file workflow does not provide separate public URLs per local file.

## File format v1

A `.rd` file is UTF-8 JSON, optionally with a UTF-8 BOM, up to 1,000,000 bytes:

```json
{
  "format": "rd",
  "version": 1,
  "document": {
    "title": "Example",
    "titleSize": 38,
    "blocks": [
      {"id": "b1", "type": "p", "font": "serif", "size": 18, "text": "Hello"}
    ]
  }
}
```

Titles allow up to 200 Unicode code points, title sizes 20-64 px. Documents have
1-200 blocks. Block IDs must be nonblank, unique, at most 100 code points, and not
`title`. Import creates fresh internal IDs so untrusted identifiers cannot become
CSS selector fragments or inherited feedback anchors. Block types are `p` or `h2`,
fonts `serif`, `sans`, or `mono`, sizes 12-48 px, and text at most 20,000 code points
per block. Unpaired UTF-16 surrogates are rejected. Unknown fields are ignored and
not retained. Unsupported format versions, malformed JSON and invalid field types
are rejected before the active document changes. HTML is treated as plain text.
Saving validates the same contract; oversized content remains editable and can
be backed up with HTML export before splitting it into smaller `.rd` files.

## PDF conversion

Open the desired `.rd` and choose Export PDF in the ellipsis menu. A right-side
compact panel groups a small paper overview, watermark settings, and one export
action. Watermarks default on and accept up to 120 characters. Six positions place
the text at the left, center, or right of the top or bottom page inset. The small
paper preview follows that position. Turning marks off collapses the text and
position controls while retaining their values. All settings persist in this browser. Continue Export
opens the system print dialog; choose Save as PDF (or Microsoft Print to PDF), A4
portrait. This also works from the standalone HTML editor and reviewer pages.

With watermarks enabled, each page includes the custom text (default:
`DocsBridge: Feedback Made Easier`), a local calendar date, and a clickable
`https://github.com/storyon403-afk/RD` project footer. Turning watermarks off omits
all three. The date stays at the top and moves left when text occupies the upper
right; the project link stays at the bottom, separate from lower watermark text.
Text is rendered literally, never as HTML. The project footer is not a
review URL and does not expose localhost, document routes or tunnel addresses.

The print renderer uses the complete current document, including unpublished edits,
and preserves source font families and sizes. It lays out fixed A4 pages with a
20 mm internal inset, white paper, black text, and selectable text. Grapheme-aware
splitting preserves Chinese/emoji text across pages. Reading zoom, colored paper,
screen pagination, editor controls and feedback are excluded. Headings reserve
space for following text. Watermarks occupy the inset, outside the content area.

Zero CSS printer margins suppress Chromium's built-in date/title/URL decorations,
including when browser headers/footers are enabled. Other browsers or a manually
overridden print setup may require disabling native headers/footers and selecting
A4 with no printer margins. These native dialog settings cannot be changed by the
web app. Canceling printing leaves the editor and draft intact. Browser fonts can
affect line wrapping. This is local browser print-to-PDF, not a headless server
converter, a PDF importer, or PDF editing. No content is uploaded for conversion.
