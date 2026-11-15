"""Validate and import question groups from the shared Excel workbook.

One workbook is used for both audiences. Column A (``qTDetail``) starts a
question-title group; column B (``Question Detail``) is mapped to
``uniquestion.uQDetail`` or ``ministryquestion.mQDetail`` by the caller's
organization type. Nothing here writes to the database except through the
existing CRUD helpers.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from io import BytesIO
from zipfile import BadZipFile, ZipFile

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy.orm import Session

from app.crud import survey_builder as crud

XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)
TEMPLATE_FILENAME = "dedc-question-import-template.xlsx"
SHEET_NAME = "Questions"
HEADER_TITLE = "qTDetail"
HEADER_QUESTION = "Question Detail"
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_DATA_ROWS = 5000
MAX_ARCHIVE_ENTRIES = 1000
MAX_EXPANDED_BYTES = 50 * 1024 * 1024
MONTH_NAMES = (
    "",
    "ဇန်နဝါရီ",
    "ဖေဖော်ဝါရီ",
    "မတ်",
    "ဧပြီ",
    "မေ",
    "ဇွန်",
    "ဇူလိုင်",
    "ဩဂုတ်",
    "စက်တင်ဘာ",
    "အောက်တိုဘာ",
    "နိုဝင်ဘာ",
    "ဒီဇင်ဘာ",
)


class ImportFileError(ValueError):
    """The uploaded file itself is unusable (extension, size or corruption)."""


@dataclass(frozen=True)
class RowIssue:
    row: int | None
    message: str


@dataclass
class ParsedQuestion:
    row: int
    detail: str


@dataclass
class ParsedGroup:
    row: int
    title: str
    questions: list[ParsedQuestion] = field(default_factory=list)


@dataclass
class ParsedWorkbook:
    groups: list[ParsedGroup]
    errors: list[RowIssue]
    empty_rows: int
    total_questions: int
    duplicate_questions: int
    filename: str

    @property
    def ok(self) -> bool:
        return not self.errors


# ============================================================
# Sample template
# ============================================================

_SAMPLE_ROWS = (
    ("ပညာရေး အခြေခံအဆောက်အအုံ", "ကျောင်းတွင် ဆရာ၊ ဆရာမ မည်မျှ ရှိပါသလဲ။"),
    (None, "ကျောင်းသား မည်မျှ ရှိပါသလဲ။"),
    (None, "သင်ကြားရေး အထောက်အကူပစ္စည်းများ ရှိပါသလဲ။"),
    ("သုတေသန လုပ်ငန်းများ", "သုတေသန လုပ်ငန်းများ ဆောင်ရွက်ပါသလား။"),
    (None, "သုတေသန စာတမ်း မည်မျှ ရှိပါသလဲ။"),
)


def build_template_workbook() -> bytes:
    """Return a one-sheet, two-column .xlsx template with sample rows."""
    book = Workbook()
    sheet = book.active
    sheet.title = SHEET_NAME
    sheet.append([HEADER_TITLE, HEADER_QUESTION])
    for title, detail in _SAMPLE_ROWS:
        sheet.append([title, detail])

    header_fill = PatternFill("solid", fgColor="1556A6")
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(vertical="center")

    sheet.column_dimensions[get_column_letter(1)].width = 34
    sheet.column_dimensions[get_column_letter(2)].width = 72
    for row in sheet.iter_rows(min_row=2):
        row[1].alignment = Alignment(wrap_text=True, vertical="top")
    sheet.freeze_panes = "A2"

    stream = BytesIO()
    book.save(stream)
    return stream.getvalue()


# ============================================================
# Workbook parsing and validation
# ============================================================


def _cell_text(value) -> str:
    """Normalise a cell value without losing Myanmar text."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    return str(value).strip()


def _assert_archive_safe(content: bytes) -> None:
    try:
        with ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            if (
                len(entries) > MAX_ARCHIVE_ENTRIES
                or sum(item.file_size for item in entries) > MAX_EXPANDED_BYTES
            ):
                raise ImportFileError(
                    "Excel ဖိုင်၏ ဖွင့်ထားသော အရွယ်အစား ကြီးလွန်းပါသည်။"
                )
    except BadZipFile as error:
        raise ImportFileError(
            "တင်သွင်းသော ဖိုင်သည် မှန်ကန်သော .xlsx ဖိုင် မဟုတ်ပါ။"
        ) from error


