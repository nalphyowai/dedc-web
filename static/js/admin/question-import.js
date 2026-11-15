/**
 * Excel question import wizard for the "စစ်တမ်းများ" dashboard page.
 *
 * Ministry and University share one two-column workbook
 * (qTDetail | Question Detail). The server validates the workbook and
 * maps "Question Detail" to mQDetail / uQDetail; this module only drives
 * the steps and renders the preview it receives.
 */
import { api } from "./api.js";
import { escape as e, label, modal, toast, busy, errorMessage } from "./ui.js";

const TEMPLATE_URL = "/api/admin/survey/questions/import/template";
const PREVIEW_URL = "/survey/questions/import/preview";
const CONFIRM_URL = "/survey/questions/import/confirm";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const STEPS = ["အမျိုးအစား", "ကာလ", "ဖိုင်", "စစ်ဆေးမှု"];
const MONTH_NAMES = ["", "ဇန်နဝါရီ", "ဖေဖော်ဝါရီ", "မတ်", "ဧပြီ", "မေ", "ဇွန်", "ဇူလိုင်", "ဩဂုတ်", "စက်တင်ဘာ", "အောက်တိုဘာ", "နိုဝင်ဘာ", "ဒီဇင်ဘာ"];
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-9"/></svg>';
const DOWNLOAD_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14"/></svg>';
const UPLOAD_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V9m0 0 4 4m-4-4-4 4M5 4h14"/></svg>';
const FILE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M9 12h6M9 16h6"/></svg>';

const UNIVERSITY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 9l9-5 9 5-9 5-9-5z"/><path d="M7 11v5c0 1 2.2 3 5 3s5-2 5-3v-5"/><path d="M21 9v5"/></svg>';
const MINISTRY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 11h.01M15 11h.01"/></svg>';

let state = null;

function stepsHTML(active) {
  const items = STEPS.map((text, index) => {
    const step = index + 1;
    const stateClass =
      step < active ? " is-done" : step === active ? " is-active" : "";
    return `<li class="wizard-steps__item${stateClass}"${
      step === active ? ' aria-current="step"' : ""
    }><span class="wizard-steps__dot">${
      step < active ? CHECK_ICON : step
    }</span><span class="wizard-steps__label">${text}</span></li>`;
  });
  return `<ol class="wizard-steps qi-steps">${items.join(
    '<li class="wizard-steps__sep" aria-hidden="true"></li>',
  )}</ol>`;
}

function title(text) {
  const node = document.querySelector("#dialog-title");
  if (node) node.textContent = text;
}

function orgName(orgType) {
  return label(orgType) || "";
}

function monthOptions(selected) {
  return MONTH_NAMES.map((name, month) =>
    month
      ? `<option value="${month}"${month === selected ? " selected" : ""}>${name}</option>`
      : "",
  ).join("");
}

function monthLabel(month, year) {
  return `${MONTH_NAMES[month] || ""} ${year}`.trim();
}

function periodLabel() {
  const start = monthLabel(state.startMonth, state.startYear);
  const end = monthLabel(state.endMonth, state.endYear);
  return start === end ? start : `${start} – ${end}`;
}

function defaultState() {
  const now = new Date();
  return {
    orgType: null,
    startYear: now.getFullYear(),
    startMonth: now.getMonth() + 1,
    endYear: now.getFullYear(),
    endMonth: now.getMonth() + 1,
    file: null,
    preview: null,
  };
}

export function openQuestionImport() {
  state = defaultState();
  const dialog = modal("Excel မှ မေးခွန်း တင်သွင်းရန်", "");
  dialog.dataset.variant = "import-wizard";
  renderOrgStep(dialog);
}

