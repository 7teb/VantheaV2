---
name: model-guide
description: How to choose a model and effort in VantheaX, above all for deploy_agent and continue_agent. Covers cost rules for sub-agents, the owner's own benchmark of the catalog models with the cost of each run, public benchmarks (Artificial Analysis Intelligence Index, Humanity's Last Exam, Terminal-Bench 4.0, AutomationBench, SWE-bench), what "Flex" in a model name means, and which model fits which kind of task. Load it before you pick a model or effort for a sub-agent, and when the user asks which model is strongest, cheapest or best for something. Current prices per 1M tokens come from list_models.
---

# Model guide

Prices and ids: call `list_models`. It returns the exact model ids that `deploy_agent` and `continue_agent` take and the current OpenRouter price per 1M input and output tokens of the route each model uses. Prices change; the numbers in this skill are a snapshot from October 2026 and only show how models compare.

## Cost comes first

- Not every agent needs the strongest model or the highest effort. Match the model to the job: a read-only search, a summary, a mechanical edit or a simple check does not need a frontier model at max effort.
- Price always counts. A sub-agent without `model` and `effort` runs on your own model and effort. If you run on an expensive model, every agent you deploy without those arguments costs as much as you do. Set `model` and `effort` on purpose for each agent.
- Several expensive agents get expensive fast. The owner's benchmark run below cost 4.38 USD on Claude Opus 5.5 and 0.06 USD on GPT 6 Luna for the same 60 tasks. Five agents on an expensive model at max effort multiply that. Run expensive models in parallel only when the user asked for it explicitly or the task really needs that strength; otherwise use one strong agent where it matters and cheaper models for the rest.
- Effort costs output tokens. Higher effort means more reasoning tokens on every round. Use max only for hard reasoning; medium or high is enough for ordinary work.
- A cheaper model that has to retry or gets corrected twice is not cheaper. For work where a mistake is costly, pay for the stronger model once.

## The owner's benchmark

The owner ran 60 tasks in three categories of 20 tasks each, 200 points in total, in October 2026. Effort is the effort used for the run. Run cost is what the whole run of 60 tasks cost in USD.

| Model | Effort | Score | Points | Run cost |
|---|---|---|---|---|
| GPT 6.1 Sol Flex | max | 99% | 198/200 | 0.43 |
| GPT 6 Astra Flex | medium | 99% | 198/200 | 2.15 |
| Gemini 4 Argon Flex | high | 98% | 196/200 | 0.66 |
| Claude Sonnet 5.5 | max | 97% | 194/200 | 3.28 |
| GLM 5.3 | max | 92% | 184/200 | 1.05 |
| Pareto 26.9 | none | 92% | 184/200 | 1.11 |
| MiMo V2.6 Pro | high | 90% | 180/200 | 0.27 |
| DeepSeek V4.1 Flash | max | 86% | 172/200 | 0.31 |
| GLM 5.3 Flash | max | 85% | 170/200 | 0.33 |
| GPT 6 Luna | max | 79% | 158/200 | 0.06 |
| Ling 3.1 Flash | high | 77% | 154/200 | 0.06 |
| Claude Haiku 5.5 | max | 69% | 138/200 | 0.25 |
| GPT OSS 120B | medium | 63% | 126/200 | 0.49 |
| Claude Opus 5.5 | max | 59% | 118/200 | 4.38 |

Not in this run: Kimi K3, Qwen 3.8 Max, MiniMax M3.1 Flash, Grok 4.7, Muse Wonder, Gemini 3.8 Flash and its Flex entry, MiMo V2.6 Pro Ultraspeed, GLM 5.3 Fast. GPT 6.1 Sol, GPT 6 Astra and Gemini 4 Argon without "Flex" are the same models on the standard route: the score is the same, they answer faster and cost twice as much per token.

## Public benchmarks

