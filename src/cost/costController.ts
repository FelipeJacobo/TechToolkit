import { CostRecord } from "../core/types.js";

export type CostLimits = {
  maxRunUsd: number;
  maxStepUsd: number;
};

export type ModelRate = {
  inputPer1k: number;
  outputPer1k: number;
};

export type CostConfig = {
  limits: CostLimits;
  rates: Record<string, ModelRate>;
  defaultModel: string;
};

export class CostController {
  private records: CostRecord[] = [];

  constructor(private config: CostConfig) {}

  recordUsage(params: {
    runId: string;
    stepId: string;
    model?: string;
    inputText: string;
    outputText: string;
  }): CostRecord {
    const model = params.model ?? this.config.defaultModel;
    const rate = this.config.rates[model] ?? this.config.rates[this.config.defaultModel]!;
    const inputTokens = estimateTokens(params.inputText);
    const outputTokens = estimateTokens(params.outputText);
    const costUsd =
      (inputTokens / 1000) * rate.inputPer1k + (outputTokens / 1000) * rate.outputPer1k;

    const record: CostRecord = {
      runId: params.runId,
      stepId: params.stepId,
      model,
      inputTokens,
      outputTokens,
      costUsd
    };
    this.records.push(record);
    this.enforce(params.runId, params.stepId);
    return record;
  }

  totalRun(runId: string): number {
    return this.records
      .filter((r) => r.runId === runId)
      .reduce((sum, r) => sum + r.costUsd, 0);
  }

  enforce(runId: string, stepId: string): void {
    const runTotal = this.totalRun(runId);
    const stepTotal = this.records
      .filter((r) => r.runId === runId && r.stepId === stepId)
      .reduce((sum, r) => sum + r.costUsd, 0);

    if (runTotal > this.config.limits.maxRunUsd) {
      throw new Error("cost_limit");
    }
    if (stepTotal > this.config.limits.maxStepUsd) {
      throw new Error("cost_limit");
    }
  }
}

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
