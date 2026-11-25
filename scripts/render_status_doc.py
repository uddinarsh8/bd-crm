from html import escape
from pathlib import Path
import re
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "DEMO_STATUS_AND_EXECUTION_PLAN.md"
OUTPUT = ROOT / "docs" / "BD_CRM_Demo_Status_and_Execution_Plan_Simple.docx"


def run(text: str, bold: bool = False, italic: bool = False, code: bool = False) -> str:
    props = []
    if bold:
        props.append("<w:b/>")
    if italic:
        props.append("<w:i/>")
    if code:
        props.append('<w:rFonts w:ascii="Aptos Mono" w:hAnsi="Aptos Mono"/>')
    rpr = f"<w:rPr>{''.join(props)}</w:rPr>" if props else ""
    return f"<w:r>{rpr}<w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r>"


def inline(text: str) -> str:
    out = []
    pattern = re.compile(r"(\*\*.+?\*\*|`.+?`|\[[^\]]+\]\([^)]+\))")
    for part in pattern.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            out.append(run(part[2:-2], bold=True))
        elif part.startswith("`") and part.endswith("`"):
            out.append(run(part[1:-1], code=True))
        elif part.startswith("["):
            label = part[1:part.index("]")]
            url = part[part.index("(") + 1:-1]
            out.append(run(label) + run(f" ({url})", italic=True))
        else:
            out.append(run(part))
    return "".join(out)


def paragraph(text: str = "", style: str = "Normal", extra: str = "") -> str:
    content = inline(text) if text else ""
    return f'<w:p><w:pPr><w:pStyle w:val="{style}"/>{extra}</w:pPr>{content}</w:p>'


def table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    width = 9360
    col_width = width // max(1, max(map(len, rows)))
    borders = """<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D9DEE8"/><w:left w:val="single" w:sz="4" w:color="D9DEE8"/><w:bottom w:val="single" w:sz="4" w:color="D9DEE8"/><w:right w:val="single" w:sz="4" w:color="D9DEE8"/><w:insideH w:val="single" w:sz="4" w:color="E7EAF0"/><w:insideV w:val="single" w:sz="4" w:color="E7EAF0"/></w:tblBorders>"""
    output = [f'<w:tbl><w:tblPr><w:tblW w:w="{width}" w:type="dxa"/>{borders}<w:tblCellMar><w:top w:w="85" w:type="dxa"/><w:start w:w="100" w:type="dxa"/><w:bottom w:w="85" w:type="dxa"/><w:end w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>']
    for ridx, row in enumerate(rows):
        output.append('<w:tr>')
        for cidx, cell in enumerate(row):
            if ridx == 0:
                fill = "FF3D8B" if cell == "STILL A DEMO" else "0F1B3D"
                shading = f'<w:shd w:fill="{fill}"/>'
                color = '<w:color w:val="FFFFFF"/>'
            else:
                shading = '<w:shd w:fill="F0F2F6"/>' if cidx == 0 else ('<w:shd w:fill="FBFBFC"/>' if ridx % 2 == 0 else '')
                color = '<w:color w:val="0F1B3D"/>' if cidx == 0 else '<w:color w:val="34415F"/>'
            output.append(f'<w:tc><w:tcPr><w:tcW w:w="{col_width}" w:type="dxa"/>{shading}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr>{"<w:b/>" if ridx == 0 else ""}{color}<w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">{escape(cell)}</w:t></w:r></w:p></w:tc>')
        output.append('</w:tr>')
    output.append('</w:tbl>')
    return ''.join(output)


def convert(markdown: str) -> str:
    lines = markdown.splitlines()
    body = []
    i = 0
    in_code = False
    code_lines = []
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            if in_code:
                body.append(paragraph("\n".join(code_lines), "CodeBlock"))
                code_lines, in_code = [], False
            else:
                in_code = True
            i += 1
            continue
        if in_code:
            code_lines.append(line)
            i += 1
            continue
        if line.startswith("|"):
            raw_rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [cell.strip() for cell in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r"[-: ]+", cell or "-") for cell in cells):
                    raw_rows.append(cells)
                i += 1
            body.append(table(raw_rows))
            body.append(paragraph("", "SmallGap"))
            continue
        if line.strip() == "---":
            body.append('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="FF3D8B"/></w:pBdr></w:pPr></w:p>')
        elif line.startswith("# "):
            body.append(paragraph(line[2:], "Title"))
        elif line.startswith("## "):
            body.append(paragraph(line[3:], "Heading1"))
        elif line.startswith("### "):
            body.append(paragraph(line[4:], "Heading2"))
        elif line.startswith("> "):
            body.append(paragraph(line[2:], "Callout"))
        elif line.startswith("- "):
            body.append(paragraph("•  " + line[2:], "ListParagraph"))
        elif re.match(r"^\d+\. ", line):
            body.append(paragraph(line, "ListParagraph"))
        elif line.startswith("**") and line.endswith("**") and line.count("**") == 2:
            body.append(paragraph(line[2:-2], "Subtitle"))
        elif line.strip():
            body.append(paragraph(line, "Normal"))
        i += 1
    section = '''<w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:footerReference w:type="default" r:id="rId4"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="540" w:footer="540" w:gutter="0"/></w:sectPr>'''
    return ''.join(body) + section


styles = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:lang w:val="en-US"/><w:color w:val="25334D"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="130" w:line="280" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="180"/></w:pPr><w:rPr><w:b/><w:color w:val="0F1B3D"/><w:sz w:val="38"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:color w:val="0F1B3D"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="300" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="0F1B3D"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="394662"/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="300"/><w:spacing w:after="70"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:fill="F3F4F7"/><w:spacing w:before="70" w:after="70"/></w:pPr><w:rPr><w:rFonts w:ascii="Aptos Mono" w:hAnsi="Aptos Mono"/><w:sz w:val="17"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Callout"><w:name w:val="Callout"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:fill="FFF0F6"/><w:ind w:left="180" w:right="180"/><w:spacing w:before="140" w:after="180"/></w:pPr><w:rPr><w:b/><w:color w:val="5A2940"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="SmallGap"><w:name w:val="Small Gap"/><w:pPr><w:spacing w:after="80"/></w:pPr></w:style>
</w:styles>'''


document_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://bd-crm-demo.vercel.app" TargetMode="External"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer.xml"/>
</Relationships>'''

header = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="5" w:color="DDE1E9"/></w:pBdr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:color w:val="7C8798"/><w:sz w:val="16"/></w:rPr><w:t>BD CRM  |  DEMO STATUS AND DELIVERY PLAN</w:t></w:r></w:p></w:hdr>'''

footer = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="7C8798"/><w:sz w:val="16"/></w:rPr><w:t>BD CRM project status  •  Page </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>'''

content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/header.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>'''

root_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>'''

core = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>BD CRM Demo Status and Delivery Plan</dc:title><dc:subject>Product scope, current demo status, technology choices, and production execution plan</dc:subject><dc:creator>BD CRM Project Team</dc:creator><cp:keywords>BD CRM, demo, execution plan, architecture</cp:keywords></cp:coreProperties>'''


def main() -> None:
    body = convert(SOURCE.read_text(encoding="utf-8"))
    doc = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{body}</w:body></w:document>'''
    with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("docProps/core.xml", core)
        archive.writestr("word/document.xml", doc)
        archive.writestr("word/styles.xml", styles)
        archive.writestr("word/_rels/document.xml.rels", document_rels)
        archive.writestr("word/header.xml", header)
        archive.writestr("word/footer.xml", footer)
    print(f"Created {OUTPUT}")


if __name__ == "__main__":
    main()