Snapshot read on 2026-10-17. Scores in percent, except the Artificial Analysis index (0 to 100). The letter after a number says where it comes from: L is the benchmark's official leaderboard (one harness for all models), A is Artificial Analysis (one independent harness), S is Vals AI (one independent harness), V is the vendor's own number. Vendor numbers usually run higher than independent ones, on AutomationBench by 15 to 28 points, so compare within one source where you can. A dash means no published number was found.

| Model | AA Intelligence Index | HLE | Terminal-Bench 4.0 | AutomationBench | SWE-bench Multimodal |
|---|---|---|---|---|---|
| GPT 6.1 Sol | 51.8 A | 52.9 A | 58.2 L | 37.0 A | 43.5 S |
| GPT 6 Astra | 52.7 A | 54.7 A | 58.2 L | 41.4 L | 43.3 S |
| GPT 6 Luna | 38.1 A | 38.5 A | 16.4 L | 20.7 L | 37.5 S |
| Gemini 4 Argon | 52.6 A | 57.1 A | 57.1 A | 51.3 L | 56.0 S |
| Gemini 3.8 Flash | 40.9 A | 47.8 A | 19.1 L | 29.7 L | 40.8 S |
| Claude Opus 5.5 | 57.6 A | 61.4 A | 64.9 L | 42.5 L | 70.2 S |
| Claude Sonnet 5.5 | 56.0 A | 55.0 A | 61.8 L | 44.8 L | 58.3 S |
| Claude Haiku 5.5 | 43.4 A | 44.4 A | 32.8 A | 12.0 L | 44.0 S |
| GLM 5.3 | 44.8 A | 42.3 A | 41.8 L | 29.4 A | - |
| GLM 5.3 Flash | 41.8 A | 39.9 A | 35.8 L | 25.4 A | - |
| DeepSeek V4.1 Flash | 39.5 A | 39.2 A | 26.8 A | 35.5 A | 46.5 S |
| MiMo V2.6 Pro | 46.3 A | 49.4 A | 34.8 A | 25.4 A | 41.3 S |
| Kimi K3 | 43.6 A | 46.9 A | 12.6 A | 22.7 L | 35.8 S |
| Qwen 3.8 Max | 45.4 A | 43.1 A | 27.0 L | 26.6 A | 42.5 S |
| Muse Wonder | 52.4 A | 50.1 A | 52.0 A | 39.1 A | 45.6 S |
| Pareto 26.9 | - | 49 V | - | - | - |
| Ling 3.1 Flash | 41.1 A | 39.4 A | 46.0 V | 52.5 V | - |
| GPT OSS 120B | 11.6 A | 19.6 A | - | 0.15 L | - |

S is Vals AI (vals.ai), the only board that ran SWE-bench for almost all of these models with one harness. SWE-bench Verified is saturated and Vals archived it in September 2026; vendors now report SWE-bench Pro, each with its own harness, so those numbers do not compare across vendors: Claude Opus 5.5 89.9 V, Claude Sonnet 5.5 81.3 V, Ling 3.1 Flash 68.7 V, Qwen 3.8 Max 67.7 V, Claude Haiku 5.5 64.8 V, Gemini 3.8 Flash 61.6 V. OpenAI, Google (for Gemini 4 Argon), Meta, Z.ai, DeepSeek, Moonshot, Xiaomi and Unbiased report DeepSWE instead.

What the benchmarks measure:

