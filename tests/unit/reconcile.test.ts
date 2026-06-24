import { describe, expect, it } from "vitest";
import { reconcile } from "@/lib/statements/reconcile";

describe("reconcile", () => {
  it("reconciles an asset account that ties out", () => {
    expect(reconcile({ kind: "checking", opening: 100, closing: 150, amounts: [70, -20] }))
      .toEqual({ status: "reconciled", delta: 0 });
  });

  it("flags an asset discrepancy with a signed delta", () => {
    expect(reconcile({ kind: "savings", opening: 100, closing: 151, amounts: [70, -20] }))
      .toEqual({ status: "discrepancy", delta: 1 });
  });

  it("reconciles a credit account that ties out", () => {
    expect(reconcile({ kind: "credit", opening: 812.3, closing: 1208.85, amounts: [-789.55, 393] }))
      .toEqual({ status: "reconciled", delta: 0 });
  });

  it("flags a credit discrepancy (worked example)", () => {
    expect(reconcile({ kind: "credit", opening: 812.3, closing: 1204.55, amounts: [-789.55, 393] }))
      .toEqual({ status: "discrepancy", delta: -4.3 });
  });

  it("returns not_available when a balance is missing", () => {
    expect(reconcile({ kind: "checking", opening: null, closing: 150, amounts: [10] }))
      .toEqual({ status: "not_available", delta: null });
    expect(reconcile({ kind: "checking", opening: 0, closing: null, amounts: [10] }))
      .toEqual({ status: "not_available", delta: null });
  });

  it("returns not_applicable for investment accounts", () => {
    expect(reconcile({ kind: "investment", opening: 1000, closing: 1100, amounts: [50] }))
      .toEqual({ status: "not_applicable", delta: null });
  });

  it("is immune to floating-point noise", () => {
    expect(reconcile({ kind: "checking", opening: 0, closing: 0.3, amounts: [0.1, 0.2] }))
      .toEqual({ status: "reconciled", delta: 0 });
  });
});
