"""Coverage for the shared Excel question import (Ministry/University).

The workbook contract is one worksheet with exactly two columns:
``qTDetail`` (starts a group) and ``Question Detail`` (one question). These
tests exercise both the pure validator and the admin API, including the
single-transaction guarantee.
"""
from io import BytesIO
import json
import unittest
from unittest.mock import patch

from openpyxl import Workbook, load_workbook
from sqlalchemy import select

from app.admin_auth import COOKIE_NAME
from app.portal_auth import csrf_token
from app.services import question_import as service
from app.services.question_import import (
    ImportFileError,
    build_template_workbook,
    parse_question_workbook,
)
from app.storage.existing import metadata

from test_portal import PortalFixture

HEADERS = ("qTDetail", "Question Detail")


def workbook_bytes(rows, header=HEADERS, sheets=(), title=None):
    book = Workbook()
    sheet = book.active
    if title:
        sheet.title = title
    sheet.append(list(header))
    for row in rows:
        sheet.append(list(row))
    for name in sheets:
        book.create_sheet(name)
    stream = BytesIO()
    book.save(stream)
    return stream.getvalue()


def multipart(fields, filename, content, media="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"):
    boundary = "----dedc-question-import"
    chunks = []
    for name, value in fields.items():
        chunks.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                f"{value}\r\n"
            ).encode("utf-8")
        )
    chunks.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {media}\r\n\r\n"
        ).encode("utf-8")
        + content
        + b"\r\n"
    )
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


class QuestionImportParsingTests(unittest.TestCase):
    def test_template_has_one_sheet_and_two_columns(self):
        book = load_workbook(BytesIO(build_template_workbook()))
        self.addCleanup(book.close)
        self.assertEqual(len(book.worksheets), 1)
        sheet = book.worksheets[0]
        self.assertEqual(sheet.max_column, 2)
        self.assertEqual(
            (sheet["A1"].value, sheet["B1"].value), HEADERS
        )
        self.assertGreater(sheet.max_row, 1)
        self.assertTrue(sheet["A2"].value)
        self.assertTrue(sheet["B2"].value)

    def test_grouping_preserves_order_and_blank_titles_continue_group(self):
        parsed = parse_question_workbook(
            workbook_bytes(
                [
                    ("Teaching", "How many teachers?"),
                    (None, "How many students?"),
                    ("Research", "Any research?"),
                ]
            )
        )
        self.assertTrue(parsed.ok)
        self.assertEqual(
            [group.title for group in parsed.groups], ["Teaching", "Research"]
        )
        self.assertEqual(
            [question.detail for question in parsed.groups[0].questions],
            ["How many teachers?", "How many students?"],
        )
        self.assertEqual(parsed.total_questions, 3)
        self.assertEqual(parsed.duplicate_questions, 0)

    def test_empty_rows_are_consistent_and_do_not_create_records(self):
        parsed = parse_question_workbook(
            workbook_bytes(
                [
                    ("Teaching", "q1"),
                    (None, None),
                    (None, ""),
                    ("Research", "q2"),
                ]
            )
        )
        self.assertTrue(parsed.ok)
        self.assertEqual(parsed.empty_rows, 2)
        self.assertEqual(parsed.total_questions, 2)

    def test_duplicate_question_details_are_counted_but_allowed(self):
        parsed = parse_question_workbook(
            workbook_bytes(
                [
                    ("A", "Same question"),
                    ("B", "Same question"),
                    (None, "Same question"),
                ]
            )
        )
        self.assertTrue(parsed.ok)
        self.assertEqual(parsed.total_questions, 3)
        self.assertEqual(parsed.duplicate_questions, 2)

    def test_identical_titles_stay_as_separate_groups(self):
        parsed = parse_question_workbook(
            workbook_bytes([("Same title", "q1"), ("Same title", "q2")])
        )
        self.assertTrue(parsed.ok)
        self.assertEqual([group.title for group in parsed.groups], ["Same title", "Same title"])
        self.assertEqual(len(parsed.groups), 2)

    def test_first_question_requires_a_title(self):
        parsed = parse_question_workbook(
            workbook_bytes([(None, "Orphan question")])
        )
        self.assertFalse(parsed.ok)
        self.assertEqual(parsed.groups, [])
        self.assertEqual(parsed.errors[0].row, 2)

    def test_title_without_questions_is_reported(self):
        parsed = parse_question_workbook(
            workbook_bytes([("Empty group", None), ("Real", "q1")])
        )
        self.assertFalse(parsed.ok)
        self.assertEqual(parsed.errors[0].row, 2)

    def test_multiple_worksheets_are_rejected(self):
        parsed = parse_question_workbook(
            workbook_bytes([("A", "q1")], sheets=("Extra",))
        )
        self.assertFalse(parsed.ok)
        self.assertIsNone(parsed.errors[0].row)

    def test_extra_column_is_rejected(self):
        parsed = parse_question_workbook(
            workbook_bytes([("A", "q1", "extra")])
        )
        self.assertFalse(parsed.ok)
        self.assertEqual(parsed.errors[0].row, 2)
        parsed = parse_question_workbook(
            workbook_bytes([("A", "q1")], header=HEADERS + ("Extra",))
        )
        self.assertFalse(parsed.ok)
        self.assertEqual(parsed.errors[0].row, 1)

    def test_wrong_header_order_is_rejected(self):
        parsed = parse_question_workbook(
            workbook_bytes([("A", "q1")], header=("Question Detail", "qTDetail"))
        )
        self.assertFalse(parsed.ok)
        self.assertEqual(parsed.errors[0].row, 1)

    def test_header_only_workbook_is_rejected(self):
        parsed = parse_question_workbook(workbook_bytes([]))
        self.assertFalse(parsed.ok)
        self.assertEqual(parsed.errors[0].row, 2)

    def test_non_xlsx_extension_and_corrupt_content_are_rejected(self):
        content = build_template_workbook()
        with self.assertRaises(ImportFileError):
            parse_question_workbook(content, "questions.xls")
        with self.assertRaises(ImportFileError):
            parse_question_workbook(b"not a workbook", "questions.xlsx")
        with self.assertRaises(ImportFileError):
            parse_question_workbook(b"", "questions.xlsx")


