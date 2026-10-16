# Demo script, video plan and pitch roles (tasks M1-15, M1-16)

All timings match the report (section 10 and section 16) and the shortlisting announcement: **finalists get exactly 5 minutes**. The opening slides said 6 minutes; check Discord for the final number and cut the "How we built it" part first if time is short.

These are stage directions and talking points, not a script to read word for word. Say it in your own words.

## Setup before you go on stage

- Laptop on power, browser zoom 110–125%, notifications off.
- **Window 1 (left):** live URL, chat page `/`.
- **Window 2 (right):** live URL, `/review`, already signed in as the demo reviewer.
- **Tab 3:** `/bench` with the real results loaded.
- **Tab 4:** the slides PDF.
- Backup: the demo video downloaded to the laptop, in case the venue internet fails.
- Check the live log says **Live** in both windows.

## The live demo (about 2.5 minutes, inside the 5-minute pitch)

| Time | What you do | What the audience sees | Point to make |
|---|---|---|---|
| 0:00 | Type a normal task: `List invoices for October` | Green **Allowed** calls in the live log | "Normal work is not slowed down." |
| 0:20 | Show email #7 (in the slide or the evidence later): it looks like a normal freight invoice | A harmless-looking email | "One sentence is written in white text. You can't see it. The AI can." |
| 0:40 | Click **Summarise this month's invoices** | `read_emails`, `list_invoices` green, then `send_email` to `x@evil.com` turns **red: Held** | "The agent was fooled. It is trying to send our invoices to a stranger. The firewall stopped it before it happened." |
| 1:10 | Switch to the reviewer window | The evidence card: the user's task, email #7 with the hidden sentence highlighted, the call, risk 100 | "In ten seconds, anyone can see what happened and why." |
| 1:40 | Click **Block** (or **Always block**) | Red "Blocked"; the chat log updates | "A person makes the final call. The AI did the watching." |
| 2:00 | Back to the chat | The agent finishes the summary and says a suspicious action was stopped | "The agent continues safely and tells the user." |
| 2:15 | Open `/bench` | Real catch rate, false alarms and added delay | "We tested 20 attacks and 20 normal tasks. These are our real numbers." |
| 2:30 | Show the QR code slide | — | "Try to trick our agent yourself." |

If the attack is not held on stage: stay calm, say "this is exactly why we recorded a backup", and play the video from 0:40.

## Demo video (M1-16): 2–3 minutes

The handbook asks for a 2–3 minute demo video, unlisted on YouTube or on Google Drive with "anyone with the link". Record the **live Alternate Clouds URL**, not localhost, so the video also proves the deployment.

| Time | Shot | Voice-over points |
|---|---|---|
| 0:00–0:20 | Title slide | Team name, project name, the one-line pitch: "AI agents have no seatbelt. We built one." |
| 0:20–0:40 | Email #7 rendered normally, then the same email's raw HTML | The problem: prompt injection, the number one risk for LLM apps (OWASP LLM01). The hidden sentence. |
| 0:40–1:30 | Chat window + live log, then the reviewer window | The normal task (green), the attack (red, held), the evidence card |
| 1:30–1:50 | Click Block; chat reply | Human decides; agent continues and reports it |
| 1:50–2:20 | Architecture slide, then `/bench` | Three checks (policy, taint, intent), MCP proxy, deployed on Alternate Clouds; the real numbers |
| 2:20–2:40 | Alternate Clouds dashboard showing the service running, then the live URL in the address bar | Proof it is live on Alternate Clouds |
| 2:40–3:00 | Closing slide with QR code | "The AI watches every call. The human makes the final call." |

Recording checklist:

- [ ] Recorded on the live URL; the address bar is visible at least once.
- [ ] No API keys, passwords, `.env` file or Variables tab values on screen. (Show the dashboard's service status, not the Variables tab.)
- [ ] The demo reviewer password is not typed on camera (sign in before recording).
- [ ] Under 3 minutes. Audio is clear. Spoken in English.
- [ ] Uploaded as **unlisted** (YouTube) or "anyone with the link" (Drive); link opened in a private window to check.

## Pitch roles (work plan, section 3)

| Part | Time | Who |
|---|---|---|
| Hook and problem | 0:00–0:40 | Member 1 |
| Live demo | 0:40–3:00 | Member 1 runs it |
| How we built it | 3:00–3:50 | Member 2 |
| Results and what we are proud of | 3:50–4:30 | Member 2 |
| Close and QR code | 4:30–5:00 | Member 1 |

Questions from judges: Member 1 answers on users and impact, Member 2 on technical details.

### Likely questions to prepare for

- *Can't the attacker fool the intent model too?* It is one of three independent checks. Policy and taint still hold the call, and the human decides.
- *Won't reviewers get too many alerts?* Only risky calls are held, and "always allow / always block" decisions reduce the queue over time. Show the "calls a human had to review" number.
- *What did you not solve?* Be honest: for example obfuscated addresses (`atk_20`) or instructions inside images. Point to the roadmap.
- *Why does it need a human at all?* An AI checking another AI can be fooled by the same trick, and actions like sending company data need someone accountable.
- *Does it work with other agents?* It is an MCP proxy, so any MCP-based agent can use it without code changes.
