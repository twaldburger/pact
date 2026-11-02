/*
 * Fixture data for the PACT interface, pass 2.
 *
 * This is placeholder data so the screen can be built and reviewed before the
 * Node server and the real JSON file exist. Replace it with the loaded file
 * later; the shape below is the seam the real data must match.
 *
 * It is written as JSON and handed to the page through a classic script rather
 * than a fetch() of a .json file, because a browser refuses to fetch from a
 * file:// page, and this screen has to work opened straight from disk.
 *
 * Colours are token names from the stylesheet (--proj-<name>), never raw hex,
 * so the palette stays in one place.
 */
window.PACT_FIXTURE = {
  "today": "2026-03-19",
  "range": { "start": "2026-01-01", "end": "2026-12-31" },
  "people": [
    {
      "id": "anna",
      "name": "Anna Meier",
      "availability": 100,
      "tags": ["React", "lead"],
      "note": "leads Atlas"
    },
    {
      "id": "ben",
      "name": "Ben Falk",
      "availability": 80,
      "tags": ["React", "Design"],
      "note": "contract through June"
    },
    {
      "id": "cara",
      "name": "Cara Nowak",
      "availability": 60,
      "tags": ["Design"],
      "note": "part-time, Tue-Thu"
    }
  ],
  "projects": [
    { "id": "atlas", "name": "Atlas", "colour": "steel", "notes": "phase one" },
    { "id": "borealis", "name": "Borealis", "colour": "moss", "notes": "phase two" },
    { "id": "cara-onboarding", "name": "Cara onboarding", "colour": "iris", "notes": "" },
    { "id": "warehouse-move", "name": "Warehouse move", "colour": "teal", "notes": "not started" }
  ],
  "assignments": [
    {
      "id": "a-atlas-anna",
      "projectId": "atlas",
      "personId": "anna",
      "start": "2026-03-15",
      "end": "2026-04-30",
      "share": 60,
      "tags": ["React", "Design"],
      "note": "shadowing Cara"
    },
    {
      "id": "a-atlas-ben",
      "projectId": "atlas",
      "personId": "ben",
      "start": "2026-03-15",
      "end": "2026-03-27",
      "share": 60,
      "tags": ["React"],
      "note": ""
    },
    {
      "id": "a-borealis-ben",
      "projectId": "borealis",
      "personId": "ben",
      "start": "2026-03-19",
      "end": "2026-04-24",
      "share": 36,
      "tags": ["Design"],
      "note": "handover from Atlas"
    },
    {
      "id": "a-borealis-cara",
      "projectId": "borealis",
      "personId": "cara",
      "start": "2026-03-17",
      "end": "2026-04-10",
      "share": 20,
      "tags": [],
      "note": ""
    },
    {
      "id": "a-onboard-cara",
      "projectId": "cara-onboarding",
      "personId": "cara",
      "start": "2026-04-13",
      "end": "2026-05-15",
      "share": 20,
      "tags": ["Design"],
      "note": "paired with Anna"
    }
  ]
};
