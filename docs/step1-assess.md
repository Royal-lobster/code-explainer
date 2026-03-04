# Step 1: Assess Familiarity

Ask the user using AskUserQuestion (combine into one question set):

## Question 1: "What depth level do you want for this explanation?"

| Level | Description | Segment style |
|-------|-------------|---------------|
| **Overview** | High-level architecture, how pieces connect, data flow | 40-80 line segments, skip implementation details, focus on structure |
| **Detailed** | Line-by-line explanation, patterns, design decisions | 15-40 line segments, explain why code is written this way |
| **Focused** | Answer a specific question about a specific part | Jump directly to relevant code, explain only what's asked |

Default to **Overview** if the user seems unfamiliar with the code.

## Question 2: "How do you want the walkthrough delivered?"

| Mode | Description |
|------|-------------|
| **Autoplay** (recommended) | Highlights move through code automatically while narration plays in sync. Hands-free — just watch and listen. Say "pause" to stop. |
| **Interactive + TTS** | Step-by-step with voice. The agent highlights, explains in text + voice, then waits for "next". You control the pace. |
| **Interactive (text only)** | Step-by-step, text only. The agent highlights, explains in text, waits for "next". |
| **Podcast** | Generates a single audio file of the entire walkthrough. Just listen. |

Default to **Autoplay** if the user doesn't answer.

## Question 3: "What narration speed?"

| Speed | Description |
|-------|-------------|
| **1x** (default) | Normal pace, good for unfamiliar code |
| **1.25x** | Slightly faster |
| **1.5x** | Fast, good for familiar code |
| **2x** | Very fast, skim mode |

Default to **1x**.

Track all settings throughout the session.
