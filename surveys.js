/* ────────────────────────────────────────────────────────────────
   HomeDasher surveys — CONFIG ONLY. This is the one file you edit.

   A survey is DATA, not code. To add a new survey, copy a block,
   give it a new key, and it instantly works at:
       /survey.html?survey=your-key
   (or wire a pretty URL in vercel.json — see README).

   Question types:
     text | textarea | email | tel | number
     select   -> dropdown          (needs: options)
     radio    -> pick one          (needs: options)
     checkbox -> pick many         (needs: options)
     yesno    -> single Yes / No
     star     -> 1–5 star rating
     matrix   -> shared question stem with several Yes/No rows
                 (needs: rows; optional: scale, default ["Yes","No"])

   Per-question fields:
     id        required, unique within the survey (becomes the data key)
     type      required
     label     the question text
     help       optional paragraph shown under the label
     required  optional, default false
     options   for select/radio/checkbox
     rows      for matrix: [{ id, label }, ...]
     scale     for matrix: the two (or more) column choices
   ──────────────────────────────────────────────────────────────── */

window.SURVEYS = {

  "covid-intake": {
    title: "COVID-Conscious Care Preferences",
    intro:
      "Your health and safety come first. We always reschedule your visit if your " +
      "HomeDasher has been ill or experienced any symptoms of illness within the past 7 days, " +
      "and all of our cleaning products are fragrance-free as standard. Our standard light " +
      "cleaning kit contains hypochlorous acid for hard surfaces and disinfection, and a " +
      "vinegar-based glass and window cleaner. Please share your preferences below so we can " +
      "tailor each visit to your needs.",
    submitLabel: "Submit my preferences",
    questions: [
      {
        id: "client_name",
        type: "text",
        label: "Your name",
        required: true
      },
      {
        id: "rapid_test",
        type: "yesno",
        label: "I would like my HomeDasher to test on the day of the visit with a rapid antigen test."
      },
      {
        id: "ppe",
        type: "matrix",
        label: "I would like my HomeDasher to wear the following PPE:",
        scale: ["Yes", "No"],
        rows: [
          { id: "n95",         label: "N95 mask" },
          { id: "gloves",      label: "Gloves" },
          { id: "shoe_covers", label: "Shoe covers" }
        ]
      },
      {
        id: "equipment",
        type: "matrix",
        label: "I would like my HomeDasher to bring the following equipment:",
        scale: ["Yes", "No"],
        rows: [
          { id: "aerosol_filter",  label: "Filter for infectious aerosols" },
          { id: "carbon_canister", label: "Carbon canister for VOCs and odors" }
        ]
      },
      {
        id: "product_preference",
        type: "radio",
        label: "Specialized products for deep cleaning",
        help:
          "Certain cleaning tasks sometimes require specialized products — for example, " +
          "degreasers for oven cleaning, or the removal of hard-water deposits, rust, or soap " +
          "scum. For these types of jobs, please tell us more about your product preferences.",
        options: [
          "Standard products are fine",
          "Discuss each product before use",
          "Natural products only, no harsh chemicals"
        ]
      },
      {
        id: "product_notes",
        type: "textarea",
        label: "Describe any specific product preferences",
        help: "We are always happy to use your own products if you prefer."
      }
    ]
  }

};
