import {
	BaseAIEngine,
	checkForErrors,
	detectStepFromOutput,
	execCommand,
	execCommandStreaming,
} from "./base.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

/**
 * Blackbox CLI AI Engine
 * https://www.blackbox.ai/
 */
export class BlackboxEngine extends BaseAIEngine {
	name = "Blackbox";
	cliCommand = "blackbox";

	/**
	 * Build command arguments for Blackbox CLI
	 */
	private buildArgs(prompt: string, options?: EngineOptions): string[] {
		// Use --approval-mode yolo for full automation (auto-approve all tools)
		// Use --show-token-usage to get token information in non-interactive mode
		const args = ["--approval-mode", "yolo", "--show-token-usage"];

		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}

		args.push("--prompt", prompt);

		return args;
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const args = this.buildArgs(prompt, options);

		const startTime = Date.now();
		const { stdout, stderr, exitCode } = await execCommand(this.cliCommand, args, workDir);
		const durationMs = Date.now() - startTime;

		const output = stdout + stderr;

		// Check for errors
		const error = checkForErrors(output);
		if (error) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error,
			};
		}

		// Parse Blackbox output
		const { response, inputTokens, outputTokens } = this.parseOutput(output);

		return {
			success: exitCode === 0,
			response,
			inputTokens,
			outputTokens,
			cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
		};
	}

	private parseOutput(output: string): {
		response: string;
		inputTokens: number;
		outputTokens: number;
	} {
		const lines = output.split("\n").filter(Boolean);
		let response = "";
		let inputTokens = 0;
		let outputTokens = 0;

		// Try to parse JSON output first (if Blackbox outputs JSON)
		for (const line of lines) {
			try {
				const parsed = JSON.parse(line);

				// Check for result type
				if (parsed.type === "result") {
					response = parsed.result || "Task completed";
					if (parsed.usage) {
						inputTokens = parsed.usage.input_tokens || parsed.usage.prompt_tokens || 0;
						outputTokens = parsed.usage.output_tokens || parsed.usage.completion_tokens || 0;
					}
				}

				// Check for token usage in various formats
				if (parsed.tokens || parsed.usage) {
					const usage = parsed.tokens || parsed.usage;
					inputTokens = usage.input || usage.input_tokens || usage.prompt_tokens || inputTokens;
					outputTokens = usage.output || usage.output_tokens || usage.completion_tokens || outputTokens;
				}
			} catch {
				// Non-JSON line - could be part of the response
			}
		}

		// If no JSON response found, use the raw output
		if (!response) {
			// Filter out status messages and control characters
			const meaningfulLines = lines.filter((line) => {
				const trimmed = line.trim();
				return (
					trimmed &&
					!trimmed.startsWith("?") && // Interactive prompts
					!trimmed.startsWith("❯") && // Command prompts
					!trimmed.includes("Thinking...") && // Status messages
					!trimmed.includes("Working...") && // Status messages
					!trimmed.includes("Processing...") // Status messages
				);
			});

			response = meaningfulLines.join("\n") || "Task completed";
		}

		// Try to extract token usage from text output if not found in JSON
		// Look for patterns like "Tokens: 1234 in / 5678 out" or "Usage: 1234/5678"
		if (inputTokens === 0 && outputTokens === 0) {
			const tokenMatch = output.match(/tokens?[:\s]+(\d+)\s*(?:in|input|prompt)?\s*[\/|]\s*(\d+)\s*(?:out|output|completion)?/i);
			if (tokenMatch) {
				inputTokens = Number.parseInt(tokenMatch[1], 10) || 0;
				outputTokens = Number.parseInt(tokenMatch[2], 10) || 0;
			}
		}

		return { response, inputTokens, outputTokens };
	}

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		const args = this.buildArgs(prompt, options);

		const outputLines: string[] = [];
		const startTime = Date.now();

		const { exitCode } = await execCommandStreaming(this.cliCommand, args, workDir, (line) => {
			outputLines.push(line);

			// Detect and report step changes
			const step = detectStepFromOutput(line);
			if (step) {
				onProgress(step);
			}
		});

		const durationMs = Date.now() - startTime;
		const output = outputLines.join("\n");

		// Check for errors
		const error = checkForErrors(output);
		if (error) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error,
			};
		}

		// Parse Blackbox output
		const { response, inputTokens, outputTokens } = this.parseOutput(output);

		return {
			success: exitCode === 0,
			response,
			inputTokens,
			outputTokens,
			cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
		};
	}
}