def _load_sheet(content: bytes):
    try:
        workbook = load_workbook(
            BytesIO(content), read_only=True, data_only=True
        )
    except Exception as error:  # openpyxl raises several unrelated types
        raise ImportFileError(
            "Excel ဖိုင်ကို ဖတ်၍ မရပါ။ ဖိုင် ပျက်စီးနေခြင်း သို့မဟုတ် "
            ".xlsx မဟုတ်ခြင်း ဖြစ်နိုင်ပါသည်။"
        ) from error
    return workbook


def parse_question_workbook(
    content: bytes, filename: str = "questions.xlsx"
) -> ParsedWorkbook:
    """Validate the workbook structure and group its question rows."""
    label = (filename or "").strip() or "questions.xlsx"
    if not label.lower().endswith(".xlsx"):
        raise ImportFileError(".xlsx ဖိုင် တစ်ခုသာ တင်သွင်းနိုင်ပါသည်။")
    if not content:
        raise ImportFileError("တင်သွင်းသော ဖိုင် ဗလာ ဖြစ်နေပါသည်။")
    if len(content) > MAX_UPLOAD_BYTES:
        raise ImportFileError("Excel ဖိုင် အရွယ်အစား 5 MB ထက် မကျော်ရပါ။")
    _assert_archive_safe(content)

    workbook = _load_sheet(content)
    try:
        sheets = list(workbook.worksheets)
        if len(sheets) != 1:
            return _result(
                label,
                [],
                [
                    RowIssue(
                        None,
                        "Excel ဖိုင်တွင် အလုပ်စာရွက် (worksheet) တစ်ခုသာ "
                        f"ပါရပါမည်။ ယခု {len(sheets)} ခု တွေ့ရပါသည်။",
                    )
                ],
            )
        rows = list(sheets[0].iter_rows(values_only=True))
    finally:
        workbook.close()

    if not rows:
        return _result(
            label,
            [],
            [
                RowIssue(
                    None,
                    "Excel ဖိုင် ဗလာ ဖြစ်နေပါသည်။ နမူနာ ဖိုင်ကို သုံးပါ။",
                )
            ],
        )

    errors: list[RowIssue] = []
    groups: list[ParsedGroup] = []
    current: ParsedGroup | None = None
    empty_rows = 0
    seen_any_content = False
    first_question_seen = False

    if len(rows) > MAX_DATA_ROWS + 1:
        errors.append(
            RowIssue(
                None,
                f"ဒေတာ အတန်း {MAX_DATA_ROWS} ထက် မကျော်ရပါ။ ဖိုင်ကို ခွဲပြီး "
                "တင်သွင်းပါ။",
            )
        )
        rows = rows[: MAX_DATA_ROWS + 1]

    header = list(rows[0]) if rows else []
    header_title = _cell_text(header[0]) if len(header) > 0 else ""
    header_question = _cell_text(header[1]) if len(header) > 1 else ""
    if any(_cell_text(value) for value in header[2:]):
        errors.append(
            RowIssue(1, "ကော်လံ နှစ်ခုသာ ပါရပါမည်။ အပိုကော်လံများကို ဖယ်ရှားပါ။")
        )
    if header_title != HEADER_TITLE or header_question != HEADER_QUESTION:
        errors.append(
            RowIssue(
                1,
                "ကော်လံ ခေါင်းစဉ်များ မှားနေပါသည်။ ပထမကော်လံတွင် "
                f"“{HEADER_TITLE}”၊ ဒုတိယကော်လံတွင် “{HEADER_QUESTION}” "
                "အတိအကျ ဖြစ်ရပါမည်။",
            )
        )

    for row_number, row in enumerate(rows[1:], start=2):
        values = list(row) + [None, None]
        title = _cell_text(values[0])
        detail = _cell_text(values[1])
        has_extra = any(_cell_text(value) for value in values[2:])
        if has_extra:
            errors.append(
                RowIssue(
                    row_number,
                    "ကော်လံ နှစ်ခုသာ ပါရပါမည်။ ဤအတန်းတွင် အပိုကော်လံ "
                    "အချက်အလက် တွေ့ရပါသည်။",
                )
            )
        if not title and not detail and not has_extra:
            empty_rows += 1
            continue

        seen_any_content = True
        if title:
            current = ParsedGroup(row=row_number, title=title)
            groups.append(current)
            if detail:
                current.questions.append(
                    ParsedQuestion(row=row_number, detail=detail)
                )
                first_question_seen = True
            continue

        if not detail:
            # A row with only formatting or an extra column value.
            continue

        if current is None:
            if not first_question_seen:
                message = (
                    "ပထမဆုံး မေးခွန်းတွင် ခေါင်းစဉ် ဖြစ်ရပါမည်။ "
                    "ကော်လံ A တွင် မေးခွန်း ခေါင်းစဉ် ထည့်ပါ။"
                )
                first_question_seen = True
            else:
                message = (
                    "မေးခွန်း ခေါင်းစဉ် မရှိဘဲ မေးခွန်း ထည့်၍ မရပါ။ "
                    "ကော်လံ A တွင် ခေါင်းစဉ် ထည့်ပါ။"
                )
            errors.append(RowIssue(row_number, message))
            continue

        current.questions.append(ParsedQuestion(row=row_number, detail=detail))

    if not seen_any_content:
        errors.append(
            RowIssue(
                2,
                "ဒေတာ အတန်း မရှိပါ။ နမူနာ ဖိုင်ပါ အတန်းများအတိုင်း မေးခွန်း "
                "ထည့်ပါ။",
            )
        )

    for group in groups:
        if not group.questions:
            errors.append(
                RowIssue(
                    group.row,
                    f"“{group.title}” ခေါင်းစဉ်အောက်တွင် မေးခွန်း မရှိပါ။ "
                    "မေးခွန်း အနည်းဆုံး တစ်ခု ထည့်ပါ။",
                )
            )

    return _result(label, groups, errors, empty_rows=empty_rows)