function renderOrgStep(dialog) {
  title("Excel မှ မေးခွန်း တင်သွင်းရန်");
  const content = dialog.querySelector("#dialog-content");
  content.innerHTML = `
    ${stepsHTML(1)}
    <div class="survey-wizard qi-wizard">
      <p class="dialog-intro">မည်သည့် ဖြေဆိုသူအုပ်စုအတွက် မေးခွန်းများ တင်သွင်းမည်ကို ရွေးပါ။ ရွေးချယ်မှုအပေါ် မူတည်၍ မေးခွန်းများကို သက်ဆိုင်ရာ စစ်တမ်းတွင် သိမ်းဆည်းပါမည်။</p>
      <div class="survey-audience-grid">
        <button class="survey-audience-card" type="button" data-import-org="university">
          <span class="survey-audience-icon" aria-hidden="true">${UNIVERSITY_ICON}</span>
          <strong>တက္ကသိုလ်</strong>
          <span>တက္ကသိုလ်များအတွက် မေးခွန်းများ တင်သွင်းပါ</span>
        </button>
        <button class="survey-audience-card" type="button" data-import-org="ministry">
          <span class="survey-audience-icon" aria-hidden="true">${MINISTRY_ICON}</span>
          <strong>ဝန်ကြီးဌာန</strong>
          <span>ဝန်ကြီးဌာနများအတွက် မေးခွန်းများ တင်သွင်းပါ</span>
        </button>
      </div>
    </div>`;
  content.querySelectorAll("[data-import-org]").forEach((button) => {
    button.onclick = () => {
      state.orgType = button.dataset.importOrg;
      renderYearStep(dialog);
    };
  });
}

function renderYearStep(dialog) {
  title("စစ်တမ်း ကာလ ရွေးချယ်ရန်");
  const content = dialog.querySelector("#dialog-content");
  content.innerHTML = `
    ${stepsHTML(2)}
    <div class="survey-wizard qi-wizard">
      <div class="survey-wizard-summary">
        <span>အမျိုးအစား <strong>${e(orgName(state.orgType))}</strong></span>
      </div>
      <p class="dialog-intro">တင်သွင်းမည့် မေးခွန်းများအတွက် စတင်လ/ခုနှစ်နှင့် ပြီးဆုံးလ/ခုနှစ်ကို ရွေးပါ။ ရွေးချယ်ထားသော ကာလသည် တင်သွင်းမည့် မေးခွန်းအားလုံးအတွက် အသုံးပြုပါမည်။</p>
      <div class="wizard-range qi-range">
        <div class="wizard-range__end">
          <span class="wizard-range__tag">စတင်ကာလ</span>
          <div class="wizard-range__fields">
            <label class="wizard-field"><span>လ</span><select name="import-start-month">${monthOptions(state.startMonth)}</select></label>
            <label class="wizard-field"><span>ခုနှစ်</span><input type="number" name="import-start-year" min="1900" max="2100" step="1" inputmode="numeric" value="${state.startYear}" required></label>
          </div>
        </div>
        <span class="wizard-range__arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
        <div class="wizard-range__end">
          <span class="wizard-range__tag">ပြီးဆုံးကာလ</span>
          <div class="wizard-range__fields">
            <label class="wizard-field"><span>လ</span><select name="import-end-month">${monthOptions(state.endMonth)}</select></label>
            <label class="wizard-field"><span>ခုနှစ်</span><input type="number" name="import-end-year" min="1900" max="2100" step="1" inputmode="numeric" value="${state.endYear}" required></label>
          </div>
        </div>
      </div>
      <p class="qi-hint">ဤကာလအတွက် စစ်တမ်း ကာလ မရှိသေးပါက တင်သွင်းချိန်တွင် မူကြမ်း အဖြစ် အလိုအလျောက် ဖန်တီးပါမည်။</p>
      <div class="survey-wizard-actions">
        <button class="button" type="button" data-back>နောက်သို့</button>
        <div class="right"><button class="button primary" type="button" data-next>ဆက်လုပ်ရန်</button></div>
      </div>
    </div>`;

  const startMonth = content.querySelector('[name="import-start-month"]');
  const startInput = content.querySelector('[name="import-start-year"]');
  const endMonth = content.querySelector('[name="import-end-month"]');
  const endInput = content.querySelector('[name="import-end-year"]');
  [startMonth, startInput, endMonth, endInput].forEach((field) => {
    field.oninput = () => field.setCustomValidity("");
    field.onchange = () => field.setCustomValidity("");
  });
  content.querySelector("[data-back]").onclick = () => renderOrgStep(dialog);
  content.querySelector("[data-next]").onclick = () => {
    const start = Number(startInput.value);
    const startMonthValue = Number(startMonth.value);
    const end = Number(endInput.value);
    const endMonthValue = Number(endMonth.value);
    if (!Number.isInteger(start) || start < 1900 || start > 2100) {
      startInput.setCustomValidity("စတင်ခုနှစ်ကို 1900 မှ 2100 အတွင်း ထည့်ပါ။");
      startInput.reportValidity();
      return;
    }
    if (
      !Number.isInteger(startMonthValue) ||
      startMonthValue < 1 ||
      startMonthValue > 12
    ) {
      startMonth.setCustomValidity("စတင်လကို 1 မှ 12 အတွင်း ရွေးပါ။");
      startMonth.reportValidity();
      return;
    }
    if (!Number.isInteger(end) || end < 1900 || end > 2100) {
      endInput.setCustomValidity("ပြီးဆုံးခုနှစ်ကို 1900 မှ 2100 အတွင်း ထည့်ပါ။");
      endInput.reportValidity();
      return;
    }
    if (
      !Number.isInteger(endMonthValue) ||
      endMonthValue < 1 ||
      endMonthValue > 12
    ) {
      endMonth.setCustomValidity("ပြီးဆုံးလကို 1 မှ 12 အတွင်း ရွေးပါ။");
      endMonth.reportValidity();
      return;
    }
    if (
      start > end ||
      (start === end && startMonthValue > endMonthValue)
    ) {
      endMonth.setCustomValidity("စတင်ကာလသည် ပြီးဆုံးကာလထက် မကြီးရပါ။");
      endMonth.reportValidity();
      return;
    }
    state.startYear = start;
    state.startMonth = startMonthValue;
    state.endYear = end;
    state.endMonth = endMonthValue;
    renderFileStep(dialog);
  };
}

