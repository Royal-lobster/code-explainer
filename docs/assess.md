# Step 1: Ask User Preferences

You MUST ask EXACTLY these three questions using AskUserQuestion (all three in one call). Do NOT skip, rephrase, or invent other questions. Ask these verbatim:

## Question 1: Familiarity

"How familiar are you with this part of the codebase?"

| Option | Description |
|--------|-------------|
| **New to it** | Never seen this code before |
| **Somewhat familiar** | Worked with it a bit, know the basics |
| **Know it well** | Deep understanding, just want a refresher |

This question allows custom answers — the user may describe their specific context (e.g. "I wrote the auth layer but haven't seen the new caching changes"). Use their answer to tailor the walkthrough: skip basics they already know, spend more time on parts they're unfamiliar with.

## Question 2: Depth level

"Which depth level would you like?"

| Option | Description |
|--------|-------------|
| **Overview** | High-level architecture, data flow, how pieces connect. 40-80 lines per segment, 4-8 segments. |
| **Deep Dive** | Line-by-line, patterns, design decisions. 15-40 lines per segment, 8-15 segments. |

## Question 3: Delivery mode

"How would you like the walkthrough delivered?"

| Option | Description |
|--------|-------------|
| **Walkthrough** (recommended) | Auto-advancing highlights + TTS narration via sidebar. Hands-free. |
| **Read** | Text explanations in terminal. No sidebar or TTS required. |
| **Podcast** | Single audio file of entire walkthrough. |