def _result(
    filename: str,
    groups: list[ParsedGroup],
    errors: list[RowIssue],
    empty_rows: int = 0,
) -> ParsedWorkbook:
    questions = [question for group in groups for question in group.questions]
    counts = Counter(question.detail for question in questions)
    duplicates = sum(count - 1 for count in counts.values() if count > 1)
    errors.sort(key=lambda issue: (issue.row is None, issue.row or 0))
    return ParsedWorkbook(
        groups=groups,
        errors=errors,
        empty_rows=empty_rows,
        total_questions=len(questions),
        duplicate_questions=duplicates,
        filename=filename,
    )


# ============================================================
# Preview and import orchestration
# ============================================================


def describe_year(
    db: Session,
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
) -> dict:
    """Describe the year row the import will use (read-only)."""
    targets = crud.find_years_by_range(
        db, start_year, start_month, end_year, end_month
    )
    period = {
        "start_year": start_year,
        "start_month": start_month,
        "end_year": end_year,
        "end_month": end_month,
        "label": _range_label(start_year, start_month, end_year, end_month),
    }
    if targets:
        target = targets[0]
        return {
            "year_id": target["yID"],
            "exists": True,
            "status": target["status"],
            **period,
        }
    return {
        "year_id": None,
        "exists": False,
        "status": None,
        **period,
    }


def _range_label(
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
) -> str:
    start = f"{MONTH_NAMES[start_month]} {start_year}"
    end = f"{MONTH_NAMES[end_month]} {end_year}"
    return start if start == end else f"{start} – {end}"


def build_preview(
    db: Session,
    parsed: ParsedWorkbook,
    org_type: str,
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
) -> dict:
    """Shape a validated workbook into the preview response contract."""
    return {
        "ok": parsed.ok,
        "filename": parsed.filename,
        "org_type": org_type,
        "start_year": start_year,
        "start_month": start_month,
        "end_year": end_year,
        "end_month": end_month,
        "year": describe_year(
            db, start_year, start_month, end_year, end_month
        ),
        "total_titles": len(parsed.groups),
        "total_questions": parsed.total_questions,
        "duplicate_questions": parsed.duplicate_questions,
        "empty_rows": parsed.empty_rows,
        "groups": [
            {
                "row": group.row,
                "title": group.title,
                "questions": [
                    {"row": question.row, "detail": question.detail}
                    for question in group.questions
                ],
            }
            for group in parsed.groups
        ],
        "errors": [
            {"row": issue.row, "message": issue.message}
            for issue in parsed.errors
        ],
    }


def apply_import(
    db: Session,
    parsed: ParsedWorkbook,
    org_type: str,
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
) -> dict:
    """Insert the parsed groups and their questions as one unit of work."""
    result = crud.import_question_groups(
        db,
        org_type,
        start_year,
        start_month,
        end_year,
        end_month,
        [
            {
                "title": group.title,
                "questions": [question.detail for question in group.questions],
            }
            for group in parsed.groups
        ],
    )
    return {
        "org_type": org_type,
        "start_year": start_year,
        "start_month": start_month,
        "end_year": end_year,
        "end_month": end_month,
        "year_id": result["year_id"],
        "year_created": result["year_created"],
        "year_label": _range_label(
            start_year, start_month, end_year, end_month
        ),
        "total_titles": result["total_titles"],
        "total_questions": result["total_questions"],
    }