function fileSizeLabel(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function renderFileStep(dialog) {
  title("Excel ဖိုင် ရွေးချယ်ရန်");
  const content = dialog.querySelector("#dialog-content");
  const selected = state.file;
  content.innerHTML = `
    ${stepsHTML(3)}
    <div class="survey-wizard qi-wizard">
      <div class="survey-wizard-summary">
        <span>အမျိုးအစား <strong>${e(orgName(state.orgType))}</strong></span>
        <span>ကာလ <strong>${e(periodLabel())}</strong></span>
      </div>
      <p class="dialog-intro">တက္ကသိုလ်နှင့် ဝန်ကြီးဌာန နှစ်မျိုးလုံးအတွက် တူညီသော နမူနာ ဖိုင်ကို အသုံးပြုပါ။ ပထမကော်လံတွင် မေးခွန်း ခေါင်းစဉ်၊ ဒုတိယကော်လံတွင် မေးခွန်း စာသား ထည့်ပါ။</p>
      <div class="qi-template">
        <div class="qi-template__body">
          <strong>နမူနာ Excel ဖိုင်</strong>
          <span>ကော်လံ နှစ်ခု — မေးခွန်း ခေါင်းစဉ် နှင့် မေးခွန်း စာသား</span>
        </div>
        <a class="button" href="${TEMPLATE_URL}" download>${DOWNLOAD_ICON}<span>နမူနာ ဒေါင်းလုဒ်</span></a>
      </div>
      <label class="qi-drop${selected ? " has-file" : ""}" data-import-drop>
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-import-file aria-label="Excel .xlsx ဖိုင် ရွေးချယ်ရန်">
        <span class="qi-drop__icon" aria-hidden="true">${selected ? FILE_ICON : UPLOAD_ICON}</span>
        <strong>${selected ? "အခြား ဖိုင် ရွေးချယ်ရန်" : "Excel ဖိုင် ရွေးချယ်ရန်"}</strong>
        <span>ဤနေရာသို့ ဖိုင်ကို ဆွဲချနိုင်သည် သို့မဟုတ် နှိပ်၍ ရွေးပါ</span>
        <span class="qi-drop__file" data-import-filename ${selected ? "" : "hidden"}>${selected ? e(selected.name) : ""}${selected ? ` · ${fileSizeLabel(selected.size)}` : ""}</span>
      </label>
      <p class="qi-error" data-import-file-error hidden></p>
      <p class="qi-hint">.xlsx ဖိုင် တစ်ခုသာ လက်ခံပါသည်။ အများဆုံး 5 MB။</p>
      <div class="survey-wizard-actions">
        <button class="button" type="button" data-back>နောက်သို့</button>
        <div class="right"><button class="button primary" type="button" data-check>ဖိုင် စစ်ဆေးရန်</button></div>
      </div>
    </div>`;

  const input = content.querySelector("[data-import-file]");
  const drop = content.querySelector("[data-import-drop]");
  const filename = content.querySelector("[data-import-filename]");
  const errorNode = content.querySelector("[data-import-file-error]");
  const checkButton = content.querySelector("[data-check]");

  const setFileError = (message) => {
    if (!message) {
      errorNode.hidden = true;
      errorNode.textContent = "";
      return;
    }
    errorNode.hidden = false;
    errorNode.textContent = message;
  };

  const applyFile = (file) => {
    setFileError("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      state.file = null;
      setFileError("Excel .xlsx ဖိုင် တစ်ခုသာ တင်သွင်းနိုင်ပါသည်။");
      return;
    }
    if (!file.size) {
      state.file = null;
      setFileError("ရွေးချယ်ထားသော ဖိုင် ဗလာ ဖြစ်နေပါသည်။");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      state.file = null;
      setFileError("Excel ဖိုင် အရွယ်အစား 5 MB ထက် မကျော်ရပါ။");
      return;
    }
    state.file = file;
    filename.hidden = false;
    filename.textContent = `${file.name} · ${fileSizeLabel(file.size)}`;
    drop.classList.add("has-file");
    drop.querySelector(".qi-drop__icon").innerHTML = FILE_ICON;
    drop.querySelector("strong").textContent = "အခြား ဖိုင် ရွေးချယ်ရန်";
  };

  input.onchange = () => applyFile(input.files?.[0]);
  ["dragenter", "dragover"].forEach((eventName) => {
    drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    drop.addEventListener(eventName, () => drop.classList.remove("is-dragging"));
  });
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) applyFile(file);
  });

  content.querySelector("[data-back]").onclick = () => renderYearStep(dialog);

  checkButton.onclick = () => {
    if (!state.file) {
      setFileError("Excel .xlsx ဖိုင် တစ်ခု ရွေးချယ်ပါ။");
      return;
    }
    setFileError("");
    busy(checkButton, async () => {
      const body = new FormData();
      body.append("org_type", state.orgType);
      body.append("start_year", String(state.startYear));
      body.append("start_month", String(state.startMonth));
      body.append("end_year", String(state.endYear));
      body.append("end_month", String(state.endMonth));
      body.append("file", state.file, state.file.name);
      try {
        const preview = await api(PREVIEW_URL, { method: "POST", body });
        state.preview = preview;
        renderReviewStep(dialog, preview);
      } catch (error) {
        setFileError(error.message);
      }
    });
  };
}