class QuestionImportApiTests(PortalFixture):
    persistent_metadata = metadata

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self.login()

    async def request_import(self, path, fields, filename, content):
        body, content_type = multipart(fields, filename, content)
        return await self.request(
            "/api/admin/survey/questions/import/" + path,
            "POST",
            raw_body=body,
            content_type=content_type,
            extra_headers=[
                (b"x-csrf-token", csrf_token(self.cookies[COOKIE_NAME].value).encode())
            ],
            decode=False,
        )

    async def preview(self, fields, filename, content):
        status, headers, body = await self.request_import(
            "preview", fields, filename, content
        )
        return status, headers, json.loads(body) if body else None

    async def confirm(self, fields, filename, content):
        status, headers, body = await self.request_import(
            "confirm", fields, filename, content
        )
        return status, headers, json.loads(body) if body else None

    def rows(self, table):
        with self.sessions() as db:
            return db.native.execute(select(metadata.tables[table])).all()

    async def test_template_download_is_a_two_column_xlsx(self):
        status, headers, body = await self.request(
            "/api/admin/survey/questions/import/template", decode=False
        )
        self.assertEqual(status, 200)
        self.assertIn(b"spreadsheetml", headers[b"content-type"])
        book = load_workbook(BytesIO(body))
        self.addCleanup(book.close)
        self.assertEqual(len(book.worksheets), 1)
        sheet = book.worksheets[0]
        self.assertEqual((sheet["A1"].value, sheet["B1"].value), HEADERS)

    async def test_preview_validates_without_writing(self):
        content = workbook_bytes(
            [
                ("Teaching", "How many teachers?"),
                (None, "How many students?"),
                ("Research", "Any research?"),
                ("Research", "Any research?"),
            ]
        )
        status, _, preview = await self.preview(
            {
                "org_type": "ministry",
                "start_year": "2061",
                "start_month": "1",
                "end_year": "2062",
                "end_month": "12",
            },
            "questions.xlsx",
            content,
        )
        self.assertEqual(status, 200)
        self.assertTrue(preview["ok"])
        self.assertEqual(preview["total_titles"], 3)
        self.assertEqual(preview["total_questions"], 4)
        self.assertEqual(preview["duplicate_questions"], 1)
        self.assertEqual((preview["start_month"], preview["end_month"]), (1, 12))
        self.assertFalse(preview["year"]["exists"])
        self.assertEqual(self.rows("year"), [])
        self.assertEqual(self.rows("questiontitle"), [])
        self.assertEqual(self.rows("ministryquestion"), [])

    async def test_preview_reports_row_errors_and_structure_problems(self):
        status, _, preview = await self.preview(
            {
                "org_type": "university",
                "start_year": "2061",
                "start_month": "4",
                "end_year": "2061",
                "end_month": "4",
            },
            "questions.xlsx",
            workbook_bytes([(None, "Orphan question")]),
        )
        self.assertEqual(status, 200)
        self.assertFalse(preview["ok"])
        self.assertEqual(preview["errors"][0]["row"], 2)
        self.assertEqual(preview["groups"], [])

        status, _, preview = await self.preview(
            {
                "org_type": "university",
                "start_year": "2061",
                "start_month": "4",
                "end_year": "2061",
                "end_month": "4",
            },
            "questions.xlsx",
            workbook_bytes([("A", "q1")], sheets=("Extra",)),
        )
        self.assertEqual(status, 200)
        self.assertFalse(preview["ok"])
        self.assertIsNone(preview["errors"][0]["row"])

    async def test_confirm_imports_ministry_questions_once_and_reuses_year(self):
        content = workbook_bytes(
            [
                ("Teaching", "How many teachers?"),
                (None, "How many students?"),
                ("Research", "Any research?"),
            ]
        )
        fields = {
            "org_type": "ministry",
            "start_year": "2061",
            "start_month": "1",
            "end_year": "2062",
            "end_month": "12",
        }
        status, _, result = await self.confirm(fields, "questions.xlsx", content)
        self.assertEqual(status, 200, result)
        self.assertEqual(result["total_titles"], 2)
        self.assertEqual(result["total_questions"], 3)
        self.assertTrue(result["year_created"])

        years = self.rows("year")
        self.assertEqual(len(years), 1)
        self.assertEqual((years[0].yearFrom.year, years[0].yearTo.year), (2061, 2062))
        self.assertEqual((years[0].yearFrom.month, years[0].yearTo.month), (1, 12))

        titles = self.rows("questiontitle")
        self.assertEqual([title.qTDetail for title in titles], ["Teaching", "Research"])
        ministry = self.rows("ministryquestion")
        self.assertEqual(
            [question.mQDetail for question in ministry],
            ["How many teachers?", "How many students?", "Any research?"],
        )
        self.assertEqual(
            [question.yID for question in ministry], [years[0].yID] * 3
        )
        self.assertEqual(
            [question.qTID for question in ministry],
            [titles[0].qTID, titles[0].qTID, titles[1].qTID],
        )

        status, _, second = await self.confirm(fields, "questions.xlsx", content)
        self.assertEqual(status, 200, second)
        self.assertFalse(second["year_created"])
        self.assertEqual(len(self.rows("year")), 1)
        self.assertEqual(len(self.rows("ministryquestion")), 6)

    async def test_confirm_stores_selected_months_and_reuses_exact_period(self):
        content = workbook_bytes([("Teaching", "How many teachers?")])
        fields = {
            "org_type": "ministry",
            "start_year": "2061",
            "start_month": "3",
            "end_year": "2062",
            "end_month": "9",
        }
        status, _, result = await self.confirm(fields, "questions.xlsx", content)
        self.assertEqual(status, 200, result)
        self.assertEqual((result["start_month"], result["end_month"]), (3, 9))
        years = self.rows("year")
        self.assertEqual(len(years), 1)
        self.assertEqual(
            (years[0].yearFrom.year, years[0].yearFrom.month), (2061, 3)
        )
        self.assertEqual(
            (years[0].yearTo.year, years[0].yearTo.month), (2062, 9)
        )

        other = {
            "org_type": "ministry",
            "start_year": "2061",
            "start_month": "4",
            "end_year": "2062",
            "end_month": "10",
        }
        status, _, second = await self.confirm(other, "questions.xlsx", content)
        self.assertEqual(status, 200, second)
        self.assertTrue(second["year_created"])
        self.assertEqual(len(self.rows("year")), 2)

    async def test_confirm_maps_university_questions_to_uqdetail(self):
        content = workbook_bytes([("Teaching", "How many teachers?")])
        status, _, result = await self.confirm(
            {
                "org_type": "university",
                "start_year": "2065",
                "start_month": "6",
                "end_year": "2065",
                "end_month": "6",
            },
            "questions.xlsx",
            content,
        )
        self.assertEqual(status, 200, result)
        university = self.rows("uniquestion")
        self.assertEqual([question.uQDetail for question in university], ["How many teachers?"])
        self.assertEqual(self.rows("ministryquestion"), [])

    async def test_confirm_keeps_identical_titles_as_separate_groups(self):
        content = workbook_bytes(
            [("Same title", "q1"), ("Same title", "q2"), (None, "q3")]
        )
        status, _, result = await self.confirm(
            {
                "org_type": "ministry",
                "start_year": "2070",
                "start_month": "3",
                "end_year": "2070",
                "end_month": "3",
            },
            "questions.xlsx",
            content,
        )
        self.assertEqual(status, 200, result)
        titles = self.rows("questiontitle")
        self.assertEqual([title.qTDetail for title in titles], ["Same title", "Same title"])
        self.assertEqual(
            [question.mQDetail for question in self.rows("ministryquestion")],
            ["q1", "q2", "q3"],
        )

    async def test_confirm_refuses_invalid_workbook_without_writing(self):
        status, _, body = await self.confirm(
            {
                "org_type": "ministry",
                "start_year": "2061",
                "start_month": "1",
                "end_year": "2061",
                "end_month": "1",
            },
            "questions.xlsx",
            workbook_bytes([("Empty group", None)]),
        )
        self.assertEqual(status, 400)
        self.assertIn("detail", body)
        self.assertEqual(self.rows("questiontitle"), [])
        self.assertEqual(self.rows("ministryquestion"), [])
        self.assertEqual(self.rows("year"), [])

    async def test_confirm_rolls_back_every_insert_on_failure(self):
        content = workbook_bytes([("Teaching", "How many teachers?")])
        original = service.crud.import_question_groups

        def failing_import(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError("simulated database failure")

        with patch.object(service.crud, "import_question_groups", failing_import):
            status, _, body = await self.confirm(
                {
                    "org_type": "ministry",
                    "start_year": "2072",
                    "start_month": "1",
                    "end_year": "2072",
                    "end_month": "1",
                },
                "questions.xlsx",
                content,
            )
        self.assertEqual(status, 500)
        self.assertNotIn("simulated database failure", body["detail"])
        self.assertEqual(self.rows("year"), [])
        self.assertEqual(self.rows("questiontitle"), [])
        self.assertEqual(self.rows("ministryquestion"), [])

    async def test_invalid_period_and_extension_are_rejected(self):
        content = workbook_bytes([("A", "q1")])
        status, _, _ = await self.preview(
            {
                "org_type": "ministry",
                "start_year": "2065",
                "start_month": "1",
                "end_year": "2060",
                "end_month": "12",
            },
            "questions.xlsx",
            content,
        )
        self.assertEqual(status, 400)
        status, _, _ = await self.preview(
            {
                "org_type": "ministry",
                "start_year": "2061",
                "start_month": "12",
                "end_year": "2061",
                "end_month": "1",
            },
            "questions.xlsx",
            content,
        )
        self.assertEqual(status, 400)
        status, _, _ = await self.preview(
            {
                "org_type": "ministry",
                "start_year": "2060",
                "start_month": "13",
                "end_year": "2065",
                "end_month": "12",
            },
            "questions.xlsx",
            content,
        )
        self.assertEqual(status, 400)
        status, _, _ = await self.preview(
            {
                "org_type": "ministry",
                "start_year": "2060",
                "start_month": "1",
                "end_year": "2065",
                "end_month": "0",
            },
            "questions.xlsx",
            content,
        )
        self.assertEqual(status, 400)
        status, _, _ = await self.preview(
            {
                "org_type": "ministry",
                "start_year": "2060",
                "start_month": "1",
                "end_year": "2065",
                "end_month": "12",
            },
            "questions.csv",
            content,
        )
        self.assertEqual(status, 400)
        status, _, _ = await self.preview(
            {
                "org_type": "ministry",
                "start_year": "1800",
                "start_month": "1",
                "end_year": "2065",
                "end_month": "12",
            },
            "questions.xlsx",
            content,
        )
        self.assertEqual(status, 400)

    async def test_oversized_upload_is_rejected(self):
        content = b"0" * (5 * 1024 * 1024 + 1)
        status, _, _ = await self.preview(
            {
                "org_type": "ministry",
                "start_year": "2060",
                "start_month": "1",
                "end_year": "2065",
                "end_month": "12",
            },
            "questions.xlsx",
            content,
        )
        self.assertEqual(status, 413)

    async def test_unauthenticated_import_endpoints_are_denied(self):
        self.cookies.clear()
        content = workbook_bytes([("A", "q1")])
        for path in ("preview", "confirm"):
            status, _, _ = await self.request(
                "/api/admin/survey/questions/import/" + path,
                "POST",
                raw_body=b"",
                content_type="application/json",
                decode=False,
            )
            self.assertEqual(status, 401)
        status, _, _ = await self.request(
            "/api/admin/survey/questions/import/template", decode=False
        )
        self.assertEqual(status, 401)


if __name__ == "__main__":
    unittest.main()
