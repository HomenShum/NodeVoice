# Local model dropdown catalog

Refreshed on 2026-07-04. Correction: **Gemma 4 is the current Gemma family**, so the dropdown now starts with `gemma4:*`, not Gemma 3 / Gemma 3n. This file intentionally separates runnable local models from cloud-only references and older practical fallbacks.

## Recommended defaults

| Surface | Default | Why |
| --- | --- | --- |
| Voice agents | `gemma4:e2b` | Latest Gemma 4 edge model; use for transcript-to-action, room-state classification, and terse voice utterances. |
| Stronger voice / small NodeAgent | `gemma4:e4b` | More capable edge model while still practical for local room-state continuation. |
| NodeAgents | `gemma4:12b` | Latest mid-sized Gemma 4 local model; 256K context; good for artifact synthesis, code review, and multimodal reasoning. |
| Stable tiny voice fallback | `llama3.2:3b` or `gemma3n:e2b` | Useful when the newest Gemma 4 tags are unavailable or too heavy. |
| Stable small NodeAgent fallback | `qwen3:4b` | Dependable small local agent baseline. |
| Code-heavy NodeAgents | `qwen3-coder:30b`, `qwen3.6:27b`, `devstral-small-2`, `qwen2.5-coder:7b/32b` | Codebase/tool-use oriented options at different hardware tiers. |
| Embeddings | `nomic-embed-text`, `snowflake-arctic-embed2` | Local retrieval layer for NodeAgent memory/RAG. |

## Latest Gemma 4 models

| ID | Ollama model | Best for | Hardware tier | Notes |
| --- | --- | --- | --- | --- |
| `gemma4_e2b` | `gemma4:e2b` | Voice, room-state, small NodeAgent | Laptop | Latest edge default. 128K context; text/image in Ollama; built for edge deployments. |
| `gemma4_e4b` | `gemma4:e4b` | Stronger voice, small NodeAgent | Laptop | Stronger edge model; 128K context. |
| `gemma4_12b` | `gemma4:12b` | NodeAgent, code review, multimodal docs | Workstation/laptop with enough RAM | Latest mid-sized Gemma 4 model; 256K context. |
| `gemma4_26b` | `gemma4:26b` | Reasoning reviewer, code, harder NodeAgent tasks | High VRAM | MoE model with about 3.8B active parameters; 256K context. |
| `gemma4_31b` | `gemma4:31b` | Dense local/lab reasoning | High VRAM / lab | Dense 31B-class option; 256K context. |

## Other latest/high-interest local models

| ID | Ollama model | Best for | Hardware tier | Notes |
| --- | --- | --- | --- | --- |
| `ministral3_3b` | `ministral-3:3b` | Voice, NodeAgent, vision | Laptop | Edge family; 256K context; tool/JSON support where available. |
| `ministral3_8b` | `ministral-3:8b` | NodeAgent, voice, vision, code | Laptop | Good alternative to Gemma 4 12B for smaller agent loops. |
| `ministral3_14b` | `ministral-3:14b` | NodeAgent, vision, code | Workstation | Stronger edge/local artifact model. |
| `qwen3_6_27b` | `qwen3.6:27b` | NodeAgent, code, vision, reasoning | High VRAM | Current Qwen agentic coding/thinking model. |
| `qwen3_6_35b_a3b` | `qwen3.6:35b-a3b-q4_K_M` | NodeAgent, code, reasoning | High VRAM | MoE-style Qwen3.6 option. |
| `qwen3_coder_next` | `qwen3-coder-next` | Coding agents | High VRAM / lab | Agentic coding model; add this when your Ollama install exposes the tag. |
| `qwen3_coder_30b` | `qwen3-coder:30b` | Coding agents | High VRAM | More practical Qwen3-Coder option than 480B. |
| `qwen3_coder_480b` | `qwen3-coder:480b` | Lab-scale coding agents | Lab | Local tag exists, but needs extreme memory. |
| `glm_4_7_flash` | `glm-4.7-flash` | NodeAgent, code, reasoning | High VRAM | 30B-A3B MoE; may require newer/pre-release Ollama runtime. |
| `glm_5` | `glm-5` | Lab-scale NodeAgent, code, reasoning | Lab | Huge open-weight MoE model; reference, not laptop default. |
| `glm_5_1` | `glm-5.1` | Lab-scale agentic engineering | Lab | GLM flagship engineering-agent reference. |
| `mistral_small_3_2` | `mistral-small3.2:24b` | NodeAgent, vision, code | High VRAM | Useful because it improves repetition/function-calling. |
| `magistral_24b` | `magistral:24b` | Reasoning reviewer | High VRAM | Mistral reasoning model; good reviewer/planner. |
| `devstral_small_2` | `devstral-small-2` | Software engineering agents | High VRAM | Codebase exploration + multi-file editing. |
| `deepseek_r1_8b_0528` | `deepseek-r1:8b` | Reasoning reviewer | Laptop | Practical distilled reasoner. |
| `phi4_mini_reasoning` | `phi4-mini-reasoning` | Small reasoning | Laptop | Lightweight logic/math-heavy model. |
| `phi4_reasoning_vision_15b` | `phi4-reasoning-vision:15b` | Multimodal UI/doc reasoning | High VRAM | Good for screenshot/document understanding if your runner exposes the tag. |
| `lfm2_5_thinking_1_2b` | `lfm2.5-thinking` | Tiny fast voice/reasoning classifier | Tiny/laptop | Good candidate for ultra-low-latency room-state classification. |
| `llama4_scout` | `llama4:scout` | Extreme-context multimodal experiments | Lab | Large/lab option; not a weak-laptop default. |
| `gpt_oss_20b` | `gpt-oss:20b` | NodeAgent, reasoning, code | High VRAM | Open-weight local reasoning/agent model. |
| `gpt_oss_120b` | `gpt-oss:120b` | NodeAgent, reasoning, code | Lab | Larger local/lab model. |