function renderReviewStep(dialog, preview) {
  title("တင်သွင်းမှု စစ်ဆေးရန်");
  const content = dialog.querySelector("#dialog-content");
  const errors = Array.isArray(preview.errors) ? preview.errors : [];
  const groups = Array.isArray(preview.groups) ? preview.groups : [];
  const ok = Boolean(preview.ok);
  const year = preview.year || {};
  const yearBadge = year.exists
    ? '<span class="qi-badge qi-badge--existing">ရှိပြီးသား စစ်တမ်း ကာလ</span>'
    : '<span class="qi-badge qi-badge--new">စစ်တမ်း ကာလ အသစ်</span>';

  content.innerHTML = `
    ${stepsHTML(4)}
    <div class="survey-wizard qi-wizard">
      <div class="survey-wizard-summary">
        <span>အမျိုးအစား <strong>${e(orgName(preview.org_type))}</strong></span>
        <span>ကာလ <strong>${e(year.label || periodLabel())}</strong></span>
        ${yearBadge}
      </div>
      <p class="dialog-intro">တင်သွင်းမည့် မေးခွန်းများကို အောက်တွင် စစ်ဆေးပါ။ အတည်ပြုသည့်အခါမှ သိမ်းဆည်းပါမည်။</p>
      ${
        ok
          ? ""
          : `<div class="qi-errors" role="alert">
              <h3>ဖိုင် စစ်ဆေးမှု မအောင်မြင်ပါ — အောက်ပါချက်များကို ပြင်ဆင်ပါ</h3>
              <ul>${errors
                .map(
                  (issue) =>
                    `<li>${
                      issue.row ? `<strong>အတန်း ${issue.row}:</strong> ` : ""
                    }${e(issue.message)}</li>`,
                )
                .join("")}</ul>
            </div>`
      }
      <div class="qi-counts">
        <div><strong>${Number(preview.total_titles || 0).toLocaleString()}</strong><span>မေးခွန်း ခေါင်းစဉ်</span></div>
        <div><strong>${Number(preview.total_questions || 0).toLocaleString()}</strong><span>မေးခွန်း</span></div>
        <div><strong>${Number(preview.duplicate_questions || 0).toLocaleString()}</strong><span>ထပ်နေသော မေးခွန်း</span></div>
      </div>
      ${
        groups.length
          ? `<div class="qi-preview" tabindex="0" role="region" aria-label="တင်သွင်းမည့် မေးခွန်း ခေါင်းစဉ်များ">
              ${groups
                .map(
                  (group) => `<section class="qi-group">
                    <header>
                      <span class="qi-group__row">အတန်း ${group.row}</span>
                      <h3>${e(group.title)}</h3>
                      <span class="qi-group__count">${group.questions.length}</span>
                    </header>
                    <ol>${group.questions
                      .map((question) => `<li>${e(question.detail)}</li>`)
                      .join("")}</ol>
                  </section>`,
                )
                .join("")}
            </div>`
          : ""
      }
      <div class="dialog-actions qi-actions">
        <button class="button" type="button" data-back>ဖိုင် ပြန်ရွေးရန်</button>
        <button class="button primary" type="button" data-confirm ${ok ? "" : "disabled"}>အတည်ပြု၍ တင်သွင်းရန်</button>
      </div>
    </div>`;

  content.querySelector("[data-back]").onclick = () => renderFileStep(dialog);
  const confirmButton = content.querySelector("[data-confirm]");
  confirmButton.onclick = () => {
    busy(confirmButton, async () => {
      const body = new FormData();
      body.append("org_type", state.orgType);
      body.append("start_year", String(state.startYear));
      body.append("start_month", String(state.startMonth));
      body.append("end_year", String(state.endYear));
      body.append("end_month", String(state.endMonth));
      body.append("file", state.file, state.file.name);
      try {
        const result = await api(CONFIRM_URL, { method: "POST", body });
        renderResultStep(dialog, result);
      } catch (error) {
        errorMessage(error);
      }
    });
  };
}

