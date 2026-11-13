# Panic Planner

Exam tomorrow and units still left? Put in the exam, when it is and how many units are left. Panic Planner tells you the truth: hours left, hours per unit, how much sleep you can still get, a panic %, and a timed plan for the night with a countdown for the block you're in.

**Use it:** https://souradip121.github.io/panic-planner/

> Don't make a study plan the night before. It's too late for a plan.

## The three screens

1. **Setup.** Exam name, date and time, units (tap a unit to mark it done, or use the LEFT and TOTAL steppers; NAMES lets you name them), and an "I plan to sleep" switch.
2. **The truth.** A panic gauge, time left, time per unit, and the sleep you can still get if you start now. The working is written under it, so every number can be checked.
3. **The plan.** Study blocks with clock times, sleep, a quick revision, and the time to get ready and go. You can **skip** one unit: you pick which one and type your own reason. The app never tells you which unit matters less. **Start timer** counts down the block you're in, keeps the screen awake where the browser allows it, and beeps when a block ends.

## The maths

All of it is in [`assets/plan.js`](assets/plan.js) and tested in [`tests/plan.test.mjs`](tests/plan.test.mjs).

| Rule | Value |
|---|---|
| Buffer for travel and the morning (get up, get ready, get there) | 1 h 30 min, right before the exam |
| Quick revision of everything | 30 min, just before the buffer |
| Sleep, if you switch it on | a third of what's left after the buffer and revision, rounded down to 15 min, never more than 8 h |
| Time per unit | what's left after buffer, revision and sleep, split evenly across the units you'll study |

```
left      = minutes from now to the exam
usable    = left − 90                         (travel and the morning)
revision  = min(30, usable)
sleep     = min(480, ⌊(usable − revision) ÷ 3⌋ to 15 min)   if you plan to sleep, else 0
study     = usable − revision − sleep
per unit  = study ÷ units
```

Why a third? A normal day gives sleep 8 of its 24 hours. It's a rule of thumb, not medical advice.

### Panic %

Panic is a straight line on time per unit:

```
panic = (360 − per unit in minutes) ÷ (360 − 30) × 100, kept between 0 and 100
```

- **0%** = 6 hours or more per unit.
- **100%** = 30 minutes or less per unit.
- Halfway, 50%, is 3 h 15 min per unit.

The **PULL UP** strip lights at 70% and above. The **HIGH STRESS** lamp lights at 50% and above.

### Worked example (the reel demo)

DBMS at 9:30 AM, it's 8:10 PM, 4 of 5 units left, sleep on:

```
left      = 13 h 20 min                  = 800 min
usable    = 800 − 90                     = 710
revision  = 30                           → 680 left
sleep     = 680 ÷ 3 = 226.7 → 225 min    = 3 h 45 min
study     = 680 − 225                    = 455 min
per unit  = 455 ÷ 4                      = 113.75 min = 1 h 53 min
panic     = (360 − 113.75) ÷ 330 × 100   = 74.6 → 75%   → PULL UP
```

With sleep off, the units get the whole 680 min: 2 h 50 min each, panic 58%.

The plan is built backwards from the exam: get ready and go 8:00–9:30 AM, revision 7:30–8:00, sleep 3:45–7:30, and the four units share 8:10 PM–3:45 AM. Study blocks start on 5-minute marks so the clock times are easy to read.

### Edge cases

| Situation | What the app does |
|---|---|
| The exam time has passed | No panic number. It says so and asks you to fix the date if it's wrong. |
| Less than an hour left | 100%. No plan: "No new topics. Read what you already know, then go." |
| An hour or more, but the buffer and revision take it all | 100%, 0 min per unit. The plan is just revision (if any) and getting ready. |
| Zero units left | 0%. Nothing to study: one quick revision, then sleep (up to 8 h) and free time. |
| You skip a unit | Its time goes to the other units, so time per unit goes up and panic goes down. Only one skip at a time. |

### The other instruments

- **FUEL:** the time left out of a full day. F is 24 hours or more, E is the exam.
- **Attitude dial:** the plane banks further the higher your panic, and sways once PULL UP is on.
- **STUDY MODE lamp:** on while the timer runs.

## Links

- `?demo` loads the example (DBMS, unit 1 done, exam about 13 hours away on the next half hour) without touching what your phone saved.
- `#/truth` and `#/plan` open those screens directly once an exam is saved.

## How it's built

Static HTML, CSS and ES modules. No backend, no login, no build step, no network calls after the page loads. Everything you type stays in your browser's localStorage.

```bash
npm test           # the maths
npm run serve      # http://127.0.0.1:8803/
node tools/shoot.mjs http://127.0.0.1:8803/ screenshots   # reel stills, 1170x2532, clock stopped at 8:10 PM IST
```

To host your own copy, fork this repo and turn on GitHub Pages for the `main` branch.

The countdown is worked out from the clock, so it's right when you come back to the tab, but phones can pause pages in the background, so the beep only plays while the page is open.

Made by [@souradip.sh](https://www.instagram.com/souradip.sh/). MIT licence. Font: Barlow Semi Condensed and Barlow Condensed by Jeremy Tribby, under the SIL Open Font License (`assets/fonts/OFL.txt`).
