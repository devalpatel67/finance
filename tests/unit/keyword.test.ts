import { describe, expect, it } from "vitest";
import { suggestKeyword } from "@/lib/categories/keyword";

describe("suggestKeyword", () => {
  it("takes the leading run up to the first digit/*/#", () => {
    expect(suggestKeyword("STARBUCKS 57744 NIAGARA FALLS ON")).toBe("starbucks");
    expect(suggestKeyword("AMZN MKTP CA*ZX1 WWW.AMAZON.CA")).toBe("amzn mktp ca");
    expect(suggestKeyword("TIM HORTONS #4189 AJAX ON")).toBe("tim hortons");
  });

  it("returns the whole normalized string when there is no digit/*/#", () => {
    expect(suggestKeyword("Local Coffee Shop")).toBe("local coffee shop");
  });
});
