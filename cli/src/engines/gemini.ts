import {
	BaseAIEngine,
	checkForErrors,
	detectStepFromOutput,
	execCommand,
	execCommandStreaming,
	parseStreamJsonResult,
} from "./base.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

/**
 * Gemini CLI AI Engine
 * https://github.com/google-gemini/gemini-cli
 */
export class GeminiEngine extends BaseAIEngine {
	name = "Gemini";
	cliCommand = "gemini";

	/**
	 * Build command arguments for Gemini CLI
	 */
	private buildArgs(prompt: string, options?: EngineOptions): string[] {
		// Use --approval-mode yolo for full automation
		// Use --output-format stream-json for structured output
		const args = ["--approval-mode", "yolo", "--output-format", "stream-json"];

		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}

		// Gemini uses positional argument for prompt
		args.push(prompt);

		return args;
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const args = this.buildArgs(prompt, options);

		const { stdout, stderr, exitCode } = await execCommand(this.cliCommand, args, workDir);

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

		// Parse stream-json result (similar to Claude format)
		const { response, inputTokens, outputTokens } = parseStreamJsonResult(output);

		return {
			success: exitCode === 0,
			response,
			inputTokens,
			outputTokens,
		};
	}

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		const args = this.buildArgs(prompt, options);

		const outputLines: string[] = [];

		const { exitCode } = await execCommandStreaming(this.cliCommand, args, workDir, (line) => {
			outputLines.push(line);

			// Detect and report step changes
			const step = detectStepFromOutput(line);
			if (step) {
				onProgress(step);
			}
		});

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

		// Parse stream-json result
		const { response, inputTokens, outputTokens } = parseStreamJsonResult(output);

		return {
			success: exitCode === 0,
			response,
			inputTokens,
			outputTokens,
		};
	}
}
