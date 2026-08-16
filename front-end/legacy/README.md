# PulseMind refined prototype

This version keeps the original interactive demo and improves the dashboard and login design. It uses plain HTML, CSS and JavaScript—no framework or build step.

## Project structure

```text
pulsemind-refined/
├── index.html
├── login.html
├── assets/
│   └── pulsemind-logo.png
├── css/
│   ├── styles.css       # imports every stylesheet
│   ├── base.css         # variables, reset and typography
│   ├── layout.css       # page/header/grid structure
│   ├── components.css   # buttons, badges, cards, notices
│   ├── dashboard.css    # overview/detail/drawer styles
│   ├── login.css        # login-only styles
│   └── responsive.css   # tablet and mobile rules
└── js/
    ├── app.js           # dashboard state and interactions
    └── login.js         # login-page interactions
```

## Add the logo

Save the original transparent PulseMind logo as `assets/pulsemind-logo.png`. Both pages already use it through an `<img>` element.

## Run

Open `login.html` with VS Code Live Server. The manual sign-in and staff-badge prototype both continue to `index.html`.

All patient data are simulated sample data. The project remains read-only, clinician-in-the-loop and does not control the ventilator or recommend treatment.
