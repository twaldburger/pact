/*
 * PACT's top bar: the one bar both views show, built from this one source so
 * the plan and the report can never drift apart. The browser (public/app.js)
 * mounts it into the empty `<header id="topbar">` both pages carry, and reads
 * the switch's paths from here rather than repeating them.
 *
 * The bar is identical in both views, every element in its current position;
 * only the switch's own current-page mark differs. Which controls a report
 * withdraws is a rule of its own, `reportDisabledControlIds` below, so the
 * browser can disable them by id instead of holding a second copy of the list.
 */

export const VIEW_PLAN = "plan";
export const VIEW_REPORT = "report";

// The two paths the switch moves between. PACT has no build step, so a page is
// just a second file under public/ at its own path.
export const PLAN_PATH = "/";
export const REPORT_PATH = "/report.html";

export function isReportView(view) {
  return view === VIEW_REPORT;
}

export function viewFromAttribute(value) {
  return isReportView(value) ? VIEW_REPORT : VIEW_PLAN;
}

/*
 * The bar controls a report cannot act on, by element id: Today, the row
 * height and Grid spacing pairs, and Undo/Redo. A report makes no grid moves
 * and no plan writes, so these are disabled - visibly not available and not
 * focusable - while keeping their exact position in the bar. The Filter, the
 * zoom and the Options glyph stay live.
 */
export function reportDisabledControlIds() {
  return [
    "today",
    "row-decrease",
    "row-increase",
    "spacing-decrease",
    "spacing-increase",
    "undo-btn",
    "redo-btn"
  ];
}

// One bar, given the view that is showing. The switch is a pair of real links,
// so the move is a navigation to the report's own path rather than a swap in
// place, and the current one carries aria-current.
export function topbarMarkup(view) {
  const here = viewFromAttribute(view);
  const planCurrent = here === VIEW_PLAN ? ' aria-current="page"' : "";
  const reportCurrent = here === VIEW_REPORT ? ' aria-current="page"' : "";
  return `
    <div class="topbar__identity">
      <span class="wordmark">PACT</span>
      <span class="topbar__context" id="context"></span>
      <span class="topbar__save" id="save-status">Saved</span>
    </div>
    <div class="topbar__instruments">
      <nav class="viewswitch" aria-label="Plan or report">
        <a class="viewswitch__btn" href="${PLAN_PATH}" data-view-link="${VIEW_PLAN}"${planCurrent}>Plan</a>
        <a class="viewswitch__btn" href="${REPORT_PATH}" data-view-link="${VIEW_REPORT}"${reportCurrent}>Report</a>
      </nav>
      <div class="filter" id="filter">
        <input type="text" class="filter__input" id="filter-input" placeholder="Filter"
          aria-label="Filter the plan" autocomplete="off" role="combobox"
          aria-expanded="false" aria-autocomplete="list" aria-controls="filter-suggest">
        <button type="button" class="filter__clear" id="filter-clear"
          aria-label="Clear the filter" hidden>&times;</button>
        <button type="button" class="filter__scope" id="filter-scope"
          aria-haspopup="true" aria-expanded="false" aria-label="Look in - all 3">in 3 areas</button>
        <div class="filter__scopes" id="filter-scopes" hidden>
          <button type="button" class="filter__switch" role="switch" data-scope="people" aria-checked="true"><span class="filter__tick" aria-hidden="true"></span>People</button>
          <button type="button" class="filter__switch" role="switch" data-scope="projects" aria-checked="true"><span class="filter__tick" aria-hidden="true"></span>Projects</button>
          <button type="button" class="filter__switch" role="switch" data-scope="assignments" aria-checked="true"><span class="filter__tick" aria-hidden="true"></span>Assignments</button>
        </div>
        <div class="filter__suggest" id="filter-suggest" role="listbox"
          aria-label="Filter suggestions" hidden></div>
      </div>
      <button type="button" class="ghost" id="today">Today</button>
      <div class="zoom" role="group" aria-label="Zoom - the width of one day">
        <button type="button" class="zoom__btn" data-zoom="day" aria-pressed="false">Day</button>
        <button type="button" class="zoom__btn" data-zoom="week" aria-pressed="false">Week</button>
        <button type="button" class="zoom__btn" data-zoom="month" aria-pressed="true">Month</button>
        <button type="button" class="zoom__btn" data-zoom="sprint" aria-pressed="false">Sprint</button>
      </div>
      <div class="rowheight" role="group" aria-label="Row height - the height of one person's row">
        <button type="button" class="rowheight__btn" id="row-decrease" aria-label="Shorter rows" title="Shorter rows">
          <svg class="stepper__glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 3v10"/>
            <path d="M4 9l4 4 4-4"/>
          </svg>
        </button>
        <button type="button" class="rowheight__btn" id="row-increase" aria-label="Taller rows" title="Taller rows">
          <svg class="stepper__glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 13V3"/>
            <path d="M4 7l4-4 4 4"/>
          </svg>
        </button>
      </div>
      <div class="spacing" role="group" aria-label="Grid spacing - the width of one day">
        <button type="button" class="spacing__btn" id="spacing-decrease" aria-label="Narrower days" title="Narrower days">
          <svg class="stepper__glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M13 8H3"/>
            <path d="M7 4 3 8l4 4"/>
          </svg>
        </button>
        <button type="button" class="spacing__btn" id="spacing-increase" aria-label="Wider days" title="Wider days">
          <svg class="stepper__glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 8h10"/>
            <path d="M9 4l4 4-4 4"/>
          </svg>
        </button>
      </div>
      <div class="history" role="group" aria-label="Undo and Redo">
        <button type="button" class="history__btn" id="undo-btn"
          aria-label="Undo" title="Undo" disabled>
          <svg class="history__glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 3 3 6l3 3"/>
            <path d="M3 6h6.5a3.5 3.5 0 0 1 0 7H7"/>
          </svg>
        </button>
        <button type="button" class="history__btn" id="redo-btn"
          aria-label="Redo" title="Redo" disabled>
          <svg class="history__glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M10 3l3 3-3 3"/>
            <path d="M13 6H6.5a3.5 3.5 0 0 0 0 7H9"/>
          </svg>
        </button>
      </div>
      <div class="options" id="options">
        <button type="button" class="ghost options__btn" id="options-btn"
          aria-haspopup="true" aria-expanded="false" aria-label="Options" title="Options">
          <span class="options__glyph" aria-hidden="true">&hellip;</span>
        </button>
        <div class="options__menu" id="options-menu" role="menu" aria-label="Options" hidden></div>
      </div>
    </div>`;
}

// Fill the page's own empty header with the bar. A page with no header is left
// alone rather than throwing, so the module stays cheap to mount anywhere.
export function mountTopbar(host, view) {
  if (!host) return null;
  host.innerHTML = topbarMarkup(view);
  return host;
}
