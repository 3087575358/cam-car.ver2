import json
import sys
from pathlib import Path

import aspose.note as asn

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def page_title(page: asn.Page) -> str:
    try:
        return page.Title.TitleText.Text.strip()
    except Exception:
        return "(untitled)"


def page_text(page: asn.Page) -> list[str]:
    lines: list[str] = []
    for rich_text in page.GetChildNodes(asn.RichText):
        text = rich_text.Text.strip()
        if text:
            lines.append(text)
    return lines


source = Path(sys.argv[1])
document = asn.Document(str(source))
pages = [
    {"title": page_title(page), "text": page_text(page)}
    for page in document
]
print(json.dumps(pages, ensure_ascii=False, indent=2))