function renderResultStep(dialog, result) {
  title("တင်သွင်းမှု ပြီးစီးပါပြီ");
  const content = dialog.querySelector("#dialog-content");
  content.innerHTML = `
    <div class="qi-result">
      <span class="qi-result__icon" aria-hidden="true">${CHECK_ICON}</span>
      <h3>မေးခွန်းများ တင်သွင်းမှု အောင်မြင်ပါသည်</h3>
      <p class="qi-result__intro">အောက်ပါ အချက်အလက်များကို သိမ်းဆည်းပြီးပါပြီ။</p>
      <dl class="qi-result__facts">
        <div><dt>အမျိုးအစား</dt><dd>${e(orgName(result.org_type))}</dd></div>
        <div><dt>ကာလ</dt><dd>${e(result.year_label || periodLabel())}</dd></div>
        <div><dt>မေးခွန်း ခေါင်းစဉ်</dt><dd>${Number(result.total_titles || 0).toLocaleString()}</dd></div>
        <div><dt>မေးခွန်း</dt><dd>${Number(result.total_questions || 0).toLocaleString()}</dd></div>
      </dl>
      <div class="dialog-actions qi-actions">
        <button class="button" type="button" data-restart>နောက်တစ်ဖန် တင်သွင်းရန်</button>
        <button class="button primary" type="button" data-done>စစ်တမ်းများ သို့ ပြန်သွားရန်</button>
      </div>
    </div>`;
  content.querySelector("[data-restart]").onclick = () => {
    state = defaultState();
    renderOrgStep(dialog);
  };
  content.querySelector("[data-done]").onclick = () => {
    dialog.close();
    toast("မေးခွန်းများ တင်သွင်းပြီးပါပြီ။");
    location.assign("/dashboard/forms");
  };
}