## Practical stable fallbacks

| ID | Ollama model | Best for | Hardware tier | Notes |
| --- | --- | --- | --- | --- |
| `gemma3n_e2b` | `gemma3n:e2b` | Voice fallback | Tiny | Older fallback when Gemma 4 is too heavy or unavailable. |
| `gemma3n_e4b` | `gemma3n:e4b` | Voice/small NodeAgent fallback | Laptop | Older fallback, no longer labeled latest. |
| `llama3_2_1b` | `llama3.2:1b` | Voice | Tiny | Very small stable fallback. |
| `llama3_2_3b` | `llama3.2:3b` | Voice, light NodeAgent | Laptop | Low-latency fallback. |
| `gemma3_4b_qat` | `gemma3:4b-it-qat` | Voice, NodeAgent, vision | Laptop | Compact stable multimodal baseline. |
| `qwen3_4b` | `qwen3:4b` | NodeAgent | Laptop | Stable small agent fallback. |
| `qwen3_30b` | `qwen3:30b` | NodeAgent, code, reasoning | Workstation | Stable MoE agent fallback. |
| `qwen2_5_coder_7b` | `qwen2.5-coder:7b` | Code | Laptop | Practical older code model. |
| `qwen2_5_coder_32b` | `qwen2.5-coder:32b` | Code | High VRAM | Stronger stable code model. |

## Embeddings

| ID | Ollama model | Best for | Notes |
| --- | --- | --- | --- |
| `nomic_embed_text` | `nomic-embed-text` | Embeddings | Local RAG embeddings. |
| `snowflake_arctic_embed2` | `snowflake-arctic-embed2` | Embeddings | Multilingual embedding option. |

## Cloud-only references excluded from runnable local defaults

| ID | Ollama model | Why excluded |
| --- | --- | --- |
| `gemma4_31b_cloud` | `gemma4:31b-cloud` | Current, but cloud-only in Ollama. |
| `kimi_k2_thinking_cloud` | `kimi-k2-thinking:cloud` | Current and relevant, but cloud-only in Ollama. |
| `kimi_k2_7_code_cloud` | `kimi-k2.7-code:cloud` | Current coder, but cloud-only in Ollama. |

## Source pages checked

- https://ollama.com/library/gemma4
- https://ai.google.dev/gemma/docs/core
- https://deepmind.google/models/gemma/gemma-4/
- https://developers.googleblog.com/bring-state-of-the-art-agentic-skills-to-the-edge-with-gemma-4/
- https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12b/
- https://ollama.com/library/qwen3
- https://ollama.com/library/qwen3.6
- https://ollama.com/library/qwen3-coder
- https://ollama.com/library/qwen3-coder-next
- https://ollama.com/library/glm-4.7-flash
- https://ollama.com/library/glm-5
- https://ollama.com/library/glm-5.1
- https://ollama.com/library/mistral-small3.2
- https://ollama.com/library/magistral
- https://ollama.com/library/devstral-small-2
- https://ollama.com/library/deepseek-r1
- https://ollama.com/library/phi4-mini-reasoning
- https://ollama.com/library/lfm2.5-thinking
- https://ollama.com/library/llama4
- https://openai.com/index/introducing-gpt-oss/
- https://ollama.com/library/gpt-oss
- https://ollama.com/library/nomic-embed-text
