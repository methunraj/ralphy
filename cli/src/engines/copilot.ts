import {
	BaseAIEngine,
	execCommand,
	execCommandStreaming,
} from "./base.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

/**
 * GitHub Copilot CLI AI Engine
 *
 * Note: Copilot CLI does not support JSON output format, so we cannot
 * track token usage. It works similar to text-based engines.
 */
export class CopilotEngine extends BaseAIEngine {
	name = "GitHub Copilot";
	cliCommand = "copilot";

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		// --yolo: Enable all permissions (auto-approve)
		// -s/--silent: Output only the agent response (no stats)
		// -p: Non-interactive prompt mode
		const args = ["--yolo", "-s"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		args.push("-p", prompt);

		const { stdout, stderr, exitCode } = await execCommand(this.cliCommand, args, workDir);

		const output = stdout || stderr;

		// Check for common error patterns
		const error = this.checkForErrors(output);
		if (error) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error,
			};
		}

		return {
			success: exitCode === 0,
			response: output.trim() || "Task completed",
			inputTokens: 0, // Copilot CLI doesn't provide token counts
			outputTokens: 0,
		};
	}

	/**
	 * Check for error patterns in text output
	 */
	private checkForErrors(output: string): string | null {
		const lower = output.toLowerCase();

		// Common error patterns
		if (lower.includes("error:") || lower.includes("failed to")) {
			// Extract the error message
			const lines = output.split("\n");
			for (const line of lines) {
				if (line.toLowerCase().includes("error") || line.toLowerCase().includes("failed")) {
					return line.trim();
				}
			}
			return "Unknown error occurred";
		}

		if (lower.includes("authentication") && lower.includes("failed")) {
			return "Authentication failed. Please run 'copilot auth login' first.";
		}

		if (lower.includes("rate limit") || lower.includes("too many requests")) {
			return "Rate limit exceeded. Please try again later.";
		}

		return null;
	}

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		const args = ["--yolo", "-s"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		args.push("-p", prompt);

		const outputLines: string[] = [];

		const { exitCode } = await execCommandStreaming(this.cliCommand, args, workDir, (line) => {
			outputLines.push(line);

			// Try to detect progress from text output
			const step = this.detectStepFromText(line);
			if (step) {
				onProgress(step);
			}
		});

		const output = outputLines.join("\n");

		// Check for errors
		const error = this.checkForErrors(output);
		if (error) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error,
			};
		}

		return {
			success: exitCode === 0,
			response: output.trim() || "Task completed",
			inputTokens: 0,
			outputTokens: 0,
		};
	}

	/**
	 * Detect current step from text output (heuristic-based)
	 */
	private detectStepFromText(line: string): string | null {
		const lower = line.toLowerCase();

		if (lower.includes("reading") || lower.includes("analyzing")) {
			return "Reading code";
		}
		if (lower.includes("writing") || lower.includes("creating") || lower.includes("editing")) {
			return "Implementing";
		}
		if (lower.includes("test")) {
			return lower.includes("running") ? "Testing" : "Writing tests";
		}
		if (lower.includes("lint") || lower.includes("format")) {
			return "Linting";
		}
		if (lower.includes("commit")) {
			return "Committing";
		}
		if (lower.includes("stage") || lower.includes("git add")) {
			return "Staging";
		}

		return null;
	}
}