- Artificial Analysis Intelligence Index (v4.3): one score over ten evaluations (reasoning, knowledge, math, coding, agentic tasks), all run by Artificial Analysis with one harness. artificialanalysis.ai
- HLE (Humanity's Last Exam): very hard expert questions, text only, no tools. Measures raw knowledge and reasoning, not coding.
- Terminal-Bench 4.0: real tasks in a terminal (build, debug, configure, data work), solved by an agent through a shell. Closest to what a VantheaX worker does with run_command and run_bash. Scores move by several points with the harness. tbench.ai
- AutomationBench (Zapier): multi-step tool use across business apps with strict pass or fail. Shows how reliably a model chains tool calls. L numbers are Zapier's private set, A numbers Artificial Analysis's version. zapier.com/benchmarks
- SWE-bench Multimodal: fixing real GitHub issues in visual JavaScript projects, where the issue includes screenshots. Measures repository-level bug fixing; models without vision have no score.

The owner's benchmark and the public ones do not always agree. Claude Opus 5.5 leads the AA index and Terminal-Bench but scored lowest in the owner's run at the highest cost. Ling 3.1 Flash and GPT 6 Luna did well in the owner's run for their price, but GPT 6 Luna is weak on Terminal-Bench. Use the owner's run for the kind of tasks the owner gives, and the public numbers for the kind of work they measure.

## What "Flex" means

A model whose label ends in "Flex" (its catalog id ends in `:floor`) is the same model as the entry without "Flex", sent first to the provider's Flex tier:

- GPT 6.1 Sol Flex and GPT 6 Astra Flex use OpenAI's Flex processing. Gemini 4 Argon Flex uses the Flex tier of Google AI Studio (the Gemini API). Gemini 3.8 Flash Flex uses the Flex tiers of Google Vertex and Google AI Studio.
- Price: half the standard price per token.
- Speed: slower. Requests run on spare capacity and can wait in a queue; Google states a latency target of 1 to 15 minutes per request on its Flex tier, OpenAI gives no number.
- Availability: when the Flex tier has no capacity, the provider refuses the request (OpenAI: 429 Resource Unavailable, Google: 503). VantheaX lists the standard route of the same provider second, so OpenRouter then sends the request there and it costs the standard price.

Use Flex for sub-agents and background work where minutes of waiting do not matter: reviews, explorations, long implementations. Use the entry without "Flex" when the user waits for a quick answer in the chat.

## Which model for which job

Based on the owner's benchmark, the public numbers above and what the catalog notes say. Check list_models for the current price before you decide.

- Hardest work (architecture, a tricky bug, long multi-step changes, a final review): GPT 6.1 Sol Flex first. It had the top score at 0.43 USD per run. Then Gemini 4 Argon Flex, GPT 6 Astra Flex (strong, but 2.15 USD per run) and Claude Sonnet 5.5 (strong, but 3.28 USD per run).
- Ordinary coding workers: MiMo V2.6 Pro (90%, 0.27 USD), DeepSeek V4.1 Flash (86%, 0.31 USD) and GLM 5.3 Flash (85%, 0.33 USD, fast at about 150 to 240 output tokens per second). These give most of the quality for a fraction of the price.
- Cheap helpers for simple jobs (read-only exploration, collecting facts, summaries, small edits): GPT 6 Luna (79%, 0.06 USD) and Ling 3.1 Flash (77%, 0.06 USD, free on OpenRouter). Keep GPT 6 Luna away from long command-line work; it scores low on Terminal-Bench.
- GLM 5.3 (92%, 1.05 USD) and Pareto 26.9 (92%, 1.11 USD, no effort setting): solid, but cost more than MiMo V2.6 Pro or DeepSeek V4.1 Flash for similar results in the owner's run.
- Claude Opus 5.5: the most expensive model and the weakest in the owner's run. Use it only when the user asks for it.
- Claude Haiku 5.5: below MiMo V2.6 Pro and DeepSeek V4.1 Flash in the owner's run at a similar price.
- GPT OSS 120B: only for very small tasks. Every response is capped at 8192 output tokens including reasoning, so larger files get cut off, and in tests it reported results inaccurately.

Limits that rule a model out:

- Images: GLM 5.3, GLM 5.3 Fast, Ling 3.1 Flash and GPT OSS 120B cannot read images. Give work that involves screenshots, the browser or pictures to a model with vision.
- Context window: Ling 3.1 Flash and Pareto 26.9 have 262k tokens, GPT OSS 120B 131k. Work that needs a lot of context goes to a model with a 1M window.
